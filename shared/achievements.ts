import { bodyFatOf, compositionOf, type ProfileFacts } from "./composition.ts";
import { ageAt, bmi, bodyFatBands } from "./reference.ts";
import type { GoalHistoryEntry, MeasurementDto } from "./schemas.ts";
import { scoreOf } from "./score.ts";

/**
 * Badges and challenges, computed from the weigh-ins alone so they never disagree with the data.
 * Two kinds: habit (weighing in regularly, the strongest predictor of keeping weight off) and
 * health (body fat, waist, muscle and score, not just weight). Days, weeks (Monday to Sunday) and
 * months follow the person's time zone.
 */

export type BadgeGroup = "habit" | "health" | "goals";

export const BADGES = [
  { id: "first-weigh-in", group: "habit" },
  { id: "streak-7", group: "habit" },
  { id: "streak-30", group: "habit" },
  { id: "habit-4", group: "habit" },
  { id: "habit-12", group: "habit" },
  { id: "weighins-100", group: "habit" },
  { id: "challenge-weeks-4", group: "habit" },
  { id: "challenge-month", group: "habit" },
  { id: "loss-5", group: "health" },
  { id: "loss-10", group: "health" },
  { id: "fat-down-2", group: "health" },
  { id: "recomposition", group: "health" },
  { id: "healthy-bmi", group: "health" },
  { id: "healthy-fat", group: "health" },
  { id: "waist-first", group: "health" },
  { id: "waist-healthy", group: "health" },
  { id: "score-60", group: "health" },
  { id: "score-80", group: "health" },
  { id: "goal-1", group: "goals" },
  { id: "goal-3", group: "goals" },
] as const satisfies readonly { id: string; group: BadgeGroup }[];

export type BadgeId = (typeof BADGES)[number]["id"];

export interface BadgeStatus {
  id: BadgeId;
  group: BadgeGroup;
  /** When the condition was first met; null while locked. */
  earnedAt: string | null;
  /** How close a locked badge is, when that can be measured. */
  progress: { value: number; target: number } | null;
}

export type ChallengeId = "week-weigh-5" | "week-full-3" | "month-weigh-20" | "month-waist" | "month-fat";

export interface ChallengeStatus {
  id: ChallengeId;
  period: "week" | "month";
  value: number;
  target: number;
  done: boolean;
  /** Whole days left in the period, counting today. */
  daysLeft: number;
}

export interface Achievements {
  badges: BadgeStatus[];
  streak: { current: number; best: number; weighedToday: boolean };
  challenges: ChallengeStatus[];
}

/** Targets, in one place so the texts can quote them. */
export const TARGETS = {
  streakShort: 7,
  streakLong: 30,
  habitDaysPerWeek: 3,
  habitShort: 4,
  habitLong: 12,
  weighins: 100,
  weekDays: 5,
  weekFull: 3,
  challengeWeeks: 4,
  monthDays: 20,
  monthFatDrop: 0.5,
  // Losing 5 % and 10 % of weight: CDC thresholds for health benefits.
  lossSmall: 0.05,
  lossLarge: 0.1,
  lossWindowDays: 365,
  fatDrop: 2,
  fatWindowDays: 180,
  recompFatKg: 2,
  recompLeanKg: 0.5,
  recompWindowDays: 56,
  scoreGood: 60,
  scoreGreat: 80,
} as const;

const DAY = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Days since 1970-01-01 of the local calendar date in this time zone. */
export function localDay(time: number, timeZone: string): number {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, f);
  }
  const [y, m, d] = f.format(time).split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY;
}

/** Weeks start on Monday; day 0 (1970-01-01) was a Thursday. */
const weekOf = (day: number) => Math.floor((day + 3) / 7);
const monthOf = (day: number) => {
  const d = new Date(day * DAY);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

interface Row {
  t: number;
  day: number;
  weightKg: number;
  impedance: boolean;
  waistCm: number | null;
  fat: number | null;
  fatMassKg: number | null;
  leanSoftKg: number | null;
  score: number | null;
  bmi: number;
  fatHealthyMax: number;
}

export function achievements(input: {
  profile: ProfileFacts;
  measurements: MeasurementDto[];
  goalHistory: GoalHistoryEntry[];
  timeZone: string;
  now: number;
}): Achievements {
  const { profile, timeZone, now } = input;
  const rows: Row[] = input.measurements
    .map((m) => {
      const t = Date.parse(m.measuredAt);
      const comp = compositionOf(profile, m);
      const fat = bodyFatOf(profile, m);
      const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(t));
      return {
        t,
        day: localDay(t, timeZone),
        weightKg: m.weightKg,
        impedance: comp !== null,
        waistCm: m.waistCm,
        fat: fat?.value ?? null,
        fatMassKg: comp?.fatMassKg ?? null,
        leanSoftKg: comp?.leanSoftKg ?? null,
        score: m.bodyFatPct !== null || m.impedance !== null ? scoreOf(profile, m).score : null,
        bmi: bmi(m.weightKg, profile.heightCm),
        fatHealthyMax: bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!.max!,
      };
    })
    .sort((a, b) => a.t - b.t);

  const earned = new Map<BadgeId, number>();
  const progress = new Map<BadgeId, { value: number; target: number }>();
  const earn = (id: BadgeId, t: number) => {
    if (!earned.has(id)) earned.set(id, t);
  };
  const first = <T>(items: T[], test: (item: T) => boolean) => items.find(test);

  // First reading time of each local day.
  const days: { day: number; t: number }[] = [];
  for (const r of rows) if (days[days.length - 1]?.day !== r.day) days.push({ day: r.day, t: r.t });

  // Streaks: consecutive days with a weigh-in.
  let run = 0;
  let best = 0;
  days.forEach((d, i) => {
    run = i > 0 && d.day === days[i - 1]!.day + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    if (run === TARGETS.streakShort) earn("streak-7", d.t);
    if (run === TARGETS.streakLong) earn("streak-30", d.t);
  });
  const today = localDay(now, timeZone);
  const last = days[days.length - 1];
  // Today's weigh-in may still be ahead, so a streak through yesterday is still alive.
  const current = last && last.day >= today - 1 ? run : 0;
  progress.set("streak-7", { value: best, target: TARGETS.streakShort });
  progress.set("streak-30", { value: best, target: TARGETS.streakLong });

  // Weeks: days weighed per week; a habit week has 3 or more, a challenge week 5 or more.
  const weeks = new Map<number, { t: number }[]>();
  for (const d of days) weeks.set(weekOf(d.day), [...(weeks.get(weekOf(d.day)) ?? []), d]);
  let habitRun = 0;
  let habitBest = 0;
  let previousWeek: number | null = null;
  let challengeWeeks = 0;
  for (const [week, list] of [...weeks].sort((a, b) => a[0] - b[0])) {
    if (list.length >= TARGETS.habitDaysPerWeek) {
      habitRun = previousWeek === week - 1 ? habitRun + 1 : 1;
      previousWeek = week;
      habitBest = Math.max(habitBest, habitRun);
      const at = list[TARGETS.habitDaysPerWeek - 1]!.t;
      if (habitRun === TARGETS.habitShort) earn("habit-4", at);
      if (habitRun === TARGETS.habitLong) earn("habit-12", at);
    }
    if (list.length >= TARGETS.weekDays) {
      challengeWeeks++;
      if (challengeWeeks === TARGETS.challengeWeeks) earn("challenge-weeks-4", list[TARGETS.weekDays - 1]!.t);
    }
  }
  progress.set("habit-4", { value: habitBest, target: TARGETS.habitShort });
  progress.set("habit-12", { value: habitBest, target: TARGETS.habitLong });
  progress.set("challenge-weeks-4", { value: challengeWeeks, target: TARGETS.challengeWeeks });

  const months = new Map<number, { t: number }[]>();
  for (const d of days) months.set(monthOf(d.day), [...(months.get(monthOf(d.day)) ?? []), d]);
  let bestMonth = 0;
  for (const [, list] of [...months].sort((a, b) => a[0] - b[0])) {
    bestMonth = Math.max(bestMonth, list.length);
    if (list.length >= TARGETS.monthDays) earn("challenge-month", list[TARGETS.monthDays - 1]!.t);
  }
  progress.set("challenge-month", { value: bestMonth, target: TARGETS.monthDays });

  if (rows[0]) earn("first-weigh-in", rows[0].t);
  if (rows[TARGETS.weighins - 1]) earn("weighins-100", rows[TARGETS.weighins - 1]!.t);
  progress.set("weighins-100", { value: rows.length, target: TARGETS.weighins });

  // Weight loss against the highest weight of the previous 12 months.
  const maxBefore = (i: number, windowDays: number, value: (r: Row) => number | null) => {
    let max: number | null = null;
    for (let j = i; j >= 0 && rows[i]!.t - rows[j]!.t <= windowDays * DAY; j--) {
      const v = value(rows[j]!);
      if (v !== null && (max === null || v > max)) max = v;
    }
    return max;
  };
  let latestLoss = 0;
  rows.forEach((r, i) => {
    const top = maxBefore(i, TARGETS.lossWindowDays, (x) => x.weightKg)!;
    const loss = (top - r.weightKg) / top;
    if (loss >= TARGETS.lossSmall) earn("loss-5", r.t);
    if (loss >= TARGETS.lossLarge) earn("loss-10", r.t);
    latestLoss = loss;
  });
  progress.set("loss-5", { value: Math.max(latestLoss, 0) * 100, target: TARGETS.lossSmall * 100 });
  progress.set("loss-10", { value: Math.max(latestLoss, 0) * 100, target: TARGETS.lossLarge * 100 });

  // Body fat 2 points under its highest of the previous 6 months.
  let latestFatDrop = 0;
  rows.forEach((r, i) => {
    if (r.fat === null) return;
    const top = maxBefore(i, TARGETS.fatWindowDays, (x) => x.fat)!;
    if (top - r.fat >= TARGETS.fatDrop) earn("fat-down-2", r.t);
    latestFatDrop = top - r.fat;
  });
  progress.set("fat-down-2", { value: Math.max(latestFatDrop, 0), target: TARGETS.fatDrop });

  // Recomposition: 2 kg of fat lost within 8 weeks while lean mass held (lost at most 0.5 kg).
  const comp = rows.filter((r) => r.fatMassKg !== null && r.leanSoftKg !== null);
  for (let i = 0; i < comp.length && !earned.has("recomposition"); i++) {
    for (let j = i - 1; j >= 0 && comp[i]!.t - comp[j]!.t <= TARGETS.recompWindowDays * DAY; j--) {
      const a = comp[j]!;
      const b = comp[i]!;
      if (a.fatMassKg! - b.fatMassKg! >= TARGETS.recompFatKg && b.leanSoftKg! - a.leanSoftKg! >= -TARGETS.recompLeanKg) {
        earn("recomposition", b.t);
        break;
      }
    }
  }

  const at = (test: (r: Row) => boolean) => first(rows, test)?.t;
  const mark = (id: BadgeId, t: number | undefined) => t !== undefined && earn(id, t);
  mark("healthy-bmi", at((r) => r.bmi < 25));
  mark("healthy-fat", at((r) => r.fat !== null && r.fat <= r.fatHealthyMax));
  mark("waist-first", at((r) => r.waistCm !== null));
  mark("waist-healthy", at((r) => r.waistCm !== null && r.waistCm / profile.heightCm < 0.5));
  mark("score-60", at((r) => r.score !== null && r.score >= TARGETS.scoreGood));
  mark("score-80", at((r) => r.score !== null && r.score >= TARGETS.scoreGreat));
  const latestScore = [...rows].reverse().find((r) => r.score !== null)?.score ?? 0;
  progress.set("score-60", { value: latestScore, target: TARGETS.scoreGood });
  progress.set("score-80", { value: latestScore, target: TARGETS.scoreGreat });

  const reached = input.goalHistory.map((g) => Date.parse(g.reachedAt)).sort((a, b) => a - b);
  if (reached[0] !== undefined) earn("goal-1", reached[0]);
  if (reached[2] !== undefined) earn("goal-3", reached[2]);
  progress.set("goal-1", { value: reached.length, target: 1 });
  progress.set("goal-3", { value: reached.length, target: 3 });

  // Challenges for the current week and month.
  const thisWeek = weekOf(today);
  const thisMonth = monthOf(today);
  const inWeek = rows.filter((r) => weekOf(r.day) === thisWeek);
  const inMonth = rows.filter((r) => monthOf(r.day) === thisMonth);
  const distinctDays = (list: Row[]) => new Set(list.map((r) => r.day)).size;
  const weekStart = thisWeek * 7 - 3;
  const todayDate = new Date(today * DAY);
  const monthStart = Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1) / DAY;
  const nextMonthStart = Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 1) / DAY;
  // Body fat this month against the last full reading before it (or the first one in it).
  const baseline =
    [...rows].reverse().find((r) => r.fat !== null && r.impedance && r.day < monthStart) ?? inMonth.find((r) => r.fat !== null && r.impedance);
  const latestFat = [...inMonth].reverse().find((r) => r.fat !== null && r.impedance);
  const fatDrop = baseline && latestFat && latestFat !== baseline ? Math.max(baseline.fat! - latestFat.fat!, 0) : 0;
  const challenge = (id: ChallengeId, period: "week" | "month", value: number, target: number): ChallengeStatus => ({
    id,
    period,
    value,
    target,
    done: value >= target,
    daysLeft: (period === "week" ? weekStart + 7 : nextMonthStart) - today,
  });

  return {
    badges: BADGES.map((b) => {
      const t = earned.get(b.id);
      return { id: b.id, group: b.group, earnedAt: t === undefined ? null : new Date(t).toISOString(), progress: t === undefined ? (progress.get(b.id) ?? null) : null };
    }),
    streak: { current, best, weighedToday: last?.day === today },
    challenges: [
      challenge("week-weigh-5", "week", distinctDays(inWeek), TARGETS.weekDays),
      challenge("week-full-3", "week", distinctDays(inWeek.filter((r) => r.impedance)), TARGETS.weekFull),
      challenge("month-weigh-20", "month", distinctDays(inMonth), TARGETS.monthDays),
      challenge("month-waist", "month", inMonth.some((r) => r.waistCm !== null) ? 1 : 0, 1),
      challenge("month-fat", "month", fatDrop, TARGETS.monthFatDrop),
    ],
  };
}
