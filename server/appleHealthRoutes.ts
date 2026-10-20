import express, { type Request, type RequestHandler } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { localDay } from "../shared/achievements.ts";
import {
  type AppleHealthStatus,
  HEALTH_METRICS,
  type HealthAttempt,
  type HealthDayDto,
  type HealthMetric,
  readHealthSend,
  shortcutVersionOf,
} from "../shared/health.ts";
import { DEFAULT_TIME_ZONE } from "./achievementCheck.ts";
import { hashSecret, newSecret } from "./auth.ts";
import type { Collections, HealthDayDoc, UserDoc } from "./db.ts";
import { asyncRoute, clientIp, hitRateLimit, peekRateLimit, sendRateLimited } from "./http.ts";

interface Context {
  collections: () => Collections;
  withUser: () => RequestHandler;
}

/** Keys start with a recognizable prefix so a pasted key is easy to tell from other secrets. */
const KEY_PREFIX = "cbh_";
/** Wrong keys allowed per address before it has to wait (a key is 32 random bytes; this stops noise, not guessing). */
const BAD_KEY_LIMIT = 20;
const BAD_KEY_WINDOW_MS = 60 * 60 * 1000;
const MAX_DAYS = 400;
/** Characters of the last send kept for Settings; one run of the Shortcut is about 3,000. */
const RECEIVED_MAX = 20_000;

export function toHealthDayDto(d: HealthDayDoc): HealthDayDto {
  const metrics = Object.fromEntries(HEALTH_METRICS.map((m) => [m, d[m] ?? null])) as Record<HealthMetric, number | null>;
  return { date: d.date, ...metrics, sleep: d.sleep ?? null, symptoms: d.symptoms ?? {} };
}

export function toAppleHealthStatus(a: NonNullable<UserDoc["appleHealth"]>): AppleHealthStatus {
  return {
    since: a.since.toISOString(),
    lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    lastAttempt: a.lastAttempt ? { ...a.lastAttempt, at: a.lastAttempt.at.toISOString() } : null,
  };
}

function bearer(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") ?? "");
  return match ? match[1]! : null;
}

export function appleHealthRoutes({ collections, withUser }: Context) {
  const router = express.Router();

  // A new key replaces the old one; it is shown once and only its hash is kept.
  router.post(
    "/me/apple-health/key",
    withUser(),
    asyncRoute(async (req, res) => {
      const key = `${KEY_PREFIX}${newSecret()}`;
      const appleHealth = { keyHash: hashSecret(key), since: new Date(), lastSyncAt: null };
      await collections().users.updateOne({ _id: req.user!._id }, { $set: { appleHealth } });
      res.json({ key, status: toAppleHealthStatus(appleHealth) });
    }),
  );

  // Disconnecting forgets the key; the days already received stay.
  router.delete(
    "/me/apple-health/key",
    withUser(),
    asyncRoute(async (req, res) => {
      await collections().users.updateOne({ _id: req.user!._id }, { $unset: { appleHealth: "" } });
      res.status(204).end();
    }),
  );

  router.get(
    "/me/apple-health/days",
    withUser(),
    asyncRoute(async (req, res) => {
      const days = z.coerce.number().int().min(1).max(MAX_DAYS).catch(90).parse(req.query.days);
      const docs = await collections().healthDays.find({ userId: req.user!._id }).sort({ date: -1 }).limit(days).toArray();
      res.json(docs.reverse().map(toHealthDayDto));
    }),
  );

  // What the Shortcut calls: the person's key as a bearer token, and one day (or several) of totals.
  router.post(
    "/apple-health/ingest",
    asyncRoute(async (req, res) => {
      const c = collections();
      const limitKey = `apple-health:${clientIp(req)}`;
      const limited = await peekRateLimit(c, limitKey, BAD_KEY_LIMIT);
      if (limited?.limited) return sendRateLimited(res, limited);
      const key = bearer(req);
      const user = key?.startsWith(KEY_PREFIX) ? await c.users.findOne({ "appleHealth.keyHash": hashSecret(key) }) : null;
      if (!user) {
        await hitRateLimit(c, limitKey, BAD_KEY_LIMIT, BAD_KEY_WINDOW_MS);
        return res.status(401).json({ error: "invalid-health-key" });
      }
      // Every run is recorded, failed ones too, so Settings can show which Shortcut ran and why it failed.
      const now = new Date();
      const version = shortcutVersionOf(req.body);
      // What arrived, as sent, so a run can be checked value by value; the key travels in a header, not here.
      const received = JSON.stringify(req.body ?? null, null, 1).slice(0, RECEIVED_MAX);
      const record = (attempt: Omit<HealthAttempt, "at" | "version" | "received">) =>
        c.users.updateOne(
          { _id: user._id },
          { $set: { "appleHealth.lastAttempt": { ...attempt, at: now, version, received }, ...(attempt.ok ? { "appleHealth.lastSyncAt": now } : {}) } },
        );
      const { days, problems } = readHealthSend(req.body);
      if (days.length === 0) {
        await record({ ok: false, saved: [], problems });
        return res.status(400).json({ error: "invalid", fields: problems });
      }
      const today = new Date(localDay(Date.now(), user.timeZone ?? DEFAULT_TIME_ZONE) * 86_400_000).toISOString().slice(0, 10);
      const saved: HealthDayDto[] = [];
      const counts: HealthAttempt["saved"] = [];
      // Values without a date go to today, which may also have come with its date: one write per day.
      const byDate = new Map<string, { set: Record<string, unknown>; count: number }>();
      for (const day of days) {
        const date = day.date ?? today;
        const entry = byDate.get(date) ?? { set: { updatedAt: now }, count: 0 };
        // Only what was sent is written, so separate Shortcuts can each send their own part.
        Object.assign(entry.set, day.values);
        if (day.sleep !== undefined) entry.set.sleep = day.sleep;
        for (const [symptom, value] of Object.entries(day.symptoms)) entry.set[`symptoms.${symptom}`] = value;
        entry.count += Object.values(day.values).filter((v) => v !== null).length + (day.sleep ? 1 : 0) + Object.keys(day.symptoms).length;
        byDate.set(date, entry);
      }
      for (const [date, { set, count }] of byDate) {
        const doc = await c.healthDays.findOneAndUpdate(
          { userId: user._id, date },
          { $set: set, $setOnInsert: { _id: new ObjectId(), userId: user._id, date } },
          { upsert: true, returnDocument: "after" },
        );
        saved.push(toHealthDayDto(doc!));
        counts.push({ date, count });
      }
      await record({ ok: true, saved: counts, problems });
      res.json({ ok: true, saved, problems });
    }),
  );

  return router;
}
