import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  credentialsSchema,
  goalsInputSchema,
  measurementInputSchema,
  notificationPrefsSchema,
  pushSubscriptionSchema,
  waistInputSchema,
  waistToCm,
  profileSchema,
  toKilograms,
  type UserDto,
  usernameSchema,
  streakRewardSchema,
} from "../shared/schemas.ts";
import {
  endSession,
  hashPassword,
  hashSecret,
  newRecoveryCode,
  normalizeRecoveryCode,
  requireUser,
  startSession,
  verifyPassword,
} from "./auth.ts";
import type { Collections, UserDoc } from "./db.ts";
import { bodyFatOf } from "../shared/composition.ts";
import { isTimeZone } from "../shared/achievements.ts";
import { maintainRange } from "../shared/goals.ts";
import { achievementsFor, checkAchievements, remindStreaks } from "./achievementCheck.ts";
import { appleHealthRoutes } from "./appleHealthRoutes.ts";
import { checkGoals } from "./goalCheck.ts";
import { messages, notifyUser, type PushSender } from "./push.ts";
import { asyncRoute, clientIp, hitRateLimit, isCronRequest, peekRateLimit, sendRateLimited, toMeasurementDto } from "./http.ts";
import { type ZeppClient, zeppClient } from "./zepp.ts";
import { deleteZeppDataFor, zeppRoutes } from "./zeppRoutes.ts";

export interface AppOptions {
  /** Resolves the database lazily so a cold serverless start connects on first request. */
  getCollections: () => Promise<Collections>;
  /** Secure cookies need HTTPS; local development runs on plain HTTP. */
  secureCookies: boolean;
  /** Zepp cloud client; tests pass a fake. */
  zepp?: ZeppClient;
  /** Secret Vercel Cron sends as a bearer token to the daily Zepp sync. */
  cronSecret?: string;
  /** Web Push sender; undefined turns notifications off (no VAPID keys). */
  push?: PushSender;
}

const MAX_MEASUREMENTS_PAGE = 1000;
const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function toUserDto(user: UserDoc): UserDto {
  const g = user.goals;
  return {
    username: user.username,
    profile: user.profile,
    notifications: {
      newWeighIn: user.notifications?.newWeighIn ?? true,
      zepp: user.notifications?.zepp ?? true,
      goals: user.notifications?.goals ?? true,
      streak: user.notifications?.streak ?? true,
    },
    appleHealth: user.appleHealth
      ? { since: user.appleHealth.since.toISOString(), lastSyncAt: user.appleHealth.lastSyncAt?.toISOString() ?? null }
      : null,
    streakReward: user.streakReward
      ? { ...user.streakReward, setAt: user.streakReward.setAt.toISOString(), earnedAt: user.streakReward.earnedAt?.toISOString() ?? null }
      : null,
    goals: {
      weight: g?.weight ? { ...g.weight, setAt: g.weight.setAt.toISOString(), reachedAt: g.weight.reachedAt?.toISOString() ?? null } : null,
      bodyFat: g?.bodyFat ? { ...g.bodyFat, setAt: g.bodyFat.setAt.toISOString(), reachedAt: g.bodyFat.reachedAt?.toISOString() ?? null } : null,
      maintain: g?.maintain ? { ...g.maintain, setAt: g.maintain.setAt.toISOString() } : null,
    },
    goalHistory: (user.goalHistory ?? []).map((h) => ({ ...h, setAt: h.setAt.toISOString(), reachedAt: h.reachedAt.toISOString() })),
  };
}

export function createApp({ getCollections, secureCookies, zepp = zeppClient, cronSecret, push }: AppOptions) {
  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  // Every route needs the database; resolve it before the routes run (cached after the first call).
  let collections: Collections;
  app.use((_req, _res, next) => {
    getCollections().then((c) => {
      collections = c;
      next();
    }, next);
  });

  const router = express.Router();
  const withUser = () => (req: Request, res: Response, next: NextFunction) => requireUser(collections)(req, res, next).catch(next);

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  router.post(
    "/auth/register",
    asyncRoute(async (req, res) => {
      const limit = await hitRateLimit(collections, `register:${clientIp(req)}`, 10, 60 * 60 * 1000);
      if (limit.limited) return sendRateLimited(res, limit);
      const { username, password } = credentialsSchema.parse(req.body);
      const recoveryCode = newRecoveryCode();
      const user: UserDoc = {
        _id: new ObjectId(),
        username,
        passwordHash: await hashPassword(password),
        recoveryHash: hashSecret(recoveryCode),
        profile: null,
        createdAt: new Date(),
      };
      try {
        await collections.users.insertOne(user);
      } catch (error) {
        if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: "username-taken" });
        throw error;
      }
      await startSession(collections, res, user._id, secureCookies);
      res.status(201).json({ user: toUserDto(user), recoveryCode });
    }),
  );

  router.post(
    "/auth/login",
    asyncRoute(async (req, res) => {
      // Any password length is accepted here: the 8-character rule is for new passwords.
      const { username, password } = z.object({ username: usernameSchema, password: z.string().min(1).max(200) }).parse(req.body);
      // Only failed attempts count toward the lock, so a correct password always gets in until then.
      const key = `login:${clientIp(req)}:${username}`;
      const current = await peekRateLimit(collections, key, LOGIN_ATTEMPTS);
      if (current?.limited) return sendRateLimited(res, current);
      // Registration already reveals whether a username exists, so saying which part failed costs nothing.
      const user = await collections.users.findOne({ username });
      if (!user) {
        const limit = await hitRateLimit(collections, key, LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
        return res.status(404).json({ error: "user-not-found", username, attemptsLeft: limit.remaining });
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        const limit = await hitRateLimit(collections, key, LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
        if (limit.limited) return sendRateLimited(res, limit);
        return res.status(401).json({ error: "wrong-password", attemptsLeft: limit.remaining });
      }
      await startSession(collections, res, user._id, secureCookies);
      res.json({ user: toUserDto(user) });
    }),
  );

  router.post(
    "/auth/recover",
    asyncRoute(async (req, res) => {
      const body = z
        .object({ username: usernameSchema, recoveryCode: z.string().min(1).max(64), newPassword: credentialsSchema.shape.password })
        .parse(req.body);
      const limit = await hitRateLimit(collections, `recover:${clientIp(req)}:${body.username}`, 5, 60 * 60 * 1000);
      if (limit.limited) return sendRateLimited(res, limit);
      const user = await collections.users.findOne({ username: body.username });
      if (!user) return res.status(404).json({ error: "user-not-found", username: body.username });
      if (user.recoveryHash !== hashSecret(normalizeRecoveryCode(body.recoveryCode))) {
        return res.status(401).json({ error: "invalid-recovery-code", attemptsLeft: limit.remaining });
      }
      // The code is single use: issue a new one and sign out every other device.
      const recoveryCode = newRecoveryCode();
      await collections.users.updateOne(
        { _id: user._id },
        { $set: { passwordHash: await hashPassword(body.newPassword), recoveryHash: hashSecret(recoveryCode) } },
      );
      await collections.sessions.deleteMany({ userId: user._id });
      await startSession(collections, res, user._id, secureCookies);
      res.json({ user: toUserDto(user), recoveryCode });
    }),
  );

  router.post(
    "/auth/logout",
    asyncRoute(async (req, res) => {
      await endSession(collections, req, res);
      res.status(204).end();
    }),
  );

  router.get("/me", withUser(), (req, res) => {
    res.json(toUserDto(req.user!));
  });

  router.put(
    "/me/profile",
    withUser(),
    asyncRoute(async (req, res) => {
      const input = profileSchema.parse(req.body);
      const profile = { ...input, displayName: input.displayName || null };
      await collections.users.updateOne({ _id: req.user!._id }, { $set: { profile } });
      res.json(toUserDto({ ...req.user!, profile }));
    }),
  );

  router.put(
    "/me/goals",
    withUser(),
    asyncRoute(async (req, res) => {
      const input = goalsInputSchema.parse(req.body);
      const user = req.user!;
      const previous = user.goals;
      // The starting point is the latest reading when the goal is set; an unchanged target keeps it.
      const latest = await collections.measurements.findOne({ userId: user._id }, { sort: { measuredAt: -1 } });
      const latestFat = await collections.measurements.findOne({ userId: user._id, bodyFatPct: { $ne: null } }, { sort: { measuredAt: -1 } });
      // Same body fat the app shows: recalculated from impedance when the reading has it.
      const startFat =
        latestFat && user.profile ? (bodyFatOf(user.profile, latestFat)?.value ?? null) : (latestFat?.bodyFatPct ?? null);
      const targetKg = input.weight ? Math.round(toKilograms(input.weight.value, input.weight.unit) * 100) / 100 : null;
      const centerKg = input.maintain ? Math.round(toKilograms(input.maintain.value, input.maintain.unit) * 100) / 100 : null;
      const goals: NonNullable<UserDoc["goals"]> = {
        weight:
          targetKg === null
            ? null
            : previous?.weight && Math.abs(previous.weight.targetKg - targetKg) < 0.01
              ? previous.weight
              : { targetKg, startKg: latest?.weightKg ?? null, setAt: new Date(), reachedAt: null },
        bodyFat:
          input.bodyFatPct === null
            ? null
            : previous?.bodyFat && previous.bodyFat.targetPct === input.bodyFatPct
              ? previous.bodyFat
              : { targetPct: input.bodyFatPct, startPct: startFat, setAt: new Date(), reachedAt: null },
        // Left out keeps the current one, unless a weight target replaces it (they are alternatives).
        maintain:
          input.maintain === undefined
            ? targetKg === null
              ? (previous?.maintain ?? null)
              : null
            : centerKg === null
              ? null
              : previous?.maintain && Math.abs(previous.maintain.centerKg - centerKg) < 0.01
                ? previous.maintain
                : { centerKg, ...maintainRange(centerKg), setAt: new Date(), outside: null },
      };
      await collections.users.updateOne({ _id: user._id }, { $set: { goals } });
      res.json(toUserDto({ ...user, goals }));
    }),
  );

  router.delete(
    "/me",
    withUser(),
    asyncRoute(async (req, res) => {
      const userId = req.user!._id;
      await deleteZeppDataFor(collections, userId);
      await Promise.all([
        collections.measurements.deleteMany({ userId }),
        collections.sessions.deleteMany({ userId }),
        collections.pushSubscriptions.deleteMany({ userId }),
        collections.healthDays.deleteMany({ userId }),
      ]);
      await collections.users.deleteOne({ _id: userId });
      res.clearCookie("cb_session", { path: "/" });
      res.status(204).end();
    }),
  );

  router.get(
    "/measurements",
    withUser(),
    asyncRoute(async (req, res) => {
      const limit = z.coerce.number().int().min(1).max(MAX_MEASUREMENTS_PAGE).catch(365).parse(req.query.limit);
      const items = await collections.measurements
        .find({ userId: req.user!._id })
        .sort({ measuredAt: -1 })
        .limit(limit)
        .toArray();
      res.json(items.map(toMeasurementDto));
    }),
  );

  router.post(
    "/measurements",
    withUser(),
    asyncRoute(async (req, res) => {
      const input = measurementInputSchema.parse(req.body);
      const measuredAt = input.measuredAt ? new Date(input.measuredAt) : new Date();
      const values = {
        weightKg: toKilograms(input.weight, input.weightUnit),
        bodyFatPct: input.bodyFatPct ?? null,
        muscleKg: input.muscleKg ?? null,
        waterPct: input.waterPct ?? null,
        boneKg: input.boneKg ?? null,
        visceralFat: input.visceralFat ?? null,
        waistCm: input.waist == null ? null : Math.round(waistToCm(input.waist, input.waistUnit) * 10) / 10,
        source: "manual" as const,
      };
      const saved = await collections.measurements.findOneAndUpdate(
        { userId: req.user!._id, measuredAt },
        { $set: values, $setOnInsert: { _id: new ObjectId(), userId: req.user!._id, measuredAt, createdAt: new Date() } },
        { upsert: true, returnDocument: "after" },
      );
      // Goals first: a goal reached in this weigh-in also counts for the goal badge.
      await checkGoals(collections, push, req.user!._id);
      await checkAchievements(collections, push, req.user!._id);
      res.status(201).json(toMeasurementDto(saved!));
    }),
  );

  router.patch(
    "/measurements/:id/waist",
    withUser(),
    asyncRoute(async (req, res) => {
      const id = z.string().regex(/^[0-9a-f]{24}$/).parse(req.params.id);
      const { waist, waistUnit } = waistInputSchema.parse(req.body);
      const waistCm = waist === null ? null : Math.round(waistToCm(waist, waistUnit) * 10) / 10;
      // Zepp re-syncs only touch Zepp's own fields, so a waist added here stays.
      const saved = await collections.measurements.findOneAndUpdate(
        { _id: new ObjectId(id), userId: req.user!._id },
        { $set: { waistCm } },
        { returnDocument: "after" },
      );
      if (!saved) return res.status(404).json({ error: "not-found" });
      res.json(toMeasurementDto(saved));
    }),
  );

  router.delete(
    "/measurements/:id",
    withUser(),
    asyncRoute(async (req, res) => {
      const id = z.string().regex(/^[0-9a-f]{24}$/).parse(req.params.id);
      const result = await collections.measurements.deleteOne({ _id: new ObjectId(id), userId: req.user!._id });
      res.status(result.deletedCount ? 204 : 404).end();
    }),
  );

  router.get("/push/key", (_req, res) => {
    if (!push) return res.status(404).json({ error: "push-unavailable" });
    res.json({ publicKey: push.publicKey });
  });

  router.post(
    "/push/subscribe",
    withUser(),
    asyncRoute(async (req, res) => {
      const { endpoint, keys } = pushSubscriptionSchema.parse(req.body);
      // A device belongs to whoever subscribed it last (signing in as someone else moves it).
      await collections.pushSubscriptions.updateOne(
        { endpoint },
        {
          $set: { userId: req.user!._id, p256dh: keys.p256dh, auth: keys.auth },
          $setOnInsert: { _id: new ObjectId(), endpoint, createdAt: new Date() },
        },
        { upsert: true },
      );
      res.status(204).end();
    }),
  );

  router.delete(
    "/push/subscribe",
    withUser(),
    asyncRoute(async (req, res) => {
      const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
      await collections.pushSubscriptions.deleteOne({ endpoint, userId: req.user!._id });
      res.status(204).end();
    }),
  );

  router.post(
    "/push/test",
    withUser(),
    asyncRoute(async (req, res) => {
      const limit = await hitRateLimit(collections, `push-test:${req.user!._id.toHexString()}`, 10, 60 * 60 * 1000);
      if (limit.limited) return sendRateLimited(res, limit);
      const sent = await notifyUser(collections, push, req.user!._id, "test", messages.test);
      res.json({ sent });
    }),
  );

  router.get(
    "/me/achievements",
    withUser(),
    asyncRoute(async (req, res) => {
      // The app sends the phone's time zone; keep it so syncs and notifications count days the same way.
      const tz = typeof req.query.tz === "string" && req.query.tz.length <= 64 && isTimeZone(req.query.tz) ? req.query.tz : null;
      let user = req.user!;
      if (tz && tz !== user.timeZone) {
        await collections.users.updateOne({ _id: user._id }, { $set: { timeZone: tz } });
        user = { ...user, timeZone: tz };
      }
      const result = await achievementsFor(collections, user);
      if (!result) return res.status(409).json({ error: "profile-required" });
      res.json(result);
    }),
  );

  router.put(
    "/me/streak-reward",
    withUser(),
    asyncRoute(async (req, res) => {
      const input = streakRewardSchema.parse(req.body);
      const a = await achievementsFor(collections, req.user!);
      // A reward is for a streak still ahead, not one already reached.
      if (a && input.days <= a.streak.current) return res.status(400).json({ error: "invalid", fields: [{ path: "days", code: "reward-too-short" }] });
      const streakReward = { ...input, setAt: new Date(), earnedAt: null };
      await collections.users.updateOne({ _id: req.user!._id }, { $set: { streakReward } });
      res.json(toUserDto({ ...req.user!, streakReward }));
    }),
  );

  router.delete(
    "/me/streak-reward",
    withUser(),
    asyncRoute(async (req, res) => {
      await collections.users.updateOne({ _id: req.user!._id }, { $unset: { streakReward: "" } });
      res.json(toUserDto({ ...req.user!, streakReward: null }));
    }),
  );

  // Evening reminder before a streak ends (Vercel Cron, see vercel.json).
  router.get(
    "/cron/streak-reminder",
    asyncRoute(async (req, res) => {
      if (!isCronRequest(req, cronSecret)) return res.status(401).json({ error: "unauthorized" });
      res.json({ reminded: await remindStreaks(collections, push) });
    }),
  );

  router.put(
    "/me/notifications",
    withUser(),
    asyncRoute(async (req, res) => {
      const notifications = notificationPrefsSchema.parse(req.body);
      await collections.users.updateOne({ _id: req.user!._id }, { $set: { notifications } });
      res.json(toUserDto({ ...req.user!, notifications }));
    }),
  );

  router.use(zeppRoutes({ collections: () => collections, withUser, zepp, cronSecret, push }));
  router.use(appleHealthRoutes({ collections: () => collections, withUser }));

  app.use("/api", router);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not-found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid", fields: error.issues.map((i) => ({ path: i.path.join("."), code: i.message })) });
    }
    if (error instanceof SyntaxError) return res.status(400).json({ error: "invalid-json" });
    console.error(error);
    res.status(500).json({ error: "server-error" });
  });

  return app;
}
