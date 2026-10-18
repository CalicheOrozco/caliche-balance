import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { joinCodeSchema, type ZeppMemberDto, type ZeppStatusDto, zeppConnectSchema } from "../shared/schemas.ts";
import { hashSecret, newRecoveryCode, normalizeRecoveryCode } from "./auth.ts";
import type { Collections, ZeppConnectionDoc } from "./db.ts";
import { asyncRoute, hitRateLimit, sendRateLimited, toMeasurementDto } from "./http.ts";
import { type ZeppClient, ZeppError, encryptToken } from "./zepp.ts";
import { syncConnection } from "./zeppSync.ts";

const INVITE_DAYS = 7;
/** Opening the app triggers a sync; this keeps repeated opens from hammering Zepp. */
const MIN_SYNC_INTERVAL_MS = 2 * 60 * 1000;

interface Context {
  collections: () => Collections;
  withUser: () => RequestHandler;
  zepp: ZeppClient;
  cronSecret?: string;
}

/** The connection a person owns, or the one whose member they are linked to. */
async function connectionFor(c: Collections, userId: ObjectId) {
  const owned = await c.zeppConnections.findOne({ ownerUserId: userId });
  if (owned) return { connection: owned, role: "owner" as const };
  const member = await c.zeppMembers.findOne({ linkedUserId: userId });
  const connection = member && (await c.zeppConnections.findOne({ _id: member.connectionId }));
  return connection ? { connection, role: "member" as const } : null;
}

/** Called when an account is deleted: owners take the household link with them, members just leave. */
export async function deleteZeppDataFor(c: Collections, userId: ObjectId): Promise<void> {
  const owned = await c.zeppConnections.findOne({ ownerUserId: userId });
  if (owned) {
    // Readings nobody claimed belong to the owner's Zepp account; they go with it.
    await c.measurements.deleteMany({ "zepp.connectionId": owned._id, userId: null });
    await c.zeppMembers.deleteMany({ connectionId: owned._id });
    await c.zeppConnections.deleteOne({ _id: owned._id });
  }
  await c.zeppMembers.updateMany({ linkedUserId: userId }, { $set: { linkedUserId: null } });
}

function secretMatches(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function zeppRoutes({ collections, withUser, zepp, cronSecret }: Context) {
  const router = express.Router();

  const ownerOnly = async (req: Request, res: Response, next: NextFunction) => {
    const connection = await collections().zeppConnections.findOne({ ownerUserId: req.user!._id });
    if (!connection) return res.status(404).json({ error: "zepp-not-connected" });
    res.locals.connection = connection;
    next();
  };
  const owner = (req: Request, res: Response, next: NextFunction) => ownerOnly(req, res, next).catch(next);

  async function status(userId: ObjectId): Promise<ZeppStatusDto> {
    const c = collections();
    const found = await connectionFor(c, userId);
    if (!found) return { role: "none", status: null, lastError: null, lastSyncAt: null, members: [], ownerUsername: null };
    const { connection, role } = found;
    const ownerUser = await c.users.findOne({ _id: connection.ownerUserId }, { projection: { username: 1 } });
    let members: ZeppMemberDto[] = [];
    if (role === "owner") {
      const docs = await c.zeppMembers.find({ connectionId: connection._id }).sort({ memberId: -1 }).toArray();
      const linked = await c.users
        .find({ _id: { $in: docs.flatMap((d) => (d.linkedUserId ? [d.linkedUserId] : [])) } }, { projection: { username: 1 } })
        .toArray();
      const unassigned = await c.measurements
        .aggregate<{ _id: string; n: number }>([
          { $match: { "zepp.connectionId": connection._id, userId: null } },
          { $group: { _id: "$zepp.memberId", n: { $sum: 1 } } },
        ])
        .toArray();
      members = docs.map((d) => ({
        memberId: d.memberId,
        nickname: d.nickname,
        linkedUsername: linked.find((u) => d.linkedUserId?.equals(u._id))?.username ?? null,
        invitePending: !!d.inviteCodeHash && !!d.inviteExpiresAt && d.inviteExpiresAt > new Date(),
        unassignedCount: unassigned.find((u) => u._id === d.memberId)?.n ?? 0,
      }));
    }
    return {
      role,
      status: connection.status,
      lastError: role === "owner" ? connection.lastError : null,
      lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
      members,
      ownerUsername: ownerUser?.username ?? null,
    };
  }

  router.get(
    "/zepp",
    withUser(),
    asyncRoute(async (req, res) => {
      res.json(await status(req.user!._id));
    }),
  );

  router.post(
    "/zepp/connect",
    withUser(),
    asyncRoute(async (req, res) => {
      const c = collections();
      const { appToken, zeppUserId } = zeppConnectSchema.parse(req.body);
      const limit = await hitRateLimit(c, `zepp-connect:${req.user!._id.toHexString()}`, 10, 60 * 60 * 1000);
      if (limit.limited) return sendRateLimited(res, limit);
      if (await c.zeppMembers.findOne({ linkedUserId: req.user!._id, memberId: { $ne: "-1" } })) {
        return res.status(409).json({ error: "already-member" });
      }
      try {
        await zepp.members(appToken, zeppUserId);
      } catch (error) {
        if (error instanceof ZeppError) {
          return res.status(400).json({ error: error.code === "invalid-token" ? "zepp-invalid-token" : "zepp-unavailable" });
        }
        throw error;
      }
      const existing = await c.zeppConnections.findOne({ ownerUserId: req.user!._id });
      if (existing && existing.zeppUserId !== zeppUserId) {
        // A different Zepp account replaces the old one entirely.
        await deleteZeppDataFor(c, req.user!._id);
      }
      await c.zeppConnections.updateOne(
        { ownerUserId: req.user!._id },
        {
          $set: { zeppUserId, tokenEncrypted: encryptToken(appToken), status: "ok", lastError: null },
          $setOnInsert: { _id: new ObjectId(), ownerUserId: req.user!._id, lastSyncAt: null, createdAt: new Date() },
        },
        { upsert: true },
      );
      const connection = (await c.zeppConnections.findOne({ ownerUserId: req.user!._id }))!;
      const result = await syncConnection(c, zepp, connection);
      res.json({ ...(await status(req.user!._id)), imported: result.imported });
    }),
  );

  router.post(
    "/zepp/sync",
    withUser(),
    asyncRoute(async (req, res) => {
      const c = collections();
      const found = await connectionFor(c, req.user!._id);
      if (!found) return res.status(404).json({ error: "zepp-not-connected" });
      const { connection } = found;
      const recent = connection.lastSyncAt && Date.now() - connection.lastSyncAt.getTime() < MIN_SYNC_INTERVAL_MS;
      if (recent || connection.status === "invalid-token") {
        return res.json({ imported: 0, status: connection.status, skipped: true });
      }
      res.json(await syncConnection(c, zepp, connection));
    }),
  );

  router.delete(
    "/zepp",
    withUser(),
    owner,
    asyncRoute(async (req, res) => {
      await deleteZeppDataFor(collections(), req.user!._id);
      res.status(204).end();
    }),
  );

  router.post(
    "/zepp/members/:memberId/invite",
    withUser(),
    owner,
    asyncRoute(async (req, res) => {
      const connection = res.locals.connection as ZeppConnectionDoc;
      const memberId = z.string().max(32).parse(req.params.memberId);
      const code = newRecoveryCode().slice(0, 9); // "XXXX-XXXX"
      const result = await collections().zeppMembers.updateOne(
        { connectionId: connection._id, memberId, linkedUserId: null },
        {
          $set: {
            inviteCodeHash: hashSecret(normalizeRecoveryCode(code)),
            inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
          },
        },
      );
      if (!result.matchedCount) return res.status(409).json({ error: "member-unavailable" });
      res.json({ code, expiresInDays: INVITE_DAYS });
    }),
  );

  router.delete(
    "/zepp/members/:memberId/link",
    withUser(),
    owner,
    asyncRoute(async (req, res) => {
      const connection = res.locals.connection as ZeppConnectionDoc;
      const memberId = z.string().max(32).parse(req.params.memberId);
      if (memberId === "-1") return res.status(409).json({ error: "member-unavailable" });
      await collections().zeppMembers.updateOne(
        { connectionId: connection._id, memberId },
        { $set: { linkedUserId: null, inviteCodeHash: null, inviteExpiresAt: null } },
      );
      res.status(204).end();
    }),
  );

  router.post(
    "/zepp/join",
    withUser(),
    asyncRoute(async (req, res) => {
      const c = collections();
      const limit = await hitRateLimit(c, `zepp-join:${req.user!._id.toHexString()}`, 10, 60 * 60 * 1000);
      if (limit.limited) return sendRateLimited(res, limit);
      const { code } = joinCodeSchema.parse(req.body);
      if (await connectionFor(c, req.user!._id)) return res.status(409).json({ error: "already-member" });
      const member = await c.zeppMembers.findOneAndUpdate(
        { inviteCodeHash: hashSecret(normalizeRecoveryCode(code)), inviteExpiresAt: { $gt: new Date() }, linkedUserId: null },
        { $set: { linkedUserId: req.user!._id, inviteCodeHash: null, inviteExpiresAt: null } },
        { returnDocument: "after" },
      );
      if (!member) return res.status(400).json({ error: "invalid-invite" });
      // Readings already imported for this member become theirs.
      await c.measurements
        .updateMany({ "zepp.connectionId": member.connectionId, "zepp.memberId": member.memberId, userId: null }, { $set: { userId: req.user!._id } })
        .catch(() => undefined);
      res.json(await status(req.user!._id));
    }),
  );

  router.post(
    "/zepp/leave",
    withUser(),
    asyncRoute(async (req, res) => {
      const c = collections();
      await c.zeppMembers.updateMany({ linkedUserId: req.user!._id, memberId: { $ne: "-1" } }, { $set: { linkedUserId: null } });
      res.json(await status(req.user!._id));
    }),
  );

  // A reading Zepp gave the wrong person goes back to the household's unassigned list.
  router.post(
    "/measurements/:id/not-mine",
    withUser(),
    asyncRoute(async (req, res) => {
      const id = z.string().regex(/^[0-9a-f]{24}$/).parse(req.params.id);
      const result = await collections().measurements.updateOne(
        { _id: new ObjectId(id), userId: req.user!._id, source: "zepp" },
        { $set: { userId: null } },
      );
      res.status(result.modifiedCount ? 204 : 404).end();
    }),
  );

  router.get(
    "/zepp/unassigned",
    withUser(),
    owner,
    asyncRoute(async (_req, res) => {
      const connection = res.locals.connection as ZeppConnectionDoc;
      const items = await collections()
        .measurements.find({ "zepp.connectionId": connection._id, userId: null })
        .sort({ measuredAt: -1 })
        .limit(200)
        .toArray();
      res.json(items.map((m) => ({ ...toMeasurementDto(m), memberId: m.zepp!.memberId })));
    }),
  );

  router.post(
    "/zepp/unassigned/:id/assign",
    withUser(),
    owner,
    asyncRoute(async (req, res) => {
      const c = collections();
      const connection = res.locals.connection as ZeppConnectionDoc;
      const id = z.string().regex(/^[0-9a-f]{24}$/).parse(req.params.id);
      const { memberId } = z.object({ memberId: z.string().max(32) }).parse(req.body);
      const member = await c.zeppMembers.findOne({ connectionId: connection._id, memberId });
      if (!member) return res.status(404).json({ error: "member-unavailable" });
      const result = await c.measurements.updateOne(
        { _id: new ObjectId(id), "zepp.connectionId": connection._id, userId: null },
        { $set: { userId: member.linkedUserId, "zepp.memberId": memberId } },
      );
      res.status(result.matchedCount ? 204 : 404).end();
    }),
  );

  // Daily sync for every household (Vercel Cron, see vercel.json).
  router.get(
    "/cron/zepp-sync",
    asyncRoute(async (req, res) => {
      if (!cronSecret || !secretMatches(req.get("authorization"), `Bearer ${cronSecret}`)) {
        return res.status(401).json({ error: "unauthorized" });
      }
      const c = collections();
      const connections = await c.zeppConnections.find({ status: { $ne: "invalid-token" } }).toArray();
      let imported = 0;
      for (const connection of connections) imported += (await syncConnection(c, zepp, connection)).imported;
      res.json({ connections: connections.length, imported });
    }),
  );

  return router;
}
