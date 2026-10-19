import { z } from "zod";

/**
 * Daily activity from Apple Health, sent by an iOS Shortcut. Apple Health has no web API: only an
 * app on the iPhone can read it, so the Shortcut reads the day's totals and posts them here with
 * the person's own key.
 */

export const HEALTH_METRICS = ["steps", "activeKcal", "exerciseMin", "distanceKm", "restingHr", "sleepHours"] as const;
export type HealthMetric = (typeof HEALTH_METRICS)[number];

/** Whole-number metrics: a single "," or "." followed by three digits is a thousands separator. */
const WHOLE: ReadonlySet<HealthMetric> = new Set(["steps", "exerciseMin", "restingHr"]);

/**
 * Reads a number as a Shortcut may send it: a JSON number, or text in the iPhone's region format
 * ("8,452", "8.452", "8 452", "512,4 kcal"). Units and spaces are dropped. With both "," and ".",
 * the last one is the decimal mark; one repeated mark separates thousands; a single mark is
 * decimal, except in whole-number metrics when exactly three digits follow it.
 */
export function parseHealthNumber(value: unknown, whole: boolean): unknown {
  if (typeof value !== "string") return value;
  const text = value.replace(/[\s  ]/g, "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(text)) return value;
  const commas = text.split(",").length - 1;
  const dots = text.split(".").length - 1;
  let normalized = text;
  if (commas > 0 && dots > 0) {
    const decimal = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    normalized = text.split(grouping).join("").replace(decimal, ".");
  } else if (commas + dots > 1) {
    normalized = text.replace(/[.,]/g, "");
  } else if (commas + dots === 1) {
    const mark = commas ? "," : ".";
    const after = text.length - text.indexOf(mark) - 1;
    normalized = whole && after === 3 ? text.replace(mark, "") : text.replace(mark, ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : value;
}

/** A metric the Shortcut found no samples for arrives as empty text: that is "no data", not an error. */
const metric = (name: HealthMetric, min: number, max: number) =>
  z
    .preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : parseHealthNumber(v, WHOLE.has(name))), z.number().min(min).max(max).nullable())
    .optional();

export const KM_PER_MI = 1.609344;

/**
 * One day of activity. The date is the person's local day; left out, it is today in their time zone.
 * The Shortcut sends distance in the unit the iPhone uses; "mi" is converted to kilometers here.
 */
export const healthDaySchema = z
  .object({
    date: z.iso.date().optional(),
    distanceUnit: z.enum(["km", "mi"]).optional(),
    steps: metric("steps", 0, 200_000),
    activeKcal: metric("activeKcal", 0, 20_000),
    exerciseMin: metric("exerciseMin", 0, 1_440),
    distanceKm: metric("distanceKm", 0, 500),
    restingHr: metric("restingHr", 20, 250),
    sleepHours: metric("sleepHours", 0, 24),
  })
  .refine((d) => HEALTH_METRICS.some((m) => d[m] !== undefined && d[m] !== null), { message: "health-empty" })
  .transform(({ distanceUnit, ...day }) =>
    distanceUnit === "mi" && typeof day.distanceKm === "number" ? { ...day, distanceKm: day.distanceKm * KM_PER_MI } : day,
  );

/**
 * A single day, or several at once as { days: [...] } (to fill in days the Shortcut missed). A single
 * day is read as a list of one, so its own errors (like "health-empty") reach the Shortcut as is.
 */
export const healthIngestSchema = z.preprocess(
  (body) => (body !== null && typeof body === "object" && "days" in body ? body : { days: [body] }),
  z.object({ days: z.array(healthDaySchema).min(1).max(31) }),
);
export type HealthDayInput = z.output<typeof healthDaySchema>;

export interface HealthDayDto {
  date: string;
  steps: number | null;
  activeKcal: number | null;
  exerciseMin: number | null;
  distanceKm: number | null;
  restingHr: number | null;
  sleepHours: number | null;
}

/** The person's key, shown once when made; only when it was made and when data last arrived are kept. */
export interface AppleHealthStatus {
  since: string;
  lastSyncAt: string | null;
}

/** Averages over the given days, skipping days without that metric. */
export function healthAverages(days: HealthDayDto[]): Record<HealthMetric, number | null> {
  return Object.fromEntries(
    HEALTH_METRICS.map((m) => {
      const values = days.map((d) => d[m]).filter((v): v is number => v !== null);
      return [m, values.length ? values.reduce((a, b) => a + b, 0) / values.length : null];
    }),
  ) as Record<HealthMetric, number | null>;
}
