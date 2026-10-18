import { type Collection, type Db, MongoClient, type ObjectId } from "mongodb";
import type { BodyFatGoal, ProfileDto, WeightGoal } from "../shared/schemas.ts";

export interface UserDoc {
  _id: ObjectId;
  username: string;
  passwordHash: string;
  recoveryHash: string;
  profile: (Omit<ProfileDto, "displayName"> & { displayName: string | null }) | null;
  goals?: {
    weight: (Omit<WeightGoal, "setAt"> & { setAt: Date }) | null;
    bodyFat: (Omit<BodyFatGoal, "setAt"> & { setAt: Date }) | null;
  };
  createdAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export interface MeasurementDoc {
  _id: ObjectId;
  /** null while a Zepp reading belongs to a household member who has not joined yet. */
  userId: ObjectId | null;
  measuredAt: Date;
  weightKg: number;
  bodyFatPct: number | null;
  muscleKg: number | null;
  waterPct: number | null;
  boneKg: number | null;
  visceralFat: number | null;
  // Values only Zepp provides.
  proteinPct?: number | null;
  bmrKcal?: number | null;
  bodyAge?: number | null;
  bodyScore?: number | null;
  impedance?: number | null;
  idealWeightKg?: number | null;
  source: "manual" | "zepp";
  zepp?: { connectionId: ObjectId; memberId: string; key: string };
  createdAt: Date;
}

/** One household's link to a Zepp Life account; the owner is the Caliche Balance user who connected it. */
export interface ZeppConnectionDoc {
  _id: ObjectId;
  ownerUserId: ObjectId;
  zeppUserId: string;
  tokenEncrypted: string;
  status: "ok" | "invalid-token" | "error";
  lastError: string | null;
  lastSyncAt: Date | null;
  createdAt: Date;
}

export interface ZeppMemberDoc {
  _id: ObjectId;
  connectionId: ObjectId;
  /** Zepp's member id; "-1" is the Zepp account holder. */
  memberId: string;
  nickname: string | null;
  linkedUserId: ObjectId | null;
  inviteCodeHash: string | null;
  inviteExpiresAt: Date | null;
  /** Unix seconds of the newest reading already imported for this member. */
  syncedUntil: number;
}

export interface RateLimitDoc {
  _id: string;
  count: number;
  expiresAt: Date;
}

export interface Collections {
  users: Collection<UserDoc>;
  sessions: Collection<SessionDoc>;
  measurements: Collection<MeasurementDoc>;
  rateLimits: Collection<RateLimitDoc>;
  zeppConnections: Collection<ZeppConnectionDoc>;
  zeppMembers: Collection<ZeppMemberDoc>;
}

export function collections(db: Db): Collections {
  return {
    users: db.collection("users"),
    sessions: db.collection("sessions"),
    measurements: db.collection("measurements"),
    rateLimits: db.collection("rateLimits"),
    zeppConnections: db.collection("zeppConnections"),
    zeppMembers: db.collection("zeppMembers"),
  };
}

export async function ensureIndexes(c: Collections): Promise<void> {
  await Promise.all([
    c.users.createIndex({ username: 1 }, { unique: true }),
    c.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // One reading per person per instant.
    c.measurements.createIndex({ userId: 1, measuredAt: -1 }, { unique: true }),
    c.rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // A Zepp reading is imported once, whoever it ends up assigned to.
    c.measurements.createIndex({ "zepp.key": 1 }, { unique: true, partialFilterExpression: { "zepp.key": { $exists: true } } }),
    c.measurements.createIndex({ "zepp.connectionId": 1, userId: 1 }, { partialFilterExpression: { "zepp.key": { $exists: true } } }),
    c.zeppConnections.createIndex({ ownerUserId: 1 }, { unique: true }),
    c.zeppMembers.createIndex({ connectionId: 1, memberId: 1 }, { unique: true }),
    // A person is linked to at most one Zepp member.
    c.zeppMembers.createIndex({ linkedUserId: 1 }, { unique: true, partialFilterExpression: { linkedUserId: { $type: "objectId" } } }),
    c.zeppMembers.createIndex({ inviteCodeHash: 1 }, { unique: true, partialFilterExpression: { inviteCodeHash: { $type: "string" } } }),
  ]);
}

/**
 * Serverless functions reuse a warm process between requests, so the client and the index
 * setup are cached at module level instead of being created per request.
 */
let cached: Promise<Collections> | undefined;

export function connect(uri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB ?? "caliche-balance"): Promise<Collections> {
  if (!uri) throw new Error("MONGODB_URI is not set");
  cached ??= (async () => {
    const client = await new MongoClient(uri).connect();
    const c = collections(client.db(dbName));
    await ensureIndexes(c);
    return c;
  })().catch((error) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
