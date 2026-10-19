import { bodyFatOf, compositionOf, type ProfileFacts } from "./composition.ts";
import { ageAt, bmi, bodyFatBands } from "./reference.ts";
import type { GoalHistoryEntry, MeasurementDto } from "./schemas.ts";
import { scoreOf } from "./score.ts";

/**
 * Badges and challenges, computed from the whole weigh-in history so they never disagree with the
 * data. Every badge can be earned again: each time counts, and the count moves it up five levels
 * (bronze to diamond). Two kinds: habit (weighing in regularly, the strongest predictor of keeping
 * weight off) and health (body fat, waist, muscle and score, not just weight). Days, weeks (Monday
 * to Sunday) and months follow the person's time zone.
 */

export type BadgeGroup = "habit" | "health" | "goals";

export const TIERS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type Tier = (typeof TIERS)[number];

/** Times needed for each level, by how often the badge can happen. */
const DAILY = [1, 30, 100, 250, 500];
const WEEKLY = [1, 4, 12, 26, 52];
const MONTHLY = [1, 3, 6, 12, 24];
const RARE = [1, 2, 3, 5, 8];

export const BADGES = [
  { id: "weigh-days", group: "habit", levels: DAILY },
  { id: "streak-7", group: "habit", levels: [1, 3, 6, 12, 26] },
  { id: "streak-30", group: "habit", levels: [1, 2, 4, 6, 12] },
  { id: "habit-week", group: "habit", levels: WEEKLY },
  { id: "challenge-week", group: "habit", levels: WEEKLY },
  { id: "challenge-full", group: "habit", levels: WEEKLY },
  { id: "challenge-month", group: "habit", levels: MONTHLY },
  { id: "loss-5", group: "health", levels: RARE },
  { id: "fat-down-2", group: "health", levels: RARE },
  { id: "recomposition", group: "health", levels: RARE },
  { id: "healthy-bmi", group: "health", levels: WEEKLY },
  { id: "healthy-fat", group: "health", levels: WEEKLY },
  { id: "waist-month", group: "health", levels: MONTHLY },
  { id: "waist-healthy", group: "health", levels: WEEKLY },
  { id: "score-60", group: "health", levels: WEEKLY },
  { id: "score-80", group: "health", levels: WEEKLY },
  { id: "goal", group: "goals", levels: [1, 3, 5, 10, 20] },
] as const satisfies readonly { id: string; group: BadgeGroup; levels: readonly number[] }[];

export type BadgeId = (typeof BADGES)[number]["id"];

export interface BadgeStatus {
  id: BadgeId;
  group: BadgeGroup;
  /** Every time it was earned, oldest first (ISO dates). */
  dates: string[];
  /** 0 while never earned, then 1 (bronze) to 5 (diamond). */
  level: number;
  /** Times needed for the next level; null at diamond. */
  nextAt: number | null;
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

export interface Streak {
  /** Days weighed in the current streak; frozen days keep it going but do not add to it. */
  current: number;
  /** Longest streak ever, including the current one. */
  best: number;
  /** Longest streak before the current one, to tell when a record is near, tied or beaten. */
  bestBefore: number;
  weighedToday: boolean;
  /** Freezes ready to cover a missed day. */
  freezes: number;
  /** Days weighed until the next freeze; null while holding the maximum. */
  nextFreezeIn: number | null;
  /** Days a freeze covered in the current streak, oldest first (YYYY-MM-DD). */
  frozenDays: string[];
}

/**
 * Freezes: one for every 7 days weighed in a streak, up to 2. A missed day uses one automatically
 * and the streak goes on, so a trip or a sick day does not wipe out weeks of effort (and weighing
 * in does not turn into pressure). A streak that breaks loses its freezes.
 */
export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;

/** What a longer best streak unlocks; once reached, it stays unlocked. */
export const STREAK_UNLOCKS = { trend: 7, weekly: 14, monthly: 30, gold: 30, diamond: 100 } as const;
export type StreakUnlock = keyof typeof STREAK_UNLOCKS;

const isoDay = (day: number) => new Date(day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Streaks over the local days with a weigh-in (sorted, unique). Calls `onDay` with the streak
 * length after each weighed day, so badges can count every 7 and every 30 days.
 */
export function streakOf(days: number[], today: number, onDay: (index: number, run: number) => void = () => {}): Streak {
  let run = 0;
  let freezes = 0;
  let frozen: number[] = [];
  const runs: number[] = [];
  days.forEach((day, i) => {
    const missed = i === 0 ? Infinity : day - days[i - 1]! - 1;
    if (missed <= freezes) {
      freezes -= missed;
      for (let d = days[i - 1]! + 1; d < day; d++) frozen.push(d);
      run++;
    } else {
      if (run > 0) runs.push(run);
      run = 1;
      freezes = 0;
      frozen = [];
    }
    if (run % FREEZE_EVERY === 0 && freezes < MAX_FREEZES) freezes++;
    onDay(i, run);
  });
  const last = days[days.length - 1];
  // Days missed before today; today's weigh-in may still be ahead.
  const missed = last === undefined ? Infinity : Math.max(today - last - 1, 0);
  const alive = missed <= freezes;
  if (alive && last !== undefined) {
    freezes -= missed;
    for (let d = last + 1; d < today; d++) frozen.push(d);
  }
  const bestBefore = Math.max(0, ...runs);
  return {
    current: alive ? run : 0,
    best: Math.max(bestBefore, run),
    bestBefore: alive ? bestBefore : Math.max(bestBefore, run),
    weighedToday: last === today,
    freezes: alive ? freezes : 0,
    nextFreezeIn: !alive ? FREEZE_EVERY : freezes >= MAX_FREEZES ? null : FREEZE_EVERY - (run % FREEZE_EVERY),
    frozenDays: alive ? frozen.map(isoDay) : [],
  };
}

export function unlocked(streak: Pick<Streak, "best">, unlock: StreakUnlock): boolean {
  return streak.best >= STREAK_UNLOCKS[unlock];
}

export interface Achievements {
  badges: BadgeStatus[];
  streak: Streak;
  challenges: ChallengeStatus[];
}

/** Targets, in one place so the texts can quote them. */
export const TARGETS = {
  habitDaysPerWeek: 3,
  weekDays: 5,
  weekFull: 3,
  monthDays: 20,
  monthFatDrop: 0.5,
  // Each 5 % of weight lost: the CDC threshold for health benefits.
  loss: 0.05,
  lossWindowDays: 365,
  fatDrop: 2,
  fatWindowDays: 180,
  recompFatKg: 2,
  recompLeanKg: 0.5,
  recompWindowDays: 56,
  scoreGood: 60,
  scoreGreat: 80,
} as const;

export function levelOf(count: number, levels: readonly number[]): number {
  return levels.filter((n) => count >= n).length;
}

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

/** True for an IANA zone this runtime knows, like "America/Toronto". */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
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

/** Groups items by a key, keeping the input order inside each group and the groups in key order. */
function groupBy<T>(items: T[], key: (item: T) => number): T[][] {
  const groups = new Map<number, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
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

  const times = new Map<BadgeId, number[]>(BADGES.map((b) => [b.id, []]));
  const add = (id: BadgeId, t: number) => times.get(id)!.push(t);

  // First reading of each local day.
  const days: { day: number; t: number }[] = [];
  for (const r of rows) if (days[days.length - 1]?.day !== r.day) days.push({ day: r.day, t: r.t });
  for (const d of days) add("weigh-days", d.t);

  // Streaks: every 7 and every 30 days weighed in a row count once.
  const today = localDay(now, timeZone);
  const streak = streakOf(
    days.map((d) => d.day),
    today,
    (i, run) => {
      if (run % 7 === 0) add("streak-7", days[i]!.t);
      if (run % 30 === 0) add("streak-30", days[i]!.t);
    },
  );

  // Weeks and months, counted when the target day is reached.
  for (const week of groupBy(days, (d) => weekOf(d.day))) {
    if (week.length >= TARGETS.habitDaysPerWeek) add("habit-week", week[TARGETS.habitDaysPerWeek - 1]!.t);
    if (week.length >= TARGETS.weekDays) add("challenge-week", week[TARGETS.weekDays - 1]!.t);
  }
  const fullDays: { day: number; t: number }[] = [];
  for (const r of rows) if (r.impedance && fullDays[fullDays.length - 1]?.day !== r.day) fullDays.push({ day: r.day, t: r.t });
  for (const week of groupBy(fullDays, (d) => weekOf(d.day))) {
    if (week.length >= TARGETS.weekFull) add("challenge-full", week[TARGETS.weekFull - 1]!.t);
  }
  for (const month of groupBy(days, (d) => monthOf(d.day))) {
    if (month.length >= TARGETS.monthDays) add("challenge-month", month[TARGETS.monthDays - 1]!.t);
  }

  /**
   * A drop from the highest value since the previous time it counted (and within the window).
   * Each time starts again from there, so every further step down counts too.
   */
  const stepsDown = (id: BadgeId, list: Row[], value: (r: Row) => number, windowDays: number, reached: (top: number, v: number) => boolean) => {
    let from = 0;
    list.forEach((r, i) => {
      let top = -Infinity;
      for (let j = i; j >= from && r.t - list[j]!.t <= windowDays * DAY; j--) top = Math.max(top, value(list[j]!));
      if (reached(top, value(r))) {
        add(id, r.t);
        from = i;
      }
    });
  };
  // Each 5 % of weight lost (within 12 months), and each 2 points of body fat (within 6 months).
  stepsDown("loss-5", rows, (r) => r.weightKg, TARGETS.lossWindowDays, (top, v) => v <= top * (1 - TARGETS.loss));
  stepsDown("fat-down-2", rows.filter((r) => r.fat !== null), (r) => r.fat!, TARGETS.fatWindowDays, (top, v) => top - v >= TARGETS.fatDrop);

  // Recomposition: 2 kg of fat lost within 8 weeks while lean mass held; each time starts fresh.
  const comp = rows.filter((r) => r.fatMassKg !== null && r.leanSoftKg !== null);
  let since = 0;
  for (let i = 0; i < comp.length; i++) {
    for (let j = i - 1; j >= since && comp[i]!.t - comp[j]!.t <= TARGETS.recompWindowDays * DAY; j--) {
      const a = comp[j]!;
      const b = comp[i]!;
      if (a.fatMassKg! - b.fatMassKg! >= TARGETS.recompFatKg && b.leanSoftKg! - a.leanSoftKg! >= -TARGETS.recompLeanKg) {
        add("recomposition", b.t);
        since = i;
        break;
      }
    }
  }

  // Being in a healthy range counts once per week; the waist, once per month.
  const perWeek = (id: BadgeId, test: (r: Row) => boolean) => {
    for (const week of groupBy(rows, (r) => weekOf(r.day))) {
      const hit = week.find(test);
      if (hit) add(id, hit.t);
    }
  };
  perWeek("healthy-bmi", (r) => r.bmi < 25);
  perWeek("healthy-fat", (r) => r.fat !== null && r.fat <= r.fatHealthyMax);
  perWeek("waist-healthy", (r) => r.waistCm !== null && r.waistCm / profile.heightCm < 0.5);
  perWeek("score-60", (r) => r.score !== null && r.score >= TARGETS.scoreGood);
  perWeek("score-80", (r) => r.score !== null && r.score >= TARGETS.scoreGreat);
  for (const month of groupBy(rows, (r) => monthOf(r.day))) {
    const hit = month.find((r) => r.waistCm !== null);
    if (hit) add("waist-month", hit.t);
  }

  for (const g of input.goalHistory) add("goal", Date.parse(g.reachedAt));

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
      const list = times.get(b.id)!.sort((x, y) => x - y);
      const level = levelOf(list.length, b.levels);
      return {
        id: b.id,
        group: b.group,
        dates: list.map((t) => new Date(t).toISOString()),
        level,
        nextAt: level < b.levels.length ? b.levels[level]! : null,
      };
    }),
    streak,
    challenges: [
      challenge("week-weigh-5", "week", distinctDays(inWeek), TARGETS.weekDays),
      challenge("week-full-3", "week", distinctDays(inWeek.filter((r) => r.impedance)), TARGETS.weekFull),
      challenge("month-weigh-20", "month", distinctDays(inMonth), TARGETS.monthDays),
      challenge("month-waist", "month", inMonth.some((r) => r.waistCm !== null) ? 1 : 0, 1),
      challenge("month-fat", "month", fatDrop, TARGETS.monthFatDrop),
    ],
  };
}

/** Levels per badge, as stored to notice when one goes up. */
export function levelsOf(a: Achievements): Record<string, number> {
  return Object.fromEntries(a.badges.map((b) => [b.id, b.level]));
}

/** Badge and level names, shared by the screens and the notifications. */
export const BADGE_NAMES: Record<"es" | "en", Record<BadgeId, string>> = {
  es: {
    "weigh-days": "Pesadas",
    "streak-7": "Racha de 7",
    "streak-30": "Racha de 30",
    "habit-week": "Semana activa",
    "challenge-week": "Reto semanal",
    "challenge-full": "Semana completa",
    "challenge-month": "Mes perfecto",
    "loss-5": "Menos 5 %",
    "fat-down-2": "Grasa a la baja",
    recomposition: "Recomposición",
    "healthy-bmi": "IMC saludable",
    "healthy-fat": "Grasa saludable",
    "waist-month": "Cinta en mano",
    "waist-healthy": "Cintura sana",
    "score-60": "Puntuación 60",
    "score-80": "Puntuación 80",
    goal: "Meta cumplida",
  },
  en: {
    "weigh-days": "Weigh-ins",
    "streak-7": "7-day streak",
    "streak-30": "30-day streak",
    "habit-week": "Active week",
    "challenge-week": "Weekly challenge",
    "challenge-full": "Full week",
    "challenge-month": "Perfect month",
    "loss-5": "Minus 5 %",
    "fat-down-2": "Fat going down",
    recomposition: "Recomposition",
    "healthy-bmi": "Healthy BMI",
    "healthy-fat": "Healthy body fat",
    "waist-month": "Tape in hand",
    "waist-healthy": "Healthy waist",
    "score-60": "Score 60",
    "score-80": "Score 80",
    goal: "Goal reached",
  },
};

export const TIER_NAMES: Record<"es" | "en", Record<Tier, string>> = {
  es: { bronze: "Bronce", silver: "Plata", gold: "Oro", platinum: "Platino", diamond: "Diamante" },
  en: { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum", diamond: "Diamond" },
};
