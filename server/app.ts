import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  credentialsSchema,
  notificationPrefsSchema,
  pushSubscriptionSchema,
  noteInputSchema,
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
import type { Collections, LabStudyDoc, UserDoc } from "./db.ts";
import { type LabStudyDto, labStudyInputSchema } from "../shared/labs.ts";
import { isTimeZone } from "../shared/achievements.ts";
import { achievementsFor, latestBody, remindStreaks, toRewardDto } from "./achievementCheck.ts";
import { appleHealthRoutes, toAppleHealthStatus } from "./appleHealthRoutes.ts";
import { createMeasurement, saveGoals, saveLabStudy, setNote, setWaist } from "./services.ts";
import { mcpRouter } from "./mcp/index.ts";
import { messages, notifyUser, type PushSender } from "./push.ts";
import { asyncRoute, clientIp, fieldProblems, hitRateLimit, isCronRequest, peekRateLimit, sendRateLimited, toMeasurementDto } from "./http.ts";
import { type ZeppClient, ZeppError, zeppClient } from "./zepp.ts";
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
  /** Why push is off, so the app can say whether the keys are missing or malformed. */
  pushProblem?: "missing" | "invalid" | null;
}

const MAX_MEASUREMENTS_PAGE = 1000;
const LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function toLabStudyDto(doc: LabStudyDoc): LabStudyDto {
  return { id: doc._id.toHexString(), takenAt: doc.takenAt, lab: doc.lab, results: doc.results };
}

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
      ? toAppleHealthStatus(user.appleHealth)
      : null,
    streakReward: user.streakReward ? toRewardDto(user.streakReward) : null,
    goals: {
      weight: g?.weight ? { ...g.weight, setAt: g.weight.setAt.toISOString(), reachedAt: g.weight.reachedAt?.toISOString() ?? null } : null,
      bodyFat: g?.bodyFat ? { ...g.bodyFat, setAt: g.bodyFat.setAt.toISOString(), reachedAt: g.bodyFat.reachedAt?.toISOString() ?? null } : null,
      maintain: g?.maintain ? { ...g.maintain, setAt: g.maintain.setAt.toISOString() } : null,
    },
    goalHistory: (user.goalHistory ?? []).map((h) => ({ ...h, setAt: h.setAt.toISOString(), reachedAt: h.reachedAt.toISOString() })),
  };
}

export function createApp({ getCollections, secureCookies, zepp = zeppClient, cronSecret, push, pushProblem = null }: AppOptions) {
  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");
  // The Claude connector (MCP and its OAuth sign-in) lives at the root, outside /api, with its own body parsers.
  app.use(mcpRouter(getCollections, push));
  // The Shortcut sends a week of Health readings (one line each), or a whole year once; Vercel
  // takes up to 4.5 MB. Everything else is small.
  app.use("/api/apple-health/ingest", express.json({ limit: "4mb" }));
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
      await collections.oauthTokens.deleteMany({ userId: user._id });
      await startSession(collections, res, user._id, secureCookies);
      res.json({ user: toUserDto(user), recoveryCode });
    }),
  );

  router.put(
    "/me/password",
    withUser(),
    asyncRoute(async (req, res) => {
      const body = z
        .object({ currentPassword: z.string().min(1).max(200), newPassword: credentialsSchema.shape.password })
        .parse(req.body);
      const user = req.user!;
      // Same lock as signing in: someone with the phone unlocked cannot guess the password forever.
      const key = `password:${user._id.toHexString()}`;
      const current = await peekRateLimit(collections, key, LOGIN_ATTEMPTS);
      if (current?.limited) return sendRateLimited(res, current);
      if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
        const limit = await hitRateLimit(collections, key, LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
        if (limit.limited) return sendRateLimited(res, limit);
        return res.status(401).json({ error: "wrong-password", attemptsLeft: limit.remaining });
      }
      await collections.users.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(body.newPassword) } });
      // Every other device signs out, in case the old password was known to someone; this one stays.
      // Claude connectors too: they sign in again with the new password.
      await collections.sessions.deleteMany({ userId: user._id });
      await collections.oauthTokens.deleteMany({ userId: user._id });
      await startSession(collections, res, user._id, secureCookies);
      res.json(toUserDto(user));
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
      const user = req.user!;
      const goals = await saveGoals(collections, user, req.body);
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
        collections.labStudies.deleteMany({ userId }),
        collections.oauthTokens.deleteMany({ userId }),
        collections.oauthCodes.deleteMany({ userId }),
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
      const saved = await createMeasurement(collections, push, req.user!._id, req.body);
      res.status(201).json(toMeasurementDto(saved));
    }),
  );

  router.patch(
    "/measurements/:id/waist",
    withUser(),
    asyncRoute(async (req, res) => {
      const id = z.string().regex(/^[0-9a-f]{24}$/).parse(req.params.id);
      const { waist, waistUnit } = waistInputSchema.parse(req.body);
      const waistCm = waist === null ? null : Math.round(waistToCm(waist, waistUnit) * 10) / 10;
      const saved = await setWaist(collections, req.user!._id, new ObjectId(id), waistCm);
      if (!saved) return res.status(404).json({ error: "not-found" });
      res.json(toMeasurementDto(saved));
    }),
  );

  router.patch(
    "/measurements/:id/note",
    withUser(),
    asyncRoute(async (req, res) => {
      const id = z.string().regex(/^[0-9a-f]{24}$/).parse(req.params.id);
      const { note } = noteInputSchema.parse(req.body);
      const saved = await setNote(collections, req.user!._id, new ObjectId(id), note);
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

  router.get(
    "/labs",
    withUser(),
    asyncRoute(async (req, res) => {
      const docs = await collections.labStudies.find({ userId: req.user!._id }).sort({ takenAt: -1, createdAt: -1 }).limit(100).toArray();
      res.json(docs.map(toLabStudyDto));
    }),
  );

  router.post(
    "/labs",
    withUser(),
    asyncRoute(async (req, res) => {
      const input = labStudyInputSchema.parse(req.body);
      const saved = await saveLabStudy(collections, req.user!._id, input);
      res.status(201).json(toLabStudyDto(saved));
    }),
  );

  router.delete(
    "/labs/:id",
    withUser(),
    asyncRoute(async (req, res) => {
      const id = z.string().regex(/^[0-9a-f]{24}$/).parse(req.params.id);
      const result = await collections.labStudies.deleteOne({ _id: new ObjectId(id), userId: req.user!._id });
      res.status(result.deletedCount ? 204 : 404).end();
    }),
  );

  router.get("/push/key", (_req, res) => {
    if (!push) return res.status(404).json({ error: pushProblem === "invalid" ? "push-misconfigured" : "push-unavailable" });
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
      const bad = (code: string) => res.status(400).json({ error: "invalid", fields: [{ path: "amount", code }] });
      let target = input.amount;
      let start: number | null = null;
      if (input.kind === "streak") {
        // A reward is for a streak still ahead, not one already reached.
        const a = await achievementsFor(collections, req.user!);
        if (a && input.amount <= a.streak.current) return bad("reward-too-short");
      } else {
        // Weight and body fat count from where they are now.
        const body = await latestBody(collections, req.user!);
        start = input.kind === "weight" ? body.weightKg : body.fatPct;
        if (start === null) return bad(input.kind === "weight" ? "reward-no-weight" : "reward-no-fat");
        if (input.kind === "weight") target = Math.round(toKilograms(input.amount, input.unit) * 100) / 100;
        if (start - target <= 0) return bad("reward-too-much");
      }
      const streakReward = { text: input.text, kind: input.kind, target, start, setAt: new Date(), earnedAt: null };
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
  router.use(appleHealthRoutes({ collections: () => collections, withUser, push }));

  app.use("/api", router);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not-found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid", fields: fieldProblems(error) });
    }
    if (error instanceof SyntaxError) return res.status(400).json({ error: "invalid-json" });
    if (error instanceof ZeppError && error.code === "misconfigured") {
      console.error(error.message);
      return res.status(503).json({ error: "zepp-misconfigured" });
    }
    console.error(error);
    res.status(500).json({ error: "server-error" });
  });

  return app;
}
