import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { metabolicAge } from "../../shared/bodyAge.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { dailyTrend, estimateEta, goalProgress } from "../../shared/goals.ts";
import { assess as assessLab, egfr, identify, type LabResult, labStudyInputSchema, labTest, nextStudyDue, nonHdl } from "../../shared/labs.ts";
import { ageAt, bmi, healthyWeightRange } from "../../shared/reference.ts";
import { readingReport, recentChanges } from "../../shared/report.ts";
import { type MeasurementDto, type ProfileDto, waistToCm } from "../../shared/schemas.ts";
import { periodReport, trendNow, weightTrend } from "../../shared/trend.ts";
import { labsCopy } from "../../src/copy/labs.ts";
import { achievementsFor } from "../achievementCheck.ts";
import { toHealthDayDto } from "../appleHealthRoutes.ts";
import type { Collections, LabStudyDoc, UserDoc } from "../db.ts";
import { toMeasurementDto } from "../http.ts";
import type { PushSender } from "../push.ts";
import { createMeasurement, saveGoals, saveLabStudy, setNote, setWaist } from "../services.ts";

/*
 * The tools Claude can use, signed in as the person (see oauth.ts). Reads return the same numbers
 * the app shows: body fat from the foot-to-foot equation, metabolic age, the reading report and
 * the lab assessment, all from shared/. Writes go through server/services.ts, like the app's API.
 * Weights and lengths are metric (kg, cm); the profile says which unit the person prefers.
 */

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Use an id returned by a list tool");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");
const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

class ToolProblem extends Error {}

interface Context {
  c: Collections;
  user: UserDoc;
  profile: ProfileDto;
  lang: "es" | "en";
}

function birth(profile: ProfileDto) {
  return new Date(`${profile.birthDate}T00:00:00Z`);
}

/** One weigh-in as the app shows it: our recalculation next to Xiaomi's values. */
function presentWeighIn(profile: ProfileDto, m: MeasurementDto) {
  const comp = compositionOf(profile, m);
  const fat = bodyFatOf(profile, m);
  const age = ageAt(birth(profile), new Date(m.measuredAt));
  const metabolic = fat ? metabolicAge({ fatPct: fat.value, weightKg: m.weightKg, age, sex: profile.sex }) : null;
  const x = xiaomiComparable(m);
  return {
    id: m.id,
    measuredAt: m.measuredAt,
    source: m.source,
    weightKg: r2(m.weightKg),
    bmi: r1(bmi(m.weightKg, profile.heightCm)),
    bodyFat: fat ? { pct: r1(fat.value), source: fat.source === "north-america" ? "caliche-foot-to-foot-equation" : "xiaomi" } : null,
    composition: comp
      ? {
          fatMassKg: r1(comp.fatMassKg),
          fatFreeMassKg: r1(comp.fatFreeMassKg),
          leanSoftKg: r1(comp.leanSoftKg),
          skeletalMuscleKg: r1(comp.skeletalMuscleKg),
          skeletalMuscleIndex: r2(comp.skeletalMuscleIndex),
          bodyWaterPct: r1(comp.bodyWaterPct),
          basalMetabolismKcal: Math.round(comp.bmrKcal),
          proteinPctExperimental: r1(comp.proteinPct),
        }
      : null,
    metabolicAge: metabolic ? (metabolic.kind === "age" ? metabolic.age : metabolic.kind === "over" ? `${metabolic.age}+` : `<${metabolic.age}`) : null,
    xiaomi: {
      bodyFatPct: x.bodyFatPct,
      muscleKg: x.muscleKg,
      waterPct: x.bodyWaterPct,
      boneKg: m.boneKg,
      visceralFat: m.visceralFat,
      basalMetabolismKcal: x.bmrKcal,
      proteinPct: x.proteinPct,
      bodyAge: m.bodyAge,
      score: m.bodyScore,
    },
    impedanceOhm: m.impedance,
    waistCm: m.waistCm,
    note: m.note ?? null,
  };
}

/** The full report of one weigh-in: every rated measure with its band, the score, and changes. */
function presentReport(profile: ProfileDto, m: MeasurementDto, all: MeasurementDto[]) {
  const report = readingReport(profile, m, all);
  return {
    ...presentWeighIn(profile, m),
    age: report.age,
    rated: report.items.map((i) => ({
      measure: i.key,
      value: r2(i.value),
      band: i.band.key,
      status: i.band.status,
      toHealthy: r1(i.toHealthy),
      bands: i.bands.map((b) => ({ band: b.key, min: b.min, max: b.max, status: b.status })),
    })),
    healthyBodyFatRange: report.fatRange,
    waistUsed: report.waist,
    calicheScore: { score: report.score.score, parts: report.score.parts.map((p) => ({ part: p.part, value: r2(p.value), score: Math.round(p.score), weight: p.weight })) },
    changes: recentChanges(profile, m, all).map((ch) => ({
      measure: ch.key,
      vsMonthAgo: ch.vsMonth ? { delta: r2(ch.vsMonth.delta), since: ch.vsMonth.measuredAt } : null,
      vsFirst: ch.vsFirst ? { delta: r2(ch.vsFirst.delta), since: ch.vsFirst.measuredAt } : null,
    })),
  };
}

async function measurementsOf(ctx: Context): Promise<MeasurementDto[]> {
  const docs = await ctx.c.measurements.find({ userId: ctx.user._id }).sort({ measuredAt: -1 }).limit(5000).toArray();
  return docs.map(toMeasurementDto);
}

function fill(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** A lab study with every result judged, in the person's language. */
function presentLab(ctx: Context, s: LabStudyDoc, previous: LabStudyDoc | null) {
  const person = { sex: ctx.profile.sex, age: ageAt(birth(ctx.profile), new Date(`${s.takenAt}T12:00:00Z`)) };
  const copy = labsCopy[ctx.lang] as Record<string, string>;
  const results = s.results.map((r) => {
    const a = assessLab(r, person);
    const before = previous?.results.find((p) => p.key === r.key);
    return {
      key: r.key,
      name: labTest(r.key)?.[ctx.lang] ?? r.name,
      group: r.group,
      value: r.value ?? r.text,
      unit: r.unit,
      labRange: r.ref,
      labFlagged: r.flagged,
      status: a.status,
      explanation: a.note ? fill(copy[`lab.note.${a.note}`] ?? "", a.vars) : null,
      source: a.source,
      previous: before ? { value: before.value ?? before.text, takenAt: previous!.takenAt } : null,
    };
  });
  const creatinine = s.results.find((r) => r.key === "creatinine")?.value ?? null;
  return {
    id: s._id.toHexString(),
    takenAt: s.takenAt,
    lab: s.lab,
    counts: {
      good: results.filter((r) => r.status === "good").length,
      warn: results.filter((r) => r.status === "warn").length,
      bad: results.filter((r) => r.status === "bad").length,
    },
    computed: {
      egfrMlMin: creatinine !== null ? Math.round(egfr(creatinine, person)) : null,
      nonHdlMgDl: r1(nonHdl(s.results)),
    },
    nextStudyDue: nextStudyDue(s.takenAt),
    results,
    disclaimer: copy["labs.disclaimer"],
  };
}

const weighInSchema = {
  weight: z.number().positive().max(700).describe("Body weight"),
  unit: z.enum(["kg", "lb"]).optional().describe("Unit of weight, muscle and bone; defaults to the person's unit"),
  measuredAt: z.string().optional().describe("When it was taken, ISO 8601 with offset (e.g. 2026-11-08T07:30:00-04:00); defaults to now"),
  bodyFatPct: z.number().min(2).max(75).optional().describe("Body fat % from the scale (Xiaomi's), if the person has it"),
  muscle: z.number().min(5).max(330).optional().describe("Xiaomi's muscle, in the same unit as the weight"),
  waterPct: z.number().min(20).max(80).optional(),
  bone: z.number().min(0.5).max(22).optional().describe("Bone mass, in the same unit as the weight"),
  visceralFat: z.number().min(1).max(60).optional(),
  waist: z.number().min(15).max(250).optional(),
  waistUnit: z.enum(["cm", "in"]).optional().describe("Defaults to cm"),
  note: z.string().max(280).optional().describe("A short note about this weigh-in (late dinner, a workout...)"),
};

const goalWeight = z.object({ value: z.number().min(30).max(660), unit: z.enum(["kg", "lb"]) });

const labResultInput = z.object({
  name: z.string().min(1).max(100).describe("Test name as the lab printed it, e.g. 'COLESTEROL HDL'"),
  value: z.number().optional().describe("Numeric result"),
  text: z.string().max(60).optional().describe("Result in words when it is not a number (Negativo, Normal, Ausentes...)"),
  unit: z.string().max(30).optional(),
  ref: z.string().max(80).optional().describe("The lab's reference range exactly as printed: '74.0 - 106.0', '<200.0', '>55.0', 'Negativo'"),
  flagged: z.boolean().optional().describe("True when the lab marked it out of range (an asterisk)"),
  group: z.enum(["blood", "urine"]).optional().describe("urine for the urinalysis (examen general de orina); defaults to blood"),
});

export function registerTools(server: McpServer, auth: AuthInfo | undefined, collections: () => Promise<Collections>, push: PushSender | undefined) {
  async function context(): Promise<Context> {
    const userId = auth?.extra?.userId;
    if (typeof userId !== "string") throw new ToolProblem("Not signed in. Reconnect Caliche Balance in Claude.");
    const c = await collections();
    const user = await c.users.findOne({ _id: new ObjectId(userId) });
    if (!user) throw new ToolProblem("This account no longer exists.");
    if (!user.profile) throw new ToolProblem("Finish the profile in the Caliche Balance app first.");
    return { c, user, profile: user.profile, lang: user.profile.language };
  }

  function tool<S extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; inputSchema: S; annotations: typeof READ },
    run: (args: z.infer<z.ZodObject<S>>, ctx: Context) => Promise<unknown>,
  ) {
    server.registerTool(name, config, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        const result = await run(args, await context());
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const message =
          error instanceof ToolProblem
            ? error.message
            : error instanceof z.ZodError
              ? `Invalid input: ${error.issues.map((i) => `${i.path.join(".") || "value"} ${i.message}`).join("; ")}`
              : "Something went wrong saving or reading the data. Try again.";
        if (!(error instanceof ToolProblem) && !(error instanceof z.ZodError)) console.error(`MCP tool ${name} failed:`, error);
        return { isError: true, content: [{ type: "text" as const, text: message }] };
      }
    }) as never);
  }

  // ------------------------------------------------------------------- Reading

  tool(
    "get_profile",
    {
      title: "Profile and goals",
      description:
        "The person's profile (name, sex, birth date and age, height, preferred unit and language), their weight, body fat and maintain goals with progress, Apple Health connection and streak reward.",
      inputSchema: {},
      annotations: READ,
    },
    async (_args, ctx) => {
      const { user, profile } = ctx;
      const measurements = await measurementsOf(ctx);
      const latest = measurements[0];
      const fats = measurements.flatMap((m) => {
        const f = bodyFatOf(profile, m);
        return f ? [{ time: Date.parse(m.measuredAt), value: f.value }] : [];
      });
      const g = user.goals;
      const weightGoal =
        g?.weight && latest
          ? (() => {
              const progress = goalProgress(g.weight.startKg, latest.weightKg, g.weight.targetKg);
              const eta = estimateEta(progress, dailyTrend(measurements.map((m) => ({ time: Date.parse(m.measuredAt), value: m.weightKg }))));
              return { targetKg: g.weight.targetKg, startKg: g.weight.startKg, setAt: g.weight.setAt, reachedAt: g.weight.reachedAt, currentKg: r2(latest.weightKg), remainingKg: r2(progress.remaining), progressPct: Math.round(progress.fraction * 100), eta };
            })()
          : null;
      const fatGoal =
        g?.bodyFat && fats[0]
          ? (() => {
              const progress = goalProgress(g.bodyFat.startPct, fats[0].value, g.bodyFat.targetPct);
              return { targetPct: g.bodyFat.targetPct, startPct: r1(g.bodyFat.startPct), setAt: g.bodyFat.setAt, reachedAt: g.bodyFat.reachedAt, currentPct: r1(fats[0].value), remainingPoints: r1(progress.remaining), progressPct: Math.round(progress.fraction * 100), eta: estimateEta(progress, dailyTrend(fats)) };
            })()
          : null;
      return {
        username: user.username,
        displayName: profile.displayName,
        sex: profile.sex,
        birthDate: profile.birthDate,
        age: ageAt(birth(profile), new Date()),
        heightCm: profile.heightCm,
        preferredUnit: profile.unit,
        language: profile.language,
        healthyWeightRangeKg: (() => {
          const h = healthyWeightRange(profile.heightCm);
          return { min: r1(h.min), max: r1(h.max) };
        })(),
        goals: { weight: weightGoal, bodyFat: fatGoal, maintain: g?.maintain ?? null },
        appleHealthConnected: user.appleHealth != null,
        appleHealthLastSync: user.appleHealth?.lastSyncAt ?? null,
        streakReward: user.streakReward ?? null,
        weighIns: measurements.length,
      };
    },
  );

  tool(
    "get_body_summary",
    {
      title: "Body summary",
      description:
        "Where the person stands today: the latest weigh-in with its full report (body fat, BMI, muscle and waist rated with North American ranges, Caliche score, metabolic age), real weight (smoothed trend) and weekly pace, healthy weight range, and averages of the last 30 and 90 days against the periods before them.",
      inputSchema: {},
      annotations: READ,
    },
    async (_args, ctx) => {
      const measurements = await measurementsOf(ctx);
      if (measurements.length === 0) return { message: "No weigh-ins yet." };
      const full = measurements.find((m) => m.bodyFatPct !== null || m.impedance !== null) ?? measurements[0]!;
      const trend = trendNow(weightTrend(measurements));
      const now = Date.now();
      return {
        latestWeighIn: presentWeighIn(ctx.profile, measurements[0]!),
        latestFullWeighInReport: presentReport(ctx.profile, full, measurements),
        realWeight: trend ? { trendKg: r2(trend.trendKg), perWeekKg: r2(trend.perWeekKg) } : null,
        last30Days: periodReport(ctx.profile, measurements, 30, now),
        last90Days: periodReport(ctx.profile, measurements, 90, now),
      };
    },
  );

  tool(
    "list_weigh_ins",
    {
      title: "List weigh-ins",
      description:
        "Weigh-ins newest first, each with weight, BMI, body fat (our foot-to-foot recalculation or Xiaomi's), body composition, metabolic age, Xiaomi's own values, waist and note. Filter by date range.",
      inputSchema: {
        from: isoDate.optional().describe("First day, YYYY-MM-DD"),
        to: isoDate.optional().describe("Last day, YYYY-MM-DD"),
        limit: z.number().int().min(1).max(1000).optional().describe("Most weigh-ins to return, default 30"),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const filter: Record<string, unknown> = { userId: ctx.user._id };
      if (args.from || args.to) {
        filter.measuredAt = {
          ...(args.from ? { $gte: new Date(`${args.from}T00:00:00Z`) } : {}),
          ...(args.to ? { $lte: new Date(`${args.to}T23:59:59Z`) } : {}),
        };
      }
      const docs = await ctx.c.measurements.find(filter).sort({ measuredAt: -1 }).limit(args.limit ?? 30).toArray();
      return docs.map((d) => presentWeighIn(ctx.profile, toMeasurementDto(d)));
    },
  );

  tool(
    "get_weigh_in",
    {
      title: "Weigh-in report",
      description: "One weigh-in in full: every rated measure with its band and distance to healthy, the Caliche score and its parts, and changes against a month ago and the first weigh-in.",
      inputSchema: { id: objectId },
      annotations: READ,
    },
    async (args, ctx) => {
      const all = await measurementsOf(ctx);
      const m = all.find((x) => x.id === args.id);
      if (!m) throw new ToolProblem("No weigh-in with that id.");
      return presentReport(ctx.profile, m, all);
    },
  );

  tool(
    "get_trends",
    {
      title: "Trends",
      description: "Averages of the last N days (weight, body fat, fat mass, lean mass, muscle, score, waist) against the N days before, to see how things are moving.",
      inputSchema: { days: z.number().int().min(7).max(3650).describe("Length of each period in days, e.g. 7, 30, 90, 365") },
      annotations: READ,
    },
    async (args, ctx) => periodReport(ctx.profile, await measurementsOf(ctx), args.days, Date.now()),
  );

  tool(
    "list_health_days",
    {
      title: "Apple Health days",
      description: "Days of Apple Health data sent by the Shortcut, newest first: steps, distance, exercise and stand minutes, active and resting kcal, resting heart rate, HRV, sleep (stages and times) and symptoms.",
      inputSchema: { days: z.number().int().min(1).max(400).optional().describe("How many days, default 30") },
      annotations: READ,
    },
    async (args, ctx) => {
      const docs = await ctx.c.healthDays.find({ userId: ctx.user._id }).sort({ date: -1 }).limit(args.days ?? 30).toArray();
      // The stage-by-stage timeline is long and only draws the chart; the totals stay.
      return docs.map((d) => {
        const day = toHealthDayDto(d);
        return day.sleep ? { ...day, sleep: { ...day.sleep, segments: undefined } } : day;
      });
    },
  );

  tool(
    "get_achievements",
    {
      title: "Streak, badges and challenges",
      description: "The weigh-in streak (current, best, freezes), every badge with its level, and this week's and month's challenges with progress.",
      inputSchema: {},
      annotations: READ,
    },
    async (_args, ctx) => {
      const result = await achievementsFor(ctx.c, ctx.user);
      if (!result) throw new ToolProblem("Finish the profile in the app first.");
      return result;
    },
  );

  tool(
    "list_lab_studies",
    {
      title: "Lab studies",
      description: "Every lab study (blood and urine tests), newest first, with how many results are in range, to watch or important, and when the next yearly study is due.",
      inputSchema: {},
      annotations: READ,
    },
    async (_args, ctx) => {
      const docs = await ctx.c.labStudies.find({ userId: ctx.user._id }).sort({ takenAt: -1 }).toArray();
      return docs.map((s, i) => {
        const full = presentLab(ctx, s, docs[i + 1] ?? null);
        return {
          id: full.id,
          takenAt: full.takenAt,
          lab: full.lab,
          counts: full.counts,
          toWatch: full.results.filter((r) => r.status !== "good").map((r) => ({ name: r.name, value: r.value, unit: r.unit, status: r.status })),
          nextStudyDue: full.nextStudyDue,
        };
      });
    },
  );

  tool(
    "get_lab_study",
    {
      title: "Lab study in detail",
      description:
        "One lab study with every result judged: status, what it means (North American guidelines for glucose, A1c, lipids, kidney, liver and uric acid; the lab's range for the rest), the source, the value in the previous study, eGFR and non-HDL cholesterol. Information to take to a doctor, not a diagnosis.",
      inputSchema: { id: objectId },
      annotations: READ,
    },
    async (args, ctx) => {
      const docs = await ctx.c.labStudies.find({ userId: ctx.user._id }).sort({ takenAt: -1 }).toArray();
      const index = docs.findIndex((d) => d._id.toHexString() === args.id);
      if (index < 0) throw new ToolProblem("No lab study with that id.");
      return presentLab(ctx, docs[index]!, docs[index + 1] ?? null);
    },
  );

  // ------------------------------------------------------------------- Writing

  tool(
    "add_weigh_in",
    {
      title: "Add a weigh-in",
      description:
        "Saves a weigh-in typed by hand, like Add in the app (goals and badges are checked the same way). A weigh-in at the exact same time replaces the earlier one. Returns it with our recalculation.",
      inputSchema: weighInSchema,
      annotations: WRITE,
    },
    async (args, ctx) => {
      const unit = args.unit ?? ctx.profile.unit;
      const saved = await createMeasurement(ctx.c, push, ctx.user._id, {
        measuredAt: args.measuredAt,
        weight: args.weight,
        weightUnit: unit,
        bodyFatPct: args.bodyFatPct ?? null,
        muscleKg: args.muscle == null ? null : unit === "lb" ? args.muscle / 2.2046226218 : args.muscle,
        waterPct: args.waterPct ?? null,
        boneKg: args.bone == null ? null : unit === "lb" ? args.bone / 2.2046226218 : args.bone,
        visceralFat: args.visceralFat ?? null,
        waist: args.waist ?? null,
        waistUnit: args.waistUnit ?? "cm",
      });
      const withNote = args.note ? await setNote(ctx.c, ctx.user._id, saved._id, args.note.trim()) : saved;
      return presentWeighIn(ctx.profile, toMeasurementDto(withNote ?? saved));
    },
  );

  tool(
    "set_weigh_in_waist",
    {
      title: "Set a weigh-in's waist",
      description: "Adds, changes or removes (null) the waist of an existing weigh-in.",
      inputSchema: { id: objectId, waist: z.number().min(15).max(250).nullable(), unit: z.enum(["cm", "in"]).optional().describe("Defaults to cm") },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const cm = args.waist === null ? null : Math.round(waistToCm(args.waist, args.unit ?? "cm") * 10) / 10;
      const saved = await setWaist(ctx.c, ctx.user._id, new ObjectId(args.id), cm);
      if (!saved) throw new ToolProblem("No weigh-in with that id.");
      return presentWeighIn(ctx.profile, toMeasurementDto(saved));
    },
  );

  tool(
    "set_weigh_in_note",
    {
      title: "Set a weigh-in's note",
      description: "Adds, changes or removes (null or empty) the short note of an existing weigh-in (up to 280 characters).",
      inputSchema: { id: objectId, note: z.string().max(280).nullable() },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const saved = await setNote(ctx.c, ctx.user._id, new ObjectId(args.id), args.note?.trim() || null);
      if (!saved) throw new ToolProblem("No weigh-in with that id.");
      return presentWeighIn(ctx.profile, toMeasurementDto(saved));
    },
  );

  tool(
    "delete_weigh_in",
    {
      title: "Delete a weigh-in",
      description: "Deletes one weigh-in for good. Confirm with the person first.",
      inputSchema: { id: objectId },
      annotations: DESTROY,
    },
    async (args, ctx) => {
      const result = await ctx.c.measurements.deleteOne({ _id: new ObjectId(args.id), userId: ctx.user._id });
      if (!result.deletedCount) throw new ToolProblem("No weigh-in with that id.");
      return { deleted: args.id };
    },
  );

  tool(
    "set_goals",
    {
      title: "Set goals",
      description:
        "Sets or removes goals. Leave a field out to keep that goal as it is; pass null to remove it. A weight target and a maintain range are alternatives: setting one removes the other.",
      inputSchema: {
        weight: goalWeight.nullable().optional().describe("Target weight, or null to remove it"),
        bodyFatPct: z.number().min(3).max(60).nullable().optional().describe("Target body fat %, or null to remove it"),
        maintain: goalWeight.nullable().optional().describe("Weight to keep within ±3 %, or null to remove it"),
      },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const current = ctx.user.goals;
      const goals = await saveGoals(ctx.c, ctx.user, {
        weight: args.weight !== undefined ? args.weight : current?.weight ? { value: current.weight.targetKg, unit: "kg" } : null,
        bodyFatPct: args.bodyFatPct !== undefined ? args.bodyFatPct : (current?.bodyFat?.targetPct ?? null),
        maintain: args.maintain,
      });
      return goals;
    },
  );

  tool(
    "add_lab_study",
    {
      title: "Add a lab study",
      description:
        "Saves a lab study (blood and urine tests, e.g. from Salud Digna) with every result, then returns it judged. Read the results from the PDF or photo the person shares and pass each test with its value, unit, the lab's reference range and whether the lab flagged it. Tests are matched to known ones by name; urinalysis results need group 'urine'. The same date and lab saved again replaces the study.",
      inputSchema: {
        takenAt: isoDate.describe("Day the samples were taken, YYYY-MM-DD"),
        lab: z.string().min(1).max(60).optional().describe("Lab name, default Salud Digna"),
        results: z.array(labResultInput).min(1).max(250),
      },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const results: LabResult[] = args.results.map((r) => {
        const group = r.group ?? "blood";
        if (r.value === undefined && !r.text) throw new ToolProblem(`"${r.name}" needs a value or a text result.`);
        return {
          key: identify(r.name, group).key,
          name: r.name.trim(),
          group,
          value: r.value ?? null,
          text: r.value === undefined ? (r.text ?? null) : null,
          unit: r.unit?.trim() || null,
          ref: r.ref?.trim() || null,
          flagged: r.flagged ?? false,
        };
      });
      const input = labStudyInputSchema.parse({ takenAt: args.takenAt, lab: args.lab ?? "Salud Digna", results });
      const saved = await saveLabStudy(ctx.c, ctx.user._id, input);
      const previous = await ctx.c.labStudies.findOne({ userId: ctx.user._id, takenAt: { $lt: input.takenAt } }, { sort: { takenAt: -1 } });
      return presentLab(ctx, saved, previous);
    },
  );

  tool(
    "delete_lab_study",
    {
      title: "Delete a lab study",
      description: "Deletes one lab study for good. Confirm with the person first.",
      inputSchema: { id: objectId },
      annotations: DESTROY,
    },
    async (args, ctx) => {
      const result = await ctx.c.labStudies.deleteOne({ _id: new ObjectId(args.id), userId: ctx.user._id });
      if (!result.deletedCount) throw new ToolProblem("No lab study with that id.");
      return { deleted: args.id };
    },
  );
}
