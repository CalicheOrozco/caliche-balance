import { z } from "zod";

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
});

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

export interface UserDto {
  username: string;
  profile: ProfileDto | null;
}

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

