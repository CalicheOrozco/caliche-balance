import { z } from "zod";
import type { AppleHealthStatus } from "./health.ts";

/** Request contracts shared by the API (validation) and the web app (forms). */

export const LB_PER_KG = 2.2046226218;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,32}$/, "username");

export const credentialsSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8, "password-length").max(200, "password-length"),
});

export const languageSchema = z.enum(["es", "en"]);
export const unitSchema = z.enum(["kg", "lb"]);

export const profileSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  sex: z.enum(["male", "female"]),
  birthDate: z.iso.date(),
  heightCm: z.number().min(100).max(250),
  language: languageSchema,
  unit: unitSchema,
});

/**
 * Reads a number typed as text, including a decimal comma ("74,5") as iPhones in Spanish
 * produce. Non-text values pass through so the schema reports them.
 */
export function parseDecimal(v: unknown): unknown {
  return typeof v === "string" && v.trim() !== "" ? Number(v.trim().replace(",", ".")) : v;
}

const numeric = (schema: z.ZodNumber) => z.preprocess(parseDecimal, schema);

const optionalNumber = (min: number, max: number) => numeric(z.number().min(min).max(max)).nullable().optional();

/** One reading typed by hand. Weight comes in the person's unit; the API stores kilograms. */
export const measurementInputSchema = z.object({
  measuredAt: z.iso.datetime({ offset: true }).optional(),
  weight: numeric(z.number().positive().max(700)),
  weightUnit: unitSchema.default("kg"),
  bodyFatPct: optionalNumber(2, 75),
  // Values only the Xiaomi app computes; stored and shown, never reinterpreted.
  muscleKg: optionalNumber(5, 150),
  waterPct: optionalNumber(20, 80),
  boneKg: optionalNumber(0.5, 10),
  visceralFat: optionalNumber(1, 60),
  // Measured with a tape; in the person's preferred length unit.
  waist: optionalNumber(15, 250),
  waistUnit: z.enum(["cm", "in"]).default("cm"),
});

/** Adds, changes or removes (null) the waist of a reading that already exists. */
export const waistInputSchema = z.object({
  waist: numeric(z.number().min(15).max(250)).nullable(),
  waistUnit: z.enum(["cm", "in"]).default("cm"),
});

export const CM_PER_IN = 2.54;

export function waistToCm(value: number, unit: "cm" | "in"): number {
  return unit === "in" ? value * CM_PER_IN : value;
}

export type Credentials = z.infer<typeof credentialsSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type MeasurementInput = z.input<typeof measurementInputSchema>;

export function toKilograms(weight: number, unit: "kg" | "lb"): number {
  return unit === "lb" ? weight / LB_PER_KG : weight;
}

export function fromKilograms(weightKg: number, unit: "kg" | "lb"): number {
  return unit === "lb" ? weightKg * LB_PER_KG : weightKg;
}

/** Shapes the API returns. */
export interface ProfileDto {
  displayName: string | null;
  sex: "male" | "female";
  birthDate: string;
  heightCm: number;
  language: "es" | "en";
  unit: "kg" | "lb";
}

export interface WeightGoal {
  targetKg: number;
  /** Weight when the goal was set; null if there were no readings yet. */
  startKg: number | null;
  setAt: string;
  /** Date of the first weigh-in that reached the target; kept even if the weight moves back. */
  reachedAt: string | null;
}

export interface BodyFatGoal {
  targetPct: number;
  startPct: number | null;
  setAt: string;
  reachedAt: string | null;
}

/** Keep the weight within 3 % of a value instead of moving toward a target. */
export interface MaintainGoal {
  centerKg: number;
  minKg: number;
  maxKg: number;
  setAt: string;
  /** Where the latest weigh-in is relative to the range; alerts fire when this changes to outside. */
  outside: "above" | "below" | null;
}

export interface GoalsDto {
  /** A weight target and maintenance are alternatives: at most one of them is set. */
  weight: WeightGoal | null;
  bodyFat: BodyFatGoal | null;
  maintain: MaintainGoal | null;
}

/** A goal that was reached, kept after the goal is replaced so badges never disappear. */
export interface GoalHistoryEntry {
  kind: "weight" | "bodyFat";
  target: number;
  setAt: string;
  reachedAt: string;
}

export interface NotificationPrefs {
  newWeighIn: boolean;
  zepp: boolean;
  /** Goals reached and leaving the maintenance range. */
  goals: boolean;
  /** Evening reminder before a streak ends, and records near, tied or beaten. */
  streak: boolean;
}

/** A reward the person picks for reaching a streak length. */
export interface StreakReward {
  text: string;
  days: number;
  setAt: string;
  earnedAt: string | null;
}

export const streakRewardSchema = z.object({
  text: z.string().trim().min(1).max(60),
  days: z.coerce.number().int().min(2).max(1000),
});

export interface UserDto {
  username: string;
  profile: ProfileDto | null;
  goals: GoalsDto;
  goalHistory: GoalHistoryEntry[];
  streakReward: StreakReward | null;
  /** Null until the person makes a key for the Apple Health Shortcut. */
  appleHealth: AppleHealthStatus | null;
  notifications: NotificationPrefs;
}

/** What a browser's PushManager returns, as sent to the API. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

export const notificationPrefsSchema = z.object({
  newWeighIn: z.boolean(),
  zepp: z.boolean(),
  goals: z.boolean().default(true),
  streak: z.boolean().default(true),
});

const weightInput = z.object({ value: numeric(z.number().min(30).max(660)), unit: unitSchema });

/**
 * Each goal is optional; null removes it. Weight comes in the person's unit. Maintenance left out
 * keeps the current one; a weight target and maintenance cannot both be set.
 */
export const goalsInputSchema = z
  .object({
    weight: weightInput.nullable(),
    bodyFatPct: numeric(z.number().min(3).max(60)).nullable(),
    maintain: weightInput.nullable().optional(),
  })
  .refine((g) => !(g.weight && g.maintain), { message: "goal-conflict", path: ["maintain"] });
export type GoalsInput = z.input<typeof goalsInputSchema>;

export interface MeasurementDto {
  id: string;
  measuredAt: string;
  weightKg: number;
  bodyFatPct: number | null;
  muscleKg: number | null;
  waterPct: number | null;
  boneKg: number | null;
  visceralFat: number | null;
  proteinPct: number | null;
  bmrKcal: number | null;
  bodyAge: number | null;
  bodyScore: number | null;
  impedance: number | null;
  idealWeightKg: number | null;
  waistCm: number | null;
  source: "manual" | "zepp";
}

export interface ZeppMemberDto {
  memberId: string;
  nickname: string | null;
  linkedUsername: string | null;
  invitePending: boolean;
  unassignedCount: number;
}

/** What a person sees about the household Zepp connection they own or belong to. */
export interface ZeppStatusDto {
  role: "owner" | "member" | "none";
  status: "ok" | "invalid-token" | "error" | null;
  lastError: string | null;
  lastSyncAt: string | null;
  /** Only the owner gets the member list. */
  members: ZeppMemberDto[];
  ownerUsername: string | null;
}

export const zeppConnectSchema = z.object({
  appToken: z.string().trim().min(10).max(4000),
  zeppUserId: z.string().trim().regex(/^\d{3,20}$/, "zepp-user-id"),
});

export const joinCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });

