import { type Collection, type Db, MongoClient, type ObjectId } from "mongodb";
import type { FoodSource, Meal } from "../shared/food.ts";
import type { LabResult } from "../shared/labs.ts";
import type { HealthAttempt, HealthMetric, HealthSymptom, SleepSummary } from "../shared/health.ts";
import type { BodyFatGoal, MaintainGoal, ProfileDto, RewardKind, WeightGoal } from "../shared/schemas.ts";

export interface UserDoc {
  _id: ObjectId;
  username: string;
  passwordHash: string;
  recoveryHash: string;
  profile: (Omit<ProfileDto, "displayName"> & { displayName: string | null }) | null;
  /** Which notifications the person wants; missing means on. */
  notifications?: { newWeighIn: boolean; zepp: boolean; goals?: boolean; streak?: boolean };
  /** `days` alone is a streak reward saved before weight and body fat rewards existed. */
  streakReward?: { text: string; kind?: RewardKind; target?: number; start?: number | null; days?: number; setAt: Date; earnedAt: Date | null } | null;
  /** Streak length last announced (record near, tied or beaten), so each is told once. */
  streakNudged?: number;
  /** Local day (YYYY-MM-DD) of the last evening reminder, so it goes out at most once a day. */
  streakReminderDay?: string;
  /** reachedAt and maintain are missing on goals saved before they existed: read them as null. */
  goals?: {
    weight: (Omit<WeightGoal, "setAt" | "reachedAt"> & { setAt: Date; reachedAt?: Date | null }) | null;
    bodyFat: (Omit<BodyFatGoal, "setAt" | "reachedAt"> & { setAt: Date; reachedAt?: Date | null }) | null;
    maintain?: (Omit<MaintainGoal, "setAt"> & { setAt: Date }) | null;
  };
  /** Apple Health via the iOS Shortcut: only the hash of the person's key is kept. */
  appleHealth?: { keyHash: string; since: Date; lastSyncAt: Date | null; lastAttempt?: Omit<HealthAttempt, "at"> & { at: Date } };
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
  /** A short note the person wrote about this weigh-in (Add > Note). */
  note?: string | null;
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
  status: "ok" | "invalid-token" | "misconfigured" | "error";
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

/** One local day of Apple Health data; each value is missing until the Shortcut sends it. */
export type HealthDayDoc = {
  _id: ObjectId;
  userId: ObjectId;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** The night that ended this day. */
  sleep?: SleepSummary | null;
  symptoms?: Partial<Record<HealthSymptom, string>>;
  updatedAt: Date;
} & Partial<Record<HealthMetric, number | null>>;

/** One lab study (blood and urine tests) with every result as the lab printed it. */
export interface LabStudyDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** The day the samples were taken, YYYY-MM-DD. */
  takenAt: string;
  lab: string;
  results: LabResult[];
  createdAt: Date;
}

/** One food or dish eaten, with its calories and the macronutrients that are known. */
export interface FoodEntryDoc {
  _id: ObjectId;
  userId: ObjectId;
  /** The person's local day, YYYY-MM-DD. */
  date: string;
  time: string | null;
  meal: Meal;
  name: string;
  amount: string | null;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  note: string | null;
  source: FoodSource;
  createdAt: Date;
}

/** A client Claude registered for the MCP connector (OAuth Dynamic Client Registration). */
export interface OAuthClientDoc {
  client_id: string;
  redirect_uris: string[];
  client_name?: string;
  [field: string]: unknown;
  createdAt: Date;
  /** Clients nobody signs in with for 90 days are removed. */
  expiresAt: Date;
}

/** A single-use sign-in code, stored as a hash, waiting to be exchanged for tokens. */
export interface OAuthCodeDoc {
  hash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  userId: ObjectId;
  expiresAt: Date;
}

/** An MCP access or refresh token, stored as a hash. Tokens from one sign-in share a family. */
export interface OAuthTokenDoc {
  hash: string;
  kind: "access" | "refresh";
  clientId: string;
  userId: ObjectId;
  scopes: string[];
  resource?: string;
  family: string;
  used?: boolean;
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
  healthDays: Collection<HealthDayDoc>;
  labStudies: Collection<LabStudyDoc>;
  foodEntries: Collection<FoodEntryDoc>;
  oauthClients: Collection<OAuthClientDoc>;
  oauthCodes: Collection<OAuthCodeDoc>;
  oauthTokens: Collection<OAuthTokenDoc>;
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
    healthDays: db.collection("healthDays"),
    labStudies: db.collection("labStudies"),
    foodEntries: db.collection("foodEntries"),
    oauthClients: db.collection("oauthClients"),
    oauthCodes: db.collection("oauthCodes"),
    oauthTokens: db.collection("oauthTokens"),
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
    // One row per person per local day; the Shortcut's key is looked up by its hash.
    c.healthDays.createIndex({ userId: 1, date: 1 }, { unique: true }),
    c.labStudies.createIndex({ userId: 1, takenAt: -1 }),
    c.foodEntries.createIndex({ userId: 1, date: -1, time: 1 }),
    // The MCP connector's sign-in: everything expires on its own.
    c.oauthClients.createIndex({ client_id: 1 }, { unique: true }),
    c.oauthClients.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.oauthCodes.createIndex({ hash: 1 }, { unique: true }),
    c.oauthCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.oauthTokens.createIndex({ hash: 1 }, { unique: true }),
    c.oauthTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.oauthTokens.createIndex({ family: 1 }),
    c.oauthTokens.createIndex({ userId: 1 }),
    c.users.createIndex({ "appleHealth.keyHash": 1 }, { unique: true, partialFilterExpression: { "appleHealth.keyHash": { $type: "string" } } }),
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
