import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  credentialsSchema,
  measurementInputSchema,
  profileSchema,
  toKilograms,
  type UserDto,
  usernameSchema,
} from "../shared/schemas.ts";
import {
  endSession,
  hashPassword,
  hashSecret,
  newRecoveryCode,
  normalizeRecoveryCode,
  requireUser,
  startSession,
  verifyAgainstDummy,
  verifyPassword,
} from "./auth.ts";
import type { Collections, UserDoc } from "./db.ts";
import { asyncRoute, clientIp, hitRateLimit, toMeasurementDto } from "./http.ts";
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
}

const MAX_MEASUREMENTS_PAGE = 1000;

function toUserDto(user: UserDoc): UserDto {
  return { username: user.username, profile: user.profile };
}

export function createApp({ getCollections, secureCookies, zepp = zeppClient, cronSecret }: AppOptions) {
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
      if (await hitRateLimit(collections, `register:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
        return res.status(429).json({ error: "rate-limited" });
      }
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
      const { username, password } = credentialsSchema.parse(req.body);
      if (await hitRateLimit(collections, `login:${clientIp(req)}:${username}`, 10, 15 * 60 * 1000)) {
        return res.status(429).json({ error: "rate-limited" });
      }
      const user = await collections.users.findOne({ username });
      const valid = user ? await verifyPassword(user.passwordHash, password) : await verifyAgainstDummy(password);
      if (!user || !valid) return res.status(401).json({ error: "invalid-credentials" });
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
      if (await hitRateLimit(collections, `recover:${clientIp(req)}:${body.username}`, 5, 60 * 60 * 1000)) {
        return res.status(429).json({ error: "rate-limited" });
      }
      const user = await collections.users.findOne({ username: body.username });
      if (!user || user.recoveryHash !== hashSecret(normalizeRecoveryCode(body.recoveryCode))) {
        return res.status(401).json({ error: "invalid-recovery-code" });
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

  router.delete(
    "/me",
    withUser(),
    asyncRoute(async (req, res) => {
      const userId = req.user!._id;
      await deleteZeppDataFor(collections, userId);
      await Promise.all([
        collections.measurements.deleteMany({ userId }),
        collections.sessions.deleteMany({ userId }),
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
        source: "manual" as const,
      };
      const saved = await collections.measurements.findOneAndUpdate(
        { userId: req.user!._id, measuredAt },
        { $set: values, $setOnInsert: { _id: new ObjectId(), userId: req.user!._id, measuredAt, createdAt: new Date() } },
        { upsert: true, returnDocument: "after" },
      );
      res.status(201).json(toMeasurementDto(saved!));
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

  router.use(zeppRoutes({ collections: () => collections, withUser, zepp, cronSecret }));

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
