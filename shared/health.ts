import { z } from "zod";

/**
 * Daily data from Apple Health, sent by an iOS Shortcut. Apple Health has no web API: only an app
 * on the iPhone can read it, so the Shortcut reads the day's values and posts them here with the
 * person's own key. This table owns every metric: the API validates against it, the screens label
 * from it, and scripts/build-health-shortcut.ts builds the Shortcut's actions from it.
 */

export interface HealthMetricSpec {
  /** Health type exactly as the Shortcuts "Find Health Samples" menu names it. */
  type: string;
  /** Unit the value is kept in. Health sends the person's preferred unit, converted with UNIT_CONVERSIONS. */
  unit: HealthUnit;
  min: number;
  max: number;
  group: "activity" | "energy" | "heart" | "body";
}

/** Type names checked against the Shortcuts menu on iOS 26. */
export const HEALTH_METRIC_SPECS = {
  steps: { type: "Steps", unit: "count", min: 0, max: 200_000, group: "activity" },
  distanceKm: { type: "Walking + Running Distance", unit: "km", min: 0, max: 500, group: "activity" },
  flightsClimbed: { type: "Flights Climbed", unit: "count", min: 0, max: 2_000, group: "activity" },
  exerciseMin: { type: "Exercise Minutes", unit: "min", min: 0, max: 1_440, group: "activity" },
  standMin: { type: "Stand Minutes", unit: "min", min: 0, max: 1_440, group: "activity" },
  moveMin: { type: "Move Minutes", unit: "min", min: 0, max: 1_440, group: "activity" },
  mindfulMin: { type: "Mindful Minutes", unit: "min", min: 0, max: 1_440, group: "activity" },
  activeKcal: { type: "Active Energy", unit: "kcal", min: 0, max: 20_000, group: "energy" },
  restingKcal: { type: "Resting Energy", unit: "kcal", min: 0, max: 10_000, group: "energy" },
  restingHr: { type: "Resting Heart Rate", unit: "count/min", min: 20, max: 250, group: "heart" },
  hrvMs: { type: "Heart Rate Variability", unit: "ms", min: 1, max: 500, group: "heart" },
  walkingHr: { type: "Walking Heart Rate Average", unit: "count/min", min: 30, max: 250, group: "heart" },
  respiratoryRate: { type: "Respiratory Rate", unit: "count/min", min: 4, max: 60, group: "heart" },
  wristTempC: { type: "Wrist Temperature", unit: "degC", min: 20, max: 45, group: "body" },
  waterMl: { type: "Water", unit: "mL", min: 0, max: 20_000, group: "body" },
} as const satisfies Record<string, HealthMetricSpec>;

export type HealthMetric = keyof typeof HEALTH_METRIC_SPECS;
export const HEALTH_METRICS = Object.keys(HEALTH_METRIC_SPECS) as HealthMetric[];

/** Symptoms logged by hand in the Health app; the Shortcut sends the latest one. */
export const HEALTH_SYMPTOMS = { fatigue: "Fatigue", fever: "Fever", nausea: "Nausea", soreThroat: "Sore Throat" } as const;
export type HealthSymptom = keyof typeof HEALTH_SYMPTOMS;
export const HEALTH_SYMPTOM_KEYS = Object.keys(HEALTH_SYMPTOMS) as HealthSymptom[];
/** The JSON field a symptom arrives in, kept apart from the numeric metrics. */
export const symptomField = (s: HealthSymptom) => `symptom_${s}` as const;
/** The JSON field with the day a value belongs to, so the latest day with data can be sent any time. */
export const dateField = (field: string) => `${field}_date` as const;

/**
 * Reads a number as a Shortcut may send it: a JSON number, or text in the iPhone's region format
 * ("8,452", "8.452", "8 452", "1,935 kcal"). Units and spaces are dropped. With both "," and ".",
 * the last one is the decimal mark; one repeated mark separates thousands. A single mark followed
 * by exactly three digits could be either ("1,935" is 1935 in English and 1.935 in Spanish):
 * Shortcuts writes thousands with it, so that reading wins unless it falls outside the metric's
 * range, as "15.234" breaths a minute would, or starts with 0 ("0.045" seconds).
 */
export function parseHealthNumber(value: unknown, range: { min: number; max: number }): unknown {
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
    const thousands = Number(text.replace(mark, ""));
    const whole = text.slice(0, text.indexOf(mark)).replace("-", "");
    normalized = after === 3 && /^[1-9]/.test(whole) && thousands >= range.min && thousands <= range.max ? text.replace(mark, "") : text.replace(mark, ".");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : value;
}

export const KM_PER_MI = 1.609344;

export type HealthUnit = "count" | "km" | "min" | "kcal" | "count/min" | "ms" | "degC" | "mL";

/**
 * How to bring each unit Health may report into the metric's own unit. Shortcuts gives values in the
 * person's preferred units (the Health app's choice per type), so the Shortcut sends "<value> <unit>"
 * and the conversion happens here, once. Keys are lowercase without spaces or dots.
 */
const UNIT_CONVERSIONS: Record<HealthUnit, Record<string, (n: number) => number>> = {
  count: {},
  km: { km: (n) => n, mi: (n) => n * KM_PER_MI, m: (n) => n / 1000 },
  min: { min: (n) => n, h: (n) => n * 60, hr: (n) => n * 60, s: (n) => n / 60 },
  kcal: { kcal: (n) => n, cal: (n) => n, kj: (n) => n / 4.184 },
  "count/min": { "count/min": (n) => n, bpm: (n) => n, "count/s": (n) => n * 60 },
  ms: { ms: (n) => n, s: (n) => n * 1000 },
  degC: { degc: (n) => n, "°c": (n) => n, degf: (n) => ((n - 32) * 5) / 9, "°f": (n) => ((n - 32) * 5) / 9 },
  mL: { ml: (n) => n, l: (n) => n * 1000, fl_oz_us: (n) => n * 29.5735, floz: (n) => n * 29.5735, oz: (n) => n * 29.5735, cup_us: (n) => n * 236.588 },
};

/**
 * Reads "<number> <unit>" in the metric's unit. A unit that is missing, or not one this metric can
 * come in (like "count" for steps), leaves the number as is; the range check still applies.
 */
export function parseHealthValue(value: unknown, spec: Pick<HealthMetricSpec, "unit" | "min" | "max">): unknown {
  if (typeof value !== "string") return value;
  const match = /^\s*(-?[\d.,\s\u00a0\u202f]*\d)\s*(.*)$/.exec(value);
  if (!match) return value;
  const n = parseHealthNumber(match[1] ?? "", spec);
  if (typeof n !== "number") return value;
  const unit = (match[2] ?? "").toLowerCase().replace(/[\s.]/g, "");
  const convert = UNIT_CONVERSIONS[spec.unit][unit];
  return convert ? convert(n) : n;
}

/** A metric the Shortcut found no samples for arrives as empty text: that is "no data", not an error. */
const metric = (spec: HealthMetricSpec) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : parseHealthValue(v, spec)),
      z.number().min(spec.min).max(spec.max).nullable(),
    )
    .optional();

// ---- Sleep ----------------------------------------------------------------------------------

export type SleepStage = "inBed" | "awake" | "core" | "deep" | "rem" | "asleep";

export interface SleepSummary {
  /** Time asleep in any stage, overlaps between devices counted once. */
  asleepMin: number;
  inBedMin: number | null;
  deepMin: number | null;
  coreMin: number | null;
  remMin: number | null;
  awakeMin: number | null;
  /** Times awake between falling asleep and waking up. */
  awakenings: number;
  /** Fell asleep / woke up (ISO), from the asleep stages or, without them, time in bed. */
  start: string;
  end: string;
}

/** Sleep values as Health reports them, in English or Spanish. */
export function sleepStage(value: string): SleepStage | null {
  const v = value.trim().toLowerCase();
  if (/in bed|en cama/.test(v)) return "inBed";
  if (/awake|despiert/.test(v)) return "awake";
  if (/deep|profund/.test(v)) return "deep";
  if (/\brem\b/.test(v)) return "rem";
  if (/core|n[uú]cleo|b[aá]sico|ligero|light/.test(v)) return "core";
  if (/asleep|dormid|unspecified/.test(v)) return "asleep";
  return null;
}

type Interval = [number, number];

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const minutes = (intervals: Interval[]) => merge(intervals).reduce((sum, [s, e]) => sum + (e - s), 0) / 60_000;

/**
 * Adds up the night from the Shortcut's sleep samples, one per line as "start|end|value" with ISO
 * dates. An iPhone and an Apple Watch can record the same minutes, so every stage is a union of
 * intervals, never a plain sum. Lines that cannot be read are skipped.
 */
export function summarizeSleep(text: string): SleepSummary | null {
  const byStage = new Map<SleepStage, Interval[]>();
  for (const line of text.split(/\r?\n/)) {
    const [startText, endText, ...rest] = line.split("|");
    const stage = sleepStage(rest.join("|"));
    const start = Date.parse(startText?.trim() ?? "");
    const end = Date.parse(endText?.trim() ?? "");
    if (!stage || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    byStage.set(stage, [...(byStage.get(stage) ?? []), [start, end]]);
  }
  const get = (s: SleepStage) => byStage.get(s) ?? [];
  // The Watch's stages are the measurement; the iPhone's plain "Asleep" estimate would paper over
  // the awakenings the Watch recorded, so it only counts on nights without stages.
  const hasStages = get("core").length + get("deep").length + get("rem").length > 0;
  const asleep = hasStages ? [...get("core"), ...get("deep"), ...get("rem")] : get("asleep");
  const span = asleep.length ? asleep : get("inBed");
  if (span.length === 0) return null;
  const start = Math.min(...span.map((i) => i[0]));
  const end = Math.max(...span.map((i) => i[1]));
  const stageMin = (s: SleepStage) => (hasStages ? Math.round(minutes(get(s))) : null);
  const awakenings = merge(get("awake")).filter(([s, e]) => s > start && e < end).length;
  return {
    asleepMin: Math.round(minutes(asleep)),
    inBedMin: get("inBed").length ? Math.round(minutes(get("inBed"))) : null,
    deepMin: stageMin("deep"),
    coreMin: stageMin("core"),
    remMin: stageMin("rem"),
    awakeMin: get("awake").length ? Math.round(minutes(get("awake"))) : hasStages ? 0 : null,
    awakenings,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}

// ---- Input --------------------------------------------------------------------------------

const metricShape = Object.fromEntries(HEALTH_METRICS.map((m) => [m, metric(HEALTH_METRIC_SPECS[m])])) as {
  [K in HealthMetric]: ReturnType<typeof metric>;
};
const symptomShape = Object.fromEntries(
  HEALTH_SYMPTOM_KEYS.map((s) => [symptomField(s), z.string().max(40).nullable().optional()]),
) as { [K in HealthSymptom as `symptom_${K}`]: z.ZodOptional<z.ZodNullable<z.ZodString>> };

/** Symptom values that mean it was not there. */
const NOT_PRESENT = /^(|not present|no presente|ausente)$/i;

/**
 * One day. The date is the person's local day; left out, it is today in their time zone. Values may
 * carry their unit ("3.1 mi"), which is converted to the metric's own.
 */
export const healthDaySchema = z
  .object({
    date: z.iso.date().optional(),
    ...metricShape,
    /** Sleep samples as "start|end|value" lines. */
    sleep: z.string().max(200_000).nullable().optional(),
    ...symptomShape,
  })
  .transform(({ sleep, ...rest }) => {
    const values = Object.fromEntries(HEALTH_METRICS.filter((m) => rest[m] !== undefined).map((m) => [m, rest[m]])) as Partial<Record<HealthMetric, number | null>>;
    const symptoms = Object.fromEntries(
      HEALTH_SYMPTOM_KEYS.flatMap((s) => {
        const v = rest[symptomField(s)]?.trim() ?? "";
        return NOT_PRESENT.test(v) ? [] : [[s, v]];
      }),
    ) as Partial<Record<HealthSymptom, string>>;
    return {
      date: rest.date,
      values,
      sleep: typeof sleep === "string" && sleep.trim() ? summarizeSleep(sleep) : undefined,
      symptoms,
    };
  })
  .refine(
    (d) => Object.values(d.values).some((v) => v !== null && v !== undefined) || d.sleep || Object.keys(d.symptoms).length > 0,
    { message: "health-empty" },
  );

/** "2026-10-19T00:00:00-06:00" from the Shortcut is already in the iPhone's time zone: its date part is the day. */
const shortcutDay = (value: unknown) => (typeof value === "string" ? /^\d{4}-\d{2}-\d{2}/.exec(value.trim())?.[0] : undefined);
const isEmpty = (value: unknown) => value === null || (typeof value === "string" && value.trim() === "");

/**
 * The Shortcut sends each value with the day it belongs to ("steps_date"), because right after
 * midnight, or for something logged days ago, the latest data is not today's. Values are grouped
 * into one day each; without a date they go to "date" or today. Values with no data, and fields
 * that are not data (like "shortcutVersion"), are skipped.
 */
const DATA_FIELDS = new Set<string>([...HEALTH_METRICS, ...HEALTH_SYMPTOM_KEYS.map(symptomField), "sleep"]);

function splitByDate(body: Record<string, unknown>): Record<string, unknown>[] {
  const days = new Map<string, Record<string, unknown>>();
  for (const [key, value] of Object.entries(body)) {
    if (!DATA_FIELDS.has(key) || isEmpty(value)) continue;
    const date = shortcutDay(body[dateField(key)]) ?? body.date;
    const id = typeof date === "string" ? date : "";
    const day = days.get(id) ?? (date === undefined ? {} : { date });
    day[key] = value;
    days.set(id, day);
  }
  return days.size ? [...days.values()] : [body.date === undefined ? {} : { date: body.date }];
}

/**
 * A single day, or several at once as { days: [...] } (to fill in days the Shortcut missed). A single
 * day is read as a list of one, so its own errors (like "health-empty") reach the Shortcut as is.
 */
export const healthIngestSchema = z.preprocess(
  (body) => (body !== null && typeof body === "object" && !Array.isArray(body) ? ("days" in body ? body : { days: splitByDate(body as Record<string, unknown>) }) : { days: [body] }),
  z.object({ days: z.array(healthDaySchema).min(1).max(31) }),
);
export type HealthDayInput = z.output<typeof healthDaySchema>;

/** The Shortcut's version, sent as text; anything else reads as an old copy. */
export function shortcutVersionOf(body: unknown): number | null {
  const raw = body !== null && typeof body === "object" ? (body as Record<string, unknown>).shortcutVersion : undefined;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---- Output -------------------------------------------------------------------------------

export type HealthDayDto = { date: string; sleep: SleepSummary | null; symptoms: Partial<Record<HealthSymptom, string>> } & Record<
  HealthMetric,
  number | null
>;

/**
 * Version of the Shortcut in public/shortcuts, sent with every run so Settings can tell an old copy
 * from the current one. Bump it whenever scripts/build-health-shortcut.ts changes what it sends.
 * Copies from before versions existed send none.
 */
export const HEALTH_SHORTCUT_VERSION = 4;

/** A problem with one field of a run, with what the Shortcut sent for it. */
export interface HealthProblem {
  path: string;
  code: string;
  received?: string | number;
}

/** What the last run of the Shortcut sent and what came of it. */
export interface HealthAttempt {
  at: string;
  /** null for copies of the Shortcut from before versions existed. */
  version: number | null;
  ok: boolean;
  /** Days saved and how many values each one got. */
  saved: { date: string; count: number }[];
  problems: HealthProblem[];
}

/** The person's key, shown once when made; only when it was made and what arrived last are kept. */
export interface AppleHealthStatus {
  since: string;
  lastSyncAt: string | null;
  lastAttempt: HealthAttempt | null;
}

/** Averages over the given days, skipping days without that metric. */
export function healthAverages(days: HealthDayDto[]): Record<HealthMetric | "sleepMin", number | null> {
  const avg = (values: (number | null | undefined)[]) => {
    const present = values.filter((v): v is number => typeof v === "number");
    return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
  };
  return {
    ...(Object.fromEntries(HEALTH_METRICS.map((m) => [m, avg(days.map((d) => d[m]))])) as Record<HealthMetric, number | null>),
    sleepMin: avg(days.map((d) => d.sleep?.asleepMin)),
  };
}
