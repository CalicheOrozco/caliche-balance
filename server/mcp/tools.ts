import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { localDay } from "../../shared/achievements.ts";
import { metabolicAge } from "../../shared/bodyAge.ts";
import { mondayOf, recipeInputSchema, shoppingList } from "../../shared/diet.ts";
import { foodTotals, MEALS } from "../../shared/food.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { dailyTrend, estimateEta, goalProgress } from "../../shared/goals.ts";
import { assess as assessLab, egfr, identify, type LabResult, labStudyInputSchema, labTest, nextStudyDue, nonHdl } from "../../shared/labs.ts";
import { ageAt, bmi, healthyWeightRange } from "../../shared/reference.ts";
import { readingReport, recentChanges } from "../../shared/report.ts";
import { type MeasurementDto, type ProfileDto, waistToCm } from "../../shared/schemas.ts";
import { periodReport, trendNow, weightTrend } from "../../shared/trend.ts";
import { labsCopy } from "../../src/copy/labs.ts";
import { achievementsFor, DEFAULT_TIME_ZONE } from "../achievementCheck.ts";
import { toHealthDayDto } from "../appleHealthRoutes.ts";
import type { Collections, LabStudyDoc, UserDoc } from "../db.ts";
import { toMeasurementDto } from "../http.ts";
import type { PushSender } from "../push.ts";
import { healthDayInput, readHealthDaysInput } from "../healthDays.ts";
import {
  activatePlan,
  archivePlan,
  chooseWeek,
  deletePlan,
  deleteRecipe,
  DietProblem,
  dietOf,
  savePlan,
  saveRecipe,
  setDietPrefs,
  setFavorite,
  toPlanDto,
  toRecipeDto,
  weekOf,
} from "../diet.ts";
import {
  addFoodEntries,
  createMeasurement,
  foodBetween,
  markHealthImported,
  saveGoals,
  saveHealthDays,
  saveLabStudy,
  setNote,
  setWaist,
  toFoodEntryDto,
  updateFoodEntry,
} from "../services.ts";

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
  text: z.string().max(400).optional().describe("Result in words when it is not a number (Negativo, Normal, Ausentes, Sinusal, the cardiologist's written findings...)"),
  unit: z.string().max(30).optional(),
  ref: z.string().max(80).optional().describe("The lab's reference range exactly as printed: '74.0 - 106.0', '<200.0', '>55.0', 'Negativo'"),
  flagged: z.boolean().optional().describe("True when the lab marked it out of range (an asterisk)"),
  group: z
    .enum(["blood", "urine", "ecg"])
    .optional()
    .describe(
      "urine for the urinalysis (examen general de orina); ecg for an electrocardiogram: RITMO (text), FRECUENCIA CARDIACA (lpm), ONDA P, INTERVALO PR, COMPLEJO QRS, INTERVALO QT, QTC (ms), EJE ELECTRICO (°), SOKOLOW-LYON (mV), HIPERTROFIA, SOBRECARGA DIASTOLICA, SOBRECARGA SISTOLICA, LESION, ISQUEMIA, NECROSIS (text Sí/No), HALLAZGOS ELECTROCARDIOGRAFICOS (the cardiologist's findings as text); defaults to blood",
    ),
});

const nutrient = (what: string) => z.number().min(0).max(1_000).optional().describe(`${what}, grams`);
const foodInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD").optional().describe("The person's local day, YYYY-MM-DD; defaults to today"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional().describe("Local time eaten, HH:MM, when known"),
  meal: z.enum(MEALS).describe("breakfast, lunch (comida), dinner (cena) or snack"),
  name: z.string().min(1).max(120).describe("The food or dish in the person's language, e.g. 'Tacos al pastor'"),
  amount: z.string().max(60).optional().describe("How much, as the person said it: '3 tacos', '1 taza', '250 g'"),
  kcal: z.number().min(0).max(10_000).describe("Calories of this amount, your best estimate"),
  proteinG: nutrient("Protein"),
  carbsG: nutrient("Carbohydrates"),
  fatG: nutrient("Fat"),
  fiberG: nutrient("Fiber"),
  note: z.string().max(280).optional().describe("Anything worth keeping: how it was cooked, a brand, what the estimate assumed"),
});

const DIET_PROBLEMS: Record<string, string> = {
  "unknown-recipe": "One of the options is not one of the person's recipes: use ids from get_diet, or pass the recipe itself to create it.",
  "unknown-plan": "No diet plan with that id.",
  "not-an-option": "That recipe is not one of the options of that meal in the active plan.",
};

const recipeOrId = z
  .object({
    recipeId: z.string().regex(/^[0-9a-f]{24}$/).optional().describe("An existing recipe (from get_diet)"),
    recipe: recipeInputSchema.optional().describe("A new recipe to create for this option"),
  })
  .describe("Either recipeId or recipe");

const planShape = {
  name: z.string().min(1).max(80).describe("e.g. 'Plan noviembre' or the nutritionist's plan name"),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("YYYY-MM the plan is for"),
  author: z.enum(["claude", "nutritionist", "me"]).describe("claude when you made it, nutritionist when it comes from the person's nutritionist"),
  source: z.string().max(80).optional().describe("The nutritionist's name or where it came from"),
  kcalTarget: z.number().min(500).max(10_000).optional().describe("Calories a day the plan aims for"),
  note: z.string().max(1_000).optional(),
  slots: z
    .array(
      z.object({
        id: z.string().optional().describe("Keep a meal's id (from get_diet) when editing, so the week's choice stays"),
        name: z.string().min(1).max(40).describe("The meal of the day as the plan calls it: 'Desayuno', 'Colación 1', 'Comida', 'Colación 2', 'Cena'"),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().describe("Usual time, HH:MM"),
        meal: z.enum(MEALS).optional().describe("How it is logged when eaten; guessed from the name when left out"),
        options: z.array(recipeOrId).min(1).max(8).describe("Usually 2 or 3 options to choose from for the week"),
      }),
    )
    .min(1)
    .max(10),
};

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
            : error instanceof DietProblem
              ? (DIET_PROBLEMS[error.message] ?? error.message)
            : error instanceof z.ZodError
              ? `Invalid input: ${error.issues.map((i) => `${i.path.join(".") || "value"} ${i.message}`).join("; ")}`
              : "Something went wrong saving or reading the data. Try again.";
        if (!(error instanceof ToolProblem) && !(error instanceof DietProblem) && !(error instanceof z.ZodError)) console.error(`MCP tool ${name} failed:`, error);
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
      description: "Days of Apple Health data (sent by the iOS Shortcut or saved with add_health_days), newest first: steps, distance, exercise and stand minutes, active and resting kcal, resting heart rate, HRV, sleep (stages and times) and symptoms.",
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
    "add_health_days",
    {
      title: "Add Apple Health days",
      description:
        "Saves days of Apple Health data, the same way the iOS Shortcut does (for example from the person's Health export): activity, energy, heart, walking, sleep with its stages and symptoms. Only the values sent are written, so a day can be sent in parts and a day sent again keeps the newer values. Up to 400 days per call; send a long history in several calls. Activity then shows them, and badges are checked.",
      inputSchema: { days: z.array(healthDayInput).min(1).max(400) },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const { parsed, skipped } = readHealthDaysInput(args.days);
      if (parsed.length === 0) throw new ToolProblem(`Nothing to save: ${skipped.map((s) => `${s.date} (${s.reason})`).join(", ")}`);
      const { counts } = await saveHealthDays(ctx.c, push, ctx.user._id, parsed);
      await markHealthImported(ctx.c, ctx.user);
      return {
        savedDays: counts.length,
        values: counts.reduce((sum, d) => sum + d.count, 0),
        from: counts[0]?.date,
        to: counts.at(-1)?.date,
        skipped,
      };
    },
  );

  tool(
    "add_lab_study",
    {
      title: "Add a lab study",
      description:
        "Saves a lab study (blood and urine tests and electrocardiograms, e.g. from Salud Digna) with every result, then returns it judged. Read the results from the PDF or photo the person shares and pass each test with its value, unit, the lab's reference range and whether the lab flagged it. Tests are matched to known ones by name; urinalysis results need group 'urine' and electrocardiogram results group 'ecg'. The same date and lab saved again replaces the study, unless merge is true: then the results join it, replacing only the same tests (use it for an electrocardiogram or any part done the same day as a study already saved).",
      inputSchema: {
        takenAt: isoDate.describe("Day the samples were taken, YYYY-MM-DD"),
        lab: z.string().min(1).max(60).optional().describe("Lab name, default Salud Digna"),
        results: z.array(labResultInput).min(1).max(250),
        merge: z.boolean().optional().describe("Add these results to the study already saved for this date and lab instead of replacing it"),
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
      const saved = await saveLabStudy(ctx.c, ctx.user._id, input, { merge: args.merge });
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

  /** The person's today, in their time zone. */
  const todayOf = (ctx: Context) => new Date(localDay(Date.now(), ctx.user.timeZone ?? DEFAULT_TIME_ZONE) * 86_400_000).toISOString().slice(0, 10);

  tool(
    "add_food",
    {
      title: "Log food eaten",
      description:
        "Saves what the person ate, one entry per food or dish, with your estimate of its calories and macronutrients (protein, carbohydrates, fat, fiber in grams) for the amount eaten. Use it when the person describes a meal or shares a photo: split a plate into its parts (tortillas, meat, sauce, drink) when that makes the estimate better, use typical Mexican portions and recipes unless told otherwise, and say what you assumed in the note. The app adds them up per day and compares them with the calories Apple Health says were spent.",
      inputSchema: { entries: z.array(foodInput).min(1).max(50) },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const today = todayOf(ctx);
      const docs = await addFoodEntries(ctx.c, ctx.user._id, args.entries.map((e) => ({ ...e, date: e.date ?? today })), "claude");
      const dates = [...new Set(docs.map((d) => d.date))].sort();
      const days = await Promise.all(dates.map(async (date) => ({ date, totals: foodTotals((await foodBetween(ctx.c, ctx.user._id, date, date)).map(toFoodEntryDto)) })));
      return { saved: docs.map(toFoodEntryDto), days };
    },
  );

  tool(
    "list_food",
    {
      title: "Food eaten",
      description:
        "What the person ate, day by day, newest first: every entry with its calories and macronutrients, the day's totals, and the calories spent that day according to Apple Health (active plus resting energy; today's is only so far) with the difference.",
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().describe("How many days back from `to`, default 7"),
        to: isoDate.optional().describe("Last day, YYYY-MM-DD; default today"),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const to = args.to ?? todayOf(ctx);
      const from = new Date(Date.parse(`${to}T12:00:00Z`) - ((args.days ?? 7) - 1) * 86_400_000).toISOString().slice(0, 10);
      const entries = (await foodBetween(ctx.c, ctx.user._id, from, to)).map(toFoodEntryDto);
      const health = await ctx.c.healthDays.find({ userId: ctx.user._id, date: { $gte: from, $lte: to } }).toArray();
      const spentOn = new Map(health.map((h) => [h.date, h.activeKcal != null || h.restingKcal != null ? Math.round((h.activeKcal ?? 0) + (h.restingKcal ?? 0)) : null]));
      const dates = [...new Set([...entries.map((e) => e.date), ...health.map((h) => h.date)])].sort().reverse();
      return dates.map((date) => {
        const list = entries.filter((e) => e.date === date);
        const totals = foodTotals(list);
        const spent = spentOn.get(date) ?? null;
        return { date, entries: list, totals, spentKcal: spent, balanceKcal: spent !== null && list.length ? totals.kcal - spent : null };
      });
    },
  );

  tool(
    "update_food_entry",
    {
      title: "Correct a food entry",
      description: "Replaces one food entry (its id comes from list_food or add_food) with corrected values; send every field, not only the changed ones.",
      inputSchema: { id: objectId, entry: foodInput },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const saved = await updateFoodEntry(ctx.c, ctx.user._id, new ObjectId(args.id), { ...args.entry, date: args.entry.date ?? todayOf(ctx) });
      if (!saved) throw new ToolProblem("No food entry with that id.");
      return toFoodEntryDto(saved);
    },
  );

  tool(
    "delete_food_entry",
    {
      title: "Delete a food entry",
      description: "Deletes one food entry.",
      inputSchema: { id: objectId },
      annotations: DESTROY,
    },
    async (args, ctx) => {
      const result = await ctx.c.foodEntries.deleteOne({ _id: new ObjectId(args.id), userId: ctx.user._id });
      if (!result.deletedCount) throw new ToolProblem("No food entry with that id.");
      return { deleted: args.id };
    },
  );

  // ------------------------------------------------------------------- Diet

  /** The Monday of the person's current week. */
  const thisWeek = (ctx: Context) => mondayOf(todayOf(ctx));

  /** Creates the recipes given inline and returns the plan input with ids only. */
  async function planInput(ctx: Context, args: z.infer<z.ZodObject<typeof planShape>>) {
    const slots = [];
    for (const slot of args.slots) {
      const options: string[] = [];
      for (const o of slot.options) {
        if (o.recipeId) options.push(o.recipeId);
        else if (o.recipe) options.push((await saveRecipe(ctx.c, ctx.user._id, o.recipe))!._id.toHexString());
        else throw new ToolProblem(`An option of "${slot.name}" needs recipeId or recipe.`);
      }
      slots.push({ id: slot.id, name: slot.name, time: slot.time, meal: slot.meal, options });
    }
    return { name: args.name, month: args.month, author: args.author, source: args.source, kcalTarget: args.kcalTarget, note: args.note, slots };
  }

  tool(
    "get_diet",
    {
      title: "Diet: likes, plans, recipes and the week",
      description:
        "The person's diet: their likes and limits (read them before suggesting recipes), every plan (the active one first) with its meals of the day and recipe options, a short list of every recipe (favorites marked), and the active plan's choice for the week (one option per meal, carried over from earlier weeks until changed) with that day's calories against the plan's target. Use get_recipe for ingredients and steps.",
      inputSchema: { week: isoDate.optional().describe("Any day of the week to look at; default this week") },
      annotations: READ,
    },
    async (args, ctx) => {
      const diet = await dietOf(ctx.c, ctx.user, args.week ?? thisWeek(ctx));
      const byId = new Map(diet.recipes.map((r) => [r.id, r]));
      const brief = (id: string) => {
        const r = byId.get(id);
        return r ? { id, title: r.title, kcal: r.kcal, proteinG: r.proteinG, favorite: r.favorite } : { id, missing: true };
      };
      const active = diet.plans.find((p) => p.active);
      const chosen = Object.values(diet.week.choices).map((id) => byId.get(id)?.kcal ?? 0);
      return {
        preferences: diet.prefs,
        plans: diet.plans.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s, options: s.options.map(brief) })) })),
        recipes: diet.recipes.map((r) => ({ id: r.id, title: r.title, kcal: r.kcal, servings: r.servings, tags: r.tags, favorite: r.favorite })),
        week: {
          ...diet.week,
          chosen: active?.slots.map((s) => ({ slotId: s.id, meal: s.name, recipe: diet.week.choices[s.id] ? brief(diet.week.choices[s.id]!) : null })) ?? [],
          kcalChosen: chosen.reduce((a, b) => a + b, 0),
          kcalTarget: active?.kcalTarget ?? null,
        },
      };
    },
  );

  tool(
    "get_recipe",
    {
      title: "A recipe",
      description: "One recipe with everything: picture, servings, calories and macros per serving, times, ingredients, steps, tags and note.",
      inputSchema: { id: objectId },
      annotations: READ,
    },
    async (args, ctx) => {
      const doc = await ctx.c.recipes.findOne({ _id: new ObjectId(args.id), userId: ctx.user._id });
      if (!doc) throw new ToolProblem("No recipe with that id.");
      return toRecipeDto(doc);
    },
  );

  tool(
    "set_diet_preferences",
    {
      title: "Save diet likes and limits",
      description: "Replaces the person's likes and limits for the diet (send every field you want to keep). Update it when they tell you something new about what they like or cannot eat.",
      inputSchema: {
        likes: z.string().max(1_000).optional().describe("Foods, cuisines and flavors they like"),
        dislikes: z.string().max(1_000).optional().describe("What they do not eat or do not like"),
        allergies: z.string().max(500).optional().describe("Allergies and intolerances"),
        cookingTime: z.string().max(200).optional().describe("Time they have to cook, by meal or day"),
        budget: z.string().max(200).optional(),
        notes: z.string().max(1_000).optional().describe("Anything else: schedule, equipment, who else eats"),
      },
      annotations: WRITE,
    },
    async (args, ctx) => setDietPrefs(ctx.c, ctx.user._id, args),
  );

  tool(
    "save_recipe",
    {
      title: "Save a recipe",
      description:
        "Creates a recipe, or replaces one when id is given (send every field). Calories and macros are per serving. Ingredients go with quantity, unit and item apart ('200', 'g', 'pechuga de pollo'; no quantity for 'sal al gusto') so the shopping list can add them up; use g, kg, ml, l, pz, taza, cda or cdita. imageUrl must be an https link to a picture; emoji is shown when there is none.",
      inputSchema: { id: objectId.optional(), recipe: recipeInputSchema },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const saved = await saveRecipe(ctx.c, ctx.user._id, args.recipe, args.id ? new ObjectId(args.id) : undefined);
      if (!saved) throw new ToolProblem("No recipe with that id.");
      return toRecipeDto(saved);
    },
  );

  tool(
    "set_recipe_favorite",
    {
      title: "Mark a recipe as favorite",
      description: "Marks or unmarks a recipe as one of the person's favorites, to use it again in later plans.",
      inputSchema: { id: objectId, favorite: z.boolean() },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const saved = await setFavorite(ctx.c, ctx.user._id, new ObjectId(args.id), args.favorite);
      if (!saved) throw new ToolProblem("No recipe with that id.");
      return { id: args.id, favorite: saved.favorite };
    },
  );

  tool(
    "delete_recipe",
    {
      title: "Delete a recipe",
      description: "Deletes a recipe for good and takes it out of every plan. Confirm with the person first.",
      inputSchema: { id: objectId },
      annotations: DESTROY,
    },
    async (args, ctx) => {
      if (!(await deleteRecipe(ctx.c, ctx.user._id, new ObjectId(args.id)))) throw new ToolProblem("No recipe with that id.");
      return { deleted: args.id };
    },
  );

  tool(
    "create_diet_plan",
    {
      title: "Create a diet plan",
      description:
        "Creates a diet plan with its meals of the day and 2 or 3 recipe options for each, from what you suggest (read get_diet's preferences first) or from the person's nutritionist plan (a PDF or photo they share). Each option is an existing recipe id or a new recipe, created on the way. By default it becomes the active plan and the previous one is archived (kept). The person then picks one option per meal for the week, or you do it with choose_week.",
      inputSchema: { ...planShape, activate: z.boolean().optional().describe("Default true") },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const saved = await savePlan(ctx.c, ctx.user._id, await planInput(ctx, args), { activate: args.activate ?? true });
      return toPlanDto(saved!);
    },
  );

  tool(
    "update_diet_plan",
    {
      title: "Change a diet plan",
      description: "Replaces a plan's name, target and meals of the day with their options (send them all; keep each meal's id so the week's choice stays). New options can be new recipes.",
      inputSchema: { id: objectId, ...planShape },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const saved = await savePlan(ctx.c, ctx.user._id, await planInput(ctx, args), { id: new ObjectId(args.id) });
      if (!saved) throw new ToolProblem("No diet plan with that id.");
      return toPlanDto(saved);
    },
  );

  tool(
    "set_diet_plan_status",
    {
      title: "Activate or archive a diet plan",
      description: "Makes a plan the active one (the others are archived) or archives it. Archived plans are kept and can come back.",
      inputSchema: { id: objectId, status: z.enum(["active", "archived"]) },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const id = new ObjectId(args.id);
      const ok = args.status === "active" ? await activatePlan(ctx.c, ctx.user._id, id) : await archivePlan(ctx.c, ctx.user._id, id);
      if (!ok) throw new ToolProblem("No diet plan with that id.");
      return { id: args.id, status: args.status };
    },
  );

  tool(
    "delete_diet_plan",
    {
      title: "Delete a diet plan",
      description: "Deletes a plan for good; its recipes stay. Confirm with the person first; archiving keeps it instead.",
      inputSchema: { id: objectId },
      annotations: DESTROY,
    },
    async (args, ctx) => {
      if (!(await deletePlan(ctx.c, ctx.user._id, new ObjectId(args.id)))) throw new ToolProblem("No diet plan with that id.");
      return { deleted: args.id };
    },
  );

  tool(
    "choose_week",
    {
      title: "Choose the week's meals",
      description: "Sets which option of the active plan the person eats this week (or another week) for each meal of the day: one recipe per meal, the same every day. Meals left out keep no choice.",
      inputSchema: {
        week: isoDate.optional().describe("Any day of that week; default this week"),
        choices: z.array(z.object({ slotId: z.string().describe("The meal's id from get_diet"), recipeId: objectId })).max(10),
      },
      annotations: WRITE,
    },
    async (args, ctx) => {
      const active = await ctx.c.dietPlans.findOne({ userId: ctx.user._id, active: true });
      if (!active) throw new ToolProblem("There is no active diet plan.");
      const week = args.week ?? thisWeek(ctx);
      await chooseWeek(ctx.c, ctx.user._id, week, { planId: active._id.toHexString(), choices: Object.fromEntries(args.choices.map((x) => [x.slotId, x.recipeId])) });
      return weekOf(ctx.c, ctx.user._id, week, active);
    },
  );

  tool(
    "get_shopping_list",
    {
      title: "Shopping list",
      description: "What to buy for the week's chosen meals: every ingredient added up across recipes, scaled to the days and servings a day (7 days and 1 serving unless the person set others), and whether it is already checked off.",
      inputSchema: {
        week: isoDate.optional().describe("Any day of that week; default this week"),
        days: z.number().int().min(1).max(14).optional(),
        servings: z.number().min(0.5).max(10).optional().describe("Servings a day of each meal"),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const active = await ctx.c.dietPlans.findOne({ userId: ctx.user._id, active: true });
      const week = await weekOf(ctx.c, ctx.user._id, args.week ?? thisWeek(ctx), active);
      const ids = Object.values(week.choices).map((id) => new ObjectId(id));
      const recipes = (await ctx.c.recipes.find({ userId: ctx.user._id, _id: { $in: ids } }).toArray()).map(toRecipeDto);
      const days = args.days ?? week.shopping.days;
      const servings = args.servings ?? week.shopping.servings;
      const checked = new Set(week.shopping.checked);
      return {
        week: week.week,
        days,
        servings,
        recipes: recipes.map((r) => r.title),
        items: shoppingList(recipes, days, servings).map((i) => ({ ...i, checked: checked.has(i.key) })),
      };
    },
  );
}
