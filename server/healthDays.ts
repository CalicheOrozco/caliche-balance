import { z } from "zod";
import { HEALTH_METRIC_SPECS, HEALTH_METRICS, HEALTH_SYMPTOM_KEYS, type HealthDayInput, healthDaySchema, symptomField } from "../shared/health.ts";

/*
 * Days of Apple Health data as Claude sends them (add_health_days) or as a file made from the
 * Health export (scripts/import-health-days.ts): plain numbers per metric, sleep samples as
 * objects. They are turned into what the Shortcut sends and read by the same schema, so they are
 * checked and summed exactly like the Shortcut's.
 */

/** Every Apple Health metric the app keeps, with its unit and whether a day is a total or an average. */
const healthMetricShape = Object.fromEntries(
  HEALTH_METRICS.map((m) => {
    const spec = HEALTH_METRIC_SPECS[m];
    const per = spec.kind === "sum" ? "total of the day" : "average of the day";
    return [m, z.number().min(spec.min).max(spec.max).optional().describe(`Apple Health "${spec.type}", ${spec.unit}, ${per}`)];
  }),
) as Record<(typeof HEALTH_METRICS)[number], z.ZodOptional<z.ZodNumber>>;

const SLEEP_STAGE_TEXT = { inBed: "In Bed", awake: "Awake", core: "Core", deep: "Deep", rem: "REM", asleep: "Asleep" } as const;

export const healthDayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").describe("The local day, YYYY-MM-DD. A night goes on the day the person woke up"),
  ...healthMetricShape,
  sleep: z
    .array(
      z.object({
        start: z.string().describe("ISO 8601 with offset"),
        end: z.string().describe("ISO 8601 with offset"),
        stage: z.enum(["inBed", "awake", "core", "deep", "rem", "asleep"]).describe("asleep when the source has no stages (older iPhones)"),
      }),
    )
    .max(400)
    .optional()
    .describe("The night's sleep samples (HKCategoryTypeIdentifierSleepAnalysis), every source; overlaps between iPhone and Watch are counted once"),
  symptoms: z
    .object(Object.fromEntries(HEALTH_SYMPTOM_KEYS.map((s) => [s, z.string().max(40).optional()])) as Record<(typeof HEALTH_SYMPTOM_KEYS)[number], z.ZodOptional<z.ZodString>>)
    .optional()
    .describe("Symptoms logged that day, with their severity as Health shows it"),
});

export type HealthDayInputJson = z.infer<typeof healthDayInput>;

/** Each day read as the Shortcut's would be; a day that cannot be read is skipped with the reason. */
export function readHealthDaysInput(days: HealthDayInputJson[]): {
  parsed: (HealthDayInput & { date: string })[];
  skipped: { date: string; reason: string }[];
} {
  const parsed: (HealthDayInput & { date: string })[] = [];
  const skipped: { date: string; reason: string }[] = [];
  for (const day of days) {
    const raw: Record<string, unknown> = { date: day.date };
    for (const m of HEALTH_METRICS) if (day[m] !== undefined) raw[m] = day[m];
    if (day.sleep?.length) raw.sleep = day.sleep.map((s) => `${s.start}|${s.end}|${SLEEP_STAGE_TEXT[s.stage]}`).join("\n");
    for (const s of HEALTH_SYMPTOM_KEYS) if (day.symptoms?.[s]) raw[symptomField(s)] = day.symptoms[s];
    const result = healthDaySchema.safeParse(raw);
    if (result.success) parsed.push({ ...result.data, date: day.date });
    else skipped.push({ date: day.date, reason: result.error.issues.map((i) => `${i.path.join(".") || "day"}: ${i.message}`).join("; ") });
  }
  return { parsed, skipped };
}
