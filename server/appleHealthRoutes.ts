import express, { type Request, type RequestHandler } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { localDay } from "../shared/achievements.ts";
import { HEALTH_METRICS, type HealthDayDto, type HealthDayInput, healthIngestSchema } from "../shared/health.ts";
import { DEFAULT_TIME_ZONE } from "./achievementCheck.ts";
import { hashSecret, newSecret } from "./auth.ts";
import type { Collections, HealthDayDoc } from "./db.ts";
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

export function toHealthDayDto(d: HealthDayDoc): HealthDayDto {
  return Object.fromEntries([["date", d.date], ...HEALTH_METRICS.map((m) => [m, d[m] ?? null])]) as unknown as HealthDayDto;
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
      res.json({ key, status: { since: appleHealth.since.toISOString(), lastSyncAt: null } });
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
      const days: HealthDayInput[] = healthIngestSchema.parse(req.body).days;
      const today = new Date(localDay(Date.now(), user.timeZone ?? DEFAULT_TIME_ZONE) * 86_400_000).toISOString().slice(0, 10);
      const now = new Date();
      const saved: HealthDayDto[] = [];
      for (const day of days) {
        const date = day.date ?? today;
        // Only the metrics sent are written, so separate Shortcuts can each send their own.
        const values = Object.fromEntries(HEALTH_METRICS.filter((m) => day[m] !== undefined).map((m) => [m, day[m]]));
        const doc = await c.healthDays.findOneAndUpdate(
          { userId: user._id, date },
          { $set: { ...values, updatedAt: now }, $setOnInsert: { _id: new ObjectId(), userId: user._id, date } },
          { upsert: true, returnDocument: "after" },
        );
        saved.push(toHealthDayDto(doc!));
      }
      await c.users.updateOne({ _id: user._id }, { $set: { "appleHealth.lastSyncAt": now } });
      res.json({ ok: true, saved });
    }),
  );

  return router;
}
