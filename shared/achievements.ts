import { bodyFatOf, compositionOf, type ProfileFacts } from "./composition.ts";
import { ageAt, bmi, bodyFatBands } from "./reference.ts";
import type { GoalHistoryEntry, MeasurementDto } from "./schemas.ts";
import { scoreOf } from "./score.ts";

/**
 * Badges and challenges, computed from the whole weigh-in history so they never disagree with the
 * data. Every badge can be earned again: each time counts, and the count moves it up five levels
 * (bronze to diamond). Habit (weighing in regularly, the strongest predictor of keeping weight
 * off), health (body fat, waist, muscle and score, not just weight), goals, and activity (steps,
 * exercise and sleep from Apple Health, against published recommendations). Days, weeks (Monday
 * to Sunday) and months follow the person's time zone.
 */

export type BadgeGroup = "habit" | "health" | "goals" | "move" | "exercise" | "sleep" | "heart" | "balance";

/** The groups that come from Apple Health. */
export const HEALTH_BADGE_GROUPS: readonly BadgeGroup[] = ["move", "exercise", "sleep", "heart", "balance"];

export const TIERS = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type Tier = (typeof TIERS)[number];

/** Times needed for each level, by how often the badge can happen. */
const DAILY = [1, 30, 100, 250, 500];
const WEEKLY = [1, 4, 12, 26, 52];
const MONTHLY = [1, 3, 6, 12, 24];
const RARE = [1, 2, 3, 5, 8];
/** For days that take a lot (15,000 steps, 1,000 active calories). */
const HARD_DAILY = [1, 10, 30, 75, 150];
const HARDER_DAILY = [1, 5, 15, 40, 100];
const STREAK_7 = [1, 3, 6, 12, 26];
const STREAK_30 = [1, 2, 4, 6, 12];

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
  { id: "steps-10k", group: "move", levels: DAILY },
  { id: "steps-15k", group: "move", levels: HARD_DAILY },
  { id: "steps-20k", group: "move", levels: HARDER_DAILY },
  { id: "steps-week", group: "move", levels: WEEKLY },
  { id: "steps-streak-7", group: "move", levels: STREAK_7 },
  { id: "distance-5k", group: "move", levels: DAILY },
  { id: "distance-week", group: "move", levels: WEEKLY },
  { id: "flights-10", group: "move", levels: DAILY },
  { id: "stand-3h", group: "move", levels: DAILY },
  { id: "exercise-30", group: "exercise", levels: DAILY },
  { id: "exercise-60", group: "exercise", levels: DAILY },
  { id: "exercise-150", group: "exercise", levels: WEEKLY },
  { id: "exercise-300", group: "exercise", levels: WEEKLY },
  { id: "exercise-streak-7", group: "exercise", levels: STREAK_7 },
  { id: "exercise-streak-30", group: "exercise", levels: STREAK_30 },
  { id: "active-500", group: "exercise", levels: DAILY },
  { id: "active-1000", group: "exercise", levels: HARD_DAILY },
  { id: "active-week", group: "exercise", levels: WEEKLY },
  { id: "sleep-7", group: "sleep", levels: DAILY },
  { id: "sleep-week", group: "sleep", levels: WEEKLY },
  { id: "sleep-streak-7", group: "sleep", levels: STREAK_7 },
  { id: "sleep-deep", group: "sleep", levels: DAILY },
  { id: "sleep-unbroken", group: "sleep", levels: DAILY },
  { id: "sleep-regular", group: "sleep", levels: WEEKLY },
  { id: "resting-hr-60", group: "heart", levels: DAILY },
  { id: "resting-hr-down", group: "heart", levels: MONTHLY },
  { id: "hrv-up", group: "heart", levels: MONTHLY },
  { id: "oxygen-week", group: "heart", levels: WEEKLY },
  { id: "full-day", group: "balance", levels: DAILY },
  { id: "full-week", group: "balance", levels: WEEKLY },
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
  steps: [10_000, 15_000, 20_000],
  // Mortality falls up to about 7,000 to 9,000 steps a day (Paluch et al., Lancet Public Health 2022).
  stepsDaily: 7_000,
  stepsWeekDays: 5,
  distanceDayKm: 5,
  // A marathon's distance in a week.
  distanceWeekKm: 42.195,
  flightsDay: 10,
  standDayMin: 180,
  exerciseDay: [30, 60],
  // 150 to 300 minutes of moderate activity a week (US and Canadian physical activity guidelines).
  exerciseWeek: [150, 300],
  activeDayKcal: [500, 1_000],
  // About half a kilo of body fat.
  activeWeekKcal: 3_500,
  // Adults need 7 hours or more (American Academy of Sleep Medicine).
  sleepMin: 7 * 60,
  sleepWeekNights: 5,
  // Deep sleep is usually 13 to 23 % of the night in adults.
  deepSleepShare: 0.15,
  unbrokenMin: 6 * 60,
  // Going to sleep at a regular time is linked to better health (Windred et al., Sleep 2024).
  regularNights: 5,
  regularWindowMin: 60,
  restingHr: 60,
  restingHrDrop: 2,
  hrvRise: 0.05,
  monthMinDays: 10,
  oxygenPct: 95,
  oxygenMinDays: 3,
} as const;

/** What the Apple Health badges read from each day (its local date); null where it has no data. */
export interface HealthDayFacts {
  date: string;
  steps: number | null;
  distanceKm: number | null;
  flightsClimbed: number | null;
  standMin: number | null;
  exerciseMin: number | null;
  activeKcal: number | null;
  restingHr: number | null;
  hrvMs: number | null;
  bloodOxygenPct: number | null;
  /** The night that ended this day. */
  sleep: { asleepMin: number; deepMin: number | null; awakenings: number; start: string } | null;
}

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
  healthDays?: HealthDayFacts[];
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

  healthBadges(input.healthDays ?? [], timeZone, today, add);

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

/**
 * The Apple Health badges. Days are already local dates; a day is dated at its noon UTC, which
 * shows as that same date across the Americas. Months are compared only once they are over.
 */
function healthBadges(input: HealthDayFacts[], timeZone: string, today: number, add: (id: BadgeId, t: number) => void) {
  const days = [...input]
    .map((h) => ({ ...h, day: Date.parse(`${h.date}T00:00:00Z`) / DAY, t: Date.parse(`${h.date}T12:00:00Z`) }))
    .sort((a, b) => a.day - b.day);
  type Day = (typeof days)[number];
  const at = (v: number | null | undefined, min: number) => (v ?? 0) >= min;
  const walked = (h: Day) => at(h.steps, TARGETS.stepsDaily);
  const exercised = (h: Day) => at(h.exerciseMin, TARGETS.exerciseDay[0]);
  const rested = (h: Day) => at(h.sleep?.asleepMin, TARGETS.sleepMin);
  const fullDay = (h: Day) => walked(h) && exercised(h) && rested(h);

  // One day at a time.
  const daily: [BadgeId, (h: Day) => boolean][] = [
    ["steps-10k", (h) => at(h.steps, TARGETS.steps[0])],
    ["steps-15k", (h) => at(h.steps, TARGETS.steps[1])],
    ["steps-20k", (h) => at(h.steps, TARGETS.steps[2])],
    ["distance-5k", (h) => at(h.distanceKm, TARGETS.distanceDayKm)],
    ["flights-10", (h) => at(h.flightsClimbed, TARGETS.flightsDay)],
    ["stand-3h", (h) => at(h.standMin, TARGETS.standDayMin)],
    ["exercise-30", exercised],
    ["exercise-60", (h) => at(h.exerciseMin, TARGETS.exerciseDay[1])],
    ["active-500", (h) => at(h.activeKcal, TARGETS.activeDayKcal[0])],
    ["active-1000", (h) => at(h.activeKcal, TARGETS.activeDayKcal[1])],
    ["sleep-7", rested],
    [
      "sleep-deep",
      (h) => !!h.sleep && h.sleep.deepMin !== null && h.sleep.asleepMin > 0 && h.sleep.deepMin / h.sleep.asleepMin >= TARGETS.deepSleepShare,
    ],
    ["sleep-unbroken", (h) => !!h.sleep && h.sleep.asleepMin >= TARGETS.unbrokenMin && h.sleep.awakenings === 0],
    ["resting-hr-60", (h) => h.restingHr !== null && h.restingHr < TARGETS.restingHr],
    ["full-day", fullDay],
  ];
  for (const h of days) for (const [id, test] of daily) if (test(h)) add(id, h.t);

  // Every 7 (or 30) days in a row, like the weigh-in streak; a day without data breaks the run.
  const runs = (test: (h: Day) => boolean, every: [BadgeId, number][]) => {
    let run = 0;
    let last = -Infinity;
    for (const h of days) {
      if (!test(h)) {
        run = 0;
        continue;
      }
      run = h.day === last + 1 ? run + 1 : 1;
      last = h.day;
      for (const [id, n] of every) if (run % n === 0) add(id, h.t);
    }
  };
  runs(walked, [["steps-streak-7", 7]]);
  runs(exercised, [
    ["exercise-streak-7", 7],
    ["exercise-streak-30", 30],
  ]);
  runs(rested, [["sleep-streak-7", 7]]);

  // Weeks (Monday to Sunday), counted on the day the target is reached.
  const nth = (list: Day[], test: (h: Day) => boolean, n: number) => list.filter(test)[n - 1];
  const reachSum = (list: Day[], value: (h: Day) => number | null, target: number) => {
    let sum = 0;
    return list.find((h) => (sum += value(h) ?? 0) >= target);
  };
  for (const week of groupBy(days, (h) => weekOf(h.day))) {
    const hits: [BadgeId, Day | undefined][] = [
      ["steps-week", nth(week, walked, TARGETS.stepsWeekDays)],
      ["distance-week", reachSum(week, (h) => h.distanceKm, TARGETS.distanceWeekKm)],
      ["exercise-150", reachSum(week, (h) => h.exerciseMin, TARGETS.exerciseWeek[0])],
      ["exercise-300", reachSum(week, (h) => h.exerciseMin, TARGETS.exerciseWeek[1])],
      ["active-week", reachSum(week, (h) => h.activeKcal, TARGETS.activeWeekKcal)],
      ["sleep-week", nth(week, rested, TARGETS.sleepWeekNights)],
      ["full-week", nth(week, fullDay, TARGETS.stepsWeekDays)],
    ];
    for (const [id, hit] of hits) if (hit) add(id, hit.t);
    // Blood oxygen: the week's average, with enough readings.
    const oxygen = week.filter((h) => h.bloodOxygenPct !== null);
    if (oxygen.length >= TARGETS.oxygenMinDays && avg(oxygen.map((h) => h.bloodOxygenPct!)) >= TARGETS.oxygenPct) add("oxygen-week", oxygen.at(-1)!.t);
    // A regular bedtime: enough nights that fell asleep within the same hour.
    const nights = week.filter((h) => h.sleep).map((h) => ({ h, at: bedtimeMinutes(h.sleep!.start, timeZone) }));
    nights.sort((a, b) => a.at - b.at);
    for (let i = 0; i + TARGETS.regularNights - 1 < nights.length; i++) {
      const group = nights.slice(i, i + TARGETS.regularNights);
      if (group.at(-1)!.at - group[0]!.at <= TARGETS.regularWindowMin) {
        add("sleep-regular", Math.max(...group.map((n) => n.h.t)));
        break;
      }
    }
  }

  // Months, each against the one before, once both are over and have enough days.
  const thisMonth = monthOf(today);
  const months = groupBy(days, (h) => monthOf(h.day)).filter((m) => monthOf(m[0]!.day) < thisMonth);
  const monthly = (id: BadgeId, value: (h: Day) => number | null, better: (now: number, before: number) => boolean) => {
    for (let i = 1; i < months.length; i++) {
      if (monthOf(months[i]![0]!.day) !== monthOf(months[i - 1]![0]!.day) + 1) continue;
      const now = months[i]!.map(value).filter((v): v is number => v !== null);
      const before = months[i - 1]!.map(value).filter((v): v is number => v !== null);
      if (now.length >= TARGETS.monthMinDays && before.length >= TARGETS.monthMinDays && better(avg(now), avg(before))) add(id, months[i]!.at(-1)!.t);
    }
  };
  monthly("resting-hr-down", (h) => h.restingHr, (now, before) => before - now >= TARGETS.restingHrDrop);
  monthly("hrv-up", (h) => h.hrvMs, (now, before) => now >= before * (1 + TARGETS.hrvRise));
}

const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * When a night started, in minutes from local noon, so bedtimes on both sides of midnight (23:30
 * and 00:20) come out close together.
 */
function bedtimeMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (hour * 60 + minute + 12 * 60) % (24 * 60);
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
    "steps-10k": "10 mil pasos",
    "steps-15k": "15 mil pasos",
    "steps-20k": "20 mil pasos",
    "steps-week": "Semana caminando",
    "steps-streak-7": "Racha caminando",
    "distance-5k": "5 km en un día",
    "distance-week": "Maratón semanal",
    "flights-10": "10 pisos",
    "stand-3h": "3 horas de pie",
    "exercise-30": "30 de ejercicio",
    "exercise-60": "Hora de ejercicio",
    "exercise-150": "150 a la semana",
    "exercise-300": "300 a la semana",
    "exercise-streak-7": "Racha de ejercicio",
    "exercise-streak-30": "Mes de ejercicio",
    "active-500": "500 activas",
    "active-1000": "1,000 activas",
    "active-week": "Medio kilo quemado",
    "sleep-7": "Buen descanso",
    "sleep-week": "Semana descansada",
    "sleep-streak-7": "Racha de descanso",
    "sleep-deep": "Sueño profundo",
    "sleep-unbroken": "Noche de corrido",
    "sleep-regular": "Horario regular",
    "resting-hr-60": "Pulso bajo 60",
    "resting-hr-down": "Corazón más fuerte",
    "hrv-up": "Mejor recuperación",
    "oxygen-week": "Oxígeno en orden",
    "full-day": "Día completo",
    "full-week": "Semana completa de hábitos",
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
    "steps-10k": "10k steps",
    "steps-15k": "15k steps",
    "steps-20k": "20k steps",
    "steps-week": "Walking week",
    "steps-streak-7": "Walking streak",
    "distance-5k": "5 km in a day",
    "distance-week": "Weekly marathon",
    "flights-10": "10 floors",
    "stand-3h": "3 hours standing",
    "exercise-30": "30 of exercise",
    "exercise-60": "Hour of exercise",
    "exercise-150": "150 a week",
    "exercise-300": "300 a week",
    "exercise-streak-7": "Exercise streak",
    "exercise-streak-30": "Exercise month",
    "active-500": "500 active",
    "active-1000": "1,000 active",
    "active-week": "Half a kilo burned",
    "sleep-7": "Good rest",
    "sleep-week": "Rested week",
    "sleep-streak-7": "Rest streak",
    "sleep-deep": "Deep sleep",
    "sleep-unbroken": "Unbroken night",
    "sleep-regular": "Regular bedtime",
    "resting-hr-60": "Resting pulse under 60",
    "resting-hr-down": "Stronger heart",
    "hrv-up": "Better recovery",
    "oxygen-week": "Oxygen on track",
    "full-day": "Full day",
    "full-week": "Full habits week",
  },
};

export const TIER_NAMES: Record<"es" | "en", Record<Tier, string>> = {
  es: { bronze: "Bronce", silver: "Plata", gold: "Oro", platinum: "Platino", diamond: "Diamante" },
  en: { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum", diamond: "Diamond" },
};
