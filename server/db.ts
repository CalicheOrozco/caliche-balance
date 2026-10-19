import { type Collection, type Db, MongoClient, type ObjectId } from "mongodb";
import type { BodyFatGoal, MaintainGoal, ProfileDto, WeightGoal } from "../shared/schemas.ts";

export interface UserDoc {
  _id: ObjectId;
  username: string;
  passwordHash: string;
  recoveryHash: string;
  profile: (Omit<ProfileDto, "displayName"> & { displayName: string | null }) | null;
  /** Which notifications the person wants; missing means on. */
  notifications?: { newWeighIn: boolean; zepp: boolean; goals?: boolean };
  /** reachedAt and maintain are missing on goals saved before they existed: read them as null. */
  goals?: {
    weight: (Omit<WeightGoal, "setAt" | "reachedAt"> & { setAt: Date; reachedAt?: Date | null }) | null;
    bodyFat: (Omit<BodyFatGoal, "setAt" | "reachedAt"> & { setAt: Date; reachedAt?: Date | null }) | null;
    maintain?: (Omit<MaintainGoal, "setAt"> & { setAt: Date }) | null;
  };
  /** IANA time zone the app last reported; days, weeks and streaks are counted in it. */
  timeZone?: string;
  /** Badge levels last seen by the server, to notice when one goes up; missing until the first check. */
  badgeLevels?: Record<string, number>;
  /** Every goal reached, appended once when it happens; missing means none yet. */
  goalHistory?: { kind: "weight" | "bodyFat"; target: number; setAt: Date; reachedAt: Date }[];
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
  waistCm?: number | null;
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

export interface PushSubscriptionDoc {
  _id: ObjectId;
  userId: ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
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
  pushSubscriptions: Collection<PushSubscriptionDoc>;
}

export function collections(db: Db): Collections {
  return {
    users: db.collection("users"),
    sessions: db.collection("sessions"),
    measurements: db.collection("measurements"),
    rateLimits: db.collection("rateLimits"),
    zeppConnections: db.collection("zeppConnections"),
    zeppMembers: db.collection("zeppMembers"),
    pushSubscriptions: db.collection("pushSubscriptions"),
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
    c.pushSubscriptions.createIndex({ endpoint: 1 }, { unique: true }),
    c.pushSubscriptions.createIndex({ userId: 1 }),
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
