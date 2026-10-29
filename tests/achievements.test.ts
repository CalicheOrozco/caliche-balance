import { describe, expect, it } from "vitest";
import { achievements, type HealthDayFacts, levelOf, localDay } from "../shared/achievements.ts";
import type { GoalHistoryEntry, MeasurementDto } from "../shared/schemas.ts";

const profile = { sex: "male" as const, heightCm: 185, birthDate: "1998-01-01" };
const timeZone = "America/Toronto";
// Monday 2026-10-19, noon in Toronto (EDT, UTC-4).
const now = Date.parse("2026-10-19T12:00:00-04:00");
const DAY = 24 * 60 * 60 * 1000;
const morning = Date.parse("2026-10-19T07:00:00-04:00");

let n = 0;
function reading(at: string | number, weightKg: number, extra: Partial<MeasurementDto> = {}): MeasurementDto {
  return {
    id: String(n++),
    measuredAt: new Date(typeof at === "number" ? at : Date.parse(at)).toISOString(),
    weightKg,
    bodyFatPct: null,
    muscleKg: null,
    waterPct: null,
    boneKg: null,
    visceralFat: null,
    proteinPct: null,
    bmrKcal: null,
    bodyAge: null,
    bodyScore: null,
    impedance: null,
    idealWeightKg: null,
    waistCm: null,
    source: "zepp",
    ...extra,
  };
}

const run = (measurements: MeasurementDto[], goalHistory: GoalHistoryEntry[] = [], healthDays: HealthDayFacts[] = []) =>
  achievements({ profile, measurements, goalHistory, healthDays, timeZone, now });
const badge = (a: ReturnType<typeof run>, id: string) => a.badges.find((b) => b.id === id)!;
/** One reading a day at 7:00 Toronto time, ending `daysAgo` days before today. */
const daily = (count: number, daysAgo = 0, weight = (_i: number) => 99, extra: Partial<MeasurementDto> = {}) =>
  Array.from({ length: count }, (_, i) => reading(morning - (daysAgo + count - 1 - i) * DAY, weight(i), extra));

describe("achievements", () => {
  it("counts days in the person's time zone, not UTC", () => {
    // 23:30 in Toronto is already the next day in UTC.
    expect(localDay(Date.parse("2026-10-18T23:30:00-04:00"), timeZone)).toBe(localDay(Date.parse("2026-10-18T08:00:00-04:00"), timeZone));
    expect(localDay(Date.parse("2026-10-18T23:30:00-04:00"), "UTC")).toBe(localDay(Date.parse("2026-10-19T08:00:00-04:00"), "UTC"));
  });

  it("moves a badge up a level each time its count reaches the next threshold", () => {
    expect([0, 1, 3, 4, 12, 52, 99].map((c) => levelOf(c, [1, 4, 12, 26, 52]))).toEqual([0, 1, 1, 2, 3, 5, 5]);
  });

  it("counts every 7 days of a streak, keeps every date, and says how many for the next level", () => {
    const days = daily(21);
    const a = run(days);
    expect(a.streak).toMatchObject({ current: 21, best: 21, bestBefore: 0, weighedToday: true, freezes: 2, nextFreezeIn: null });
    const streak = badge(a, "streak-7");
    // Days 7, 14 and 21 of the streak: 3 times, silver (levels 1, 3, 6, 12, 26).
    expect(streak.dates).toEqual([days[6]!.measuredAt, days[13]!.measuredAt, days[20]!.measuredAt]);
    expect(streak).toMatchObject({ level: 2, nextAt: 6 });
    expect(badge(a, "weigh-days")).toMatchObject({ level: 1, nextAt: 30 });
    expect(badge(a, "weigh-days").dates).toHaveLength(21);
  });

  it("keeps a streak alive through yesterday and ends it after a missed day without freezes", () => {
    expect(run(daily(5, 1)).streak).toMatchObject({ current: 5, best: 5, weighedToday: false, freezes: 0, nextFreezeIn: 2 });
    expect(run(daily(5, 2)).streak).toMatchObject({ current: 0, best: 5, bestBefore: 5, weighedToday: false });
  });

  it("earns a freeze every 7 days (up to 2) and spends it on a missed day", () => {
    // 7 days, a missed day, then 3 more up to today: the freeze covers the gap.
    const a = run([...daily(7, 4), ...daily(3)]);
    expect(a.streak).toMatchObject({ current: 10, freezes: 0, nextFreezeIn: 4 });
    expect(a.streak.frozenDays).toEqual(["2026-10-16"]);
    // Two missed days with one freeze: the streak breaks and the freezes go with it.
    expect(run([...daily(7, 5), ...daily(3)]).streak).toMatchObject({ current: 3, best: 7, bestBefore: 7, freezes: 0 });
    // Missing yesterday with a freeze in hand: still alive today, the freeze is spent.
    expect(run(daily(7, 2)).streak).toMatchObject({ current: 7, freezes: 0, frozenDays: ["2026-10-18"] });
  });

  it("tells the record before the current streak", () => {
    // A 10-day streak that ended, then the current 4 days.
    const a = run([...daily(10, 20), ...daily(4)]);
    expect(a.streak).toMatchObject({ current: 4, best: 10, bestBefore: 10 });
  });

  it("counts each week with 3 or more weigh-in days, and each one with 5", () => {
    // Monday to Friday of the 4 weeks before this one: every week counts for both badges.
    const weeks = [4, 3, 2, 1].flatMap((w) => [0, 1, 2, 3, 4].map((d) => reading(morning - (w * 7 - d) * DAY, 99)));
    const a = run(weeks);
    expect(badge(a, "habit-week")).toMatchObject({ level: 2, nextAt: 12 });
    expect(badge(a, "habit-week").dates).toHaveLength(4);
    expect(badge(a, "challenge-week").dates).toEqual([4, 9, 14, 19].map((i) => weeks[i]!.measuredAt));
  });

  it("counts each further 5 % of weight lost, starting again from the last time", () => {
    // 100 to 95 (first time), then 95 to 90.25 (second), with a bounce in between.
    const a = run([
      reading("2026-06-01T07:00:00-04:00", 100),
      reading("2026-07-01T07:00:00-04:00", 95),
      reading("2026-08-01T07:00:00-04:00", 96),
      reading("2026-09-01T07:00:00-04:00", 91),
      reading("2026-10-01T07:00:00-04:00", 91.2),
    ]);
    // 91 is 5.2 % under 96 (the highest since the first time), so it counts again.
    expect(badge(a, "loss-5").dates).toEqual([Date.parse("2026-07-01T07:00:00-04:00"), Date.parse("2026-09-01T07:00:00-04:00")].map((t) => new Date(t).toISOString()));
    expect(badge(a, "loss-5")).toMatchObject({ level: 2, nextAt: 3 });
  });

  it("counts healthy ranges once per week and the waist once per month", () => {
    // BMI under 25 (80 kg at 1.85 m) every day for 2 weeks, with a healthy waist once a week.
    const a = run([...daily(14, 0, () => 80), reading(morning - 10 * DAY, 80, { waistCm: 90 }), reading(morning - 2 * DAY, 80, { waistCm: 90 })]);
    expect(badge(a, "healthy-bmi").dates).toHaveLength(3); // the 14 days touch 3 Monday-to-Sunday weeks
    expect(badge(a, "waist-healthy").dates).toHaveLength(2);
    expect(badge(a, "waist-month").dates).toHaveLength(1); // both waists are in October
  });

  it("tracks this week's and this month's challenges", () => {
    // Today is Monday: one day weighed this week, with impedance; days left counts today.
    const a = run([...daily(3, 1), reading("2026-10-19T07:00:00-04:00", 99, { impedance: 495, bodyFatPct: 30, waistCm: 98 })]);
    const c = Object.fromEntries(a.challenges.map((x) => [x.id, x]));
    expect(c["week-weigh-5"]).toMatchObject({ value: 1, target: 5, done: false, daysLeft: 7 });
    expect(c["week-full-3"]).toMatchObject({ value: 1, target: 3 });
    expect(c["month-weigh-20"]).toMatchObject({ value: 4, target: 20, daysLeft: 13 });
    expect(c["month-waist"]).toMatchObject({ value: 1, done: true });
  });

  it("counts every reached goal from the history", () => {
    const history = Array.from({ length: 3 }, (_, i) => ({
      kind: "weight" as const,
      target: 95 - i,
      setAt: "2026-01-01T00:00:00.000Z",
      reachedAt: `2026-0${i + 2}-01T00:00:00.000Z`,
    }));
    expect(badge(run([], history), "goal")).toMatchObject({ level: 2, nextAt: 5, dates: history.map((h) => h.reachedAt) });
    expect(badge(run([]), "goal")).toMatchObject({ level: 0, nextAt: 1, dates: [] });
  });

  it("earns Apple Health badges from each day, run, week and month, against published targets", () => {
    const at = (date: string, h: Partial<Omit<HealthDayFacts, "date">> = {}): HealthDayFacts => ({
      date,
      steps: null,
      distanceKm: null,
      flightsClimbed: null,
      standMin: null,
      exerciseMin: null,
      activeKcal: null,
      restingHr: null,
      hrvMs: null,
      bloodOxygenPct: null,
      sleep: null,
      ...h,
    });
    // 23:30 Toronto time the night before the given day.
    const night = (date: string, asleepMin: number, extra: Partial<NonNullable<HealthDayFacts["sleep"]>> = {}) => ({
      asleepMin,
      deepMin: 60,
      awakenings: 1,
      start: new Date(Date.parse(`${date}T23:30:00-04:00`) - DAY).toISOString(),
      ...extra,
    });
    // Monday 12 to Sunday 18 October: a full week.
    const week = ["12", "13", "14", "15", "16", "17", "18"].map((d, i) =>
      at(`2026-10-${d}`, {
        steps: [12_000, 7_500, 8_000, 16_000, 7_100, 21_000, 3_000][i]!,
        distanceKm: 7,
        flightsClimbed: i === 3 ? 12 : 4,
        standMin: 200,
        exerciseMin: [40, 30, 35, 70, 30, 30, 10][i]!,
        activeKcal: [600, 450, 500, 1_100, 400, 480, 200][i]!,
        restingHr: 58,
        bloodOxygenPct: 96,
        sleep: night(`2026-10-${d}`, [430, 425, 450, 425, 300, 480, 420][i]!, { awakenings: i === 2 ? 0 : 1, deepMin: i === 5 ? 50 : 60 }),
      }),
    );
    const a = run([], [], week);
    const dates = (id: string) => badge(a, id).dates.map((d) => d.slice(0, 10));
    expect(dates("steps-10k")).toEqual(["2026-10-12", "2026-10-15", "2026-10-17"]);
    expect(dates("steps-15k")).toEqual(["2026-10-15", "2026-10-17"]);
    expect(dates("steps-20k")).toEqual(["2026-10-17"]);
    // The 5th day of 7,000+ is the 16th; 6 days in a row of 7,000+ is not a 7-day run yet.
    expect(dates("steps-week")).toEqual(["2026-10-16"]);
    expect(dates("steps-streak-7")).toEqual([]);
    // 7 km a day: 42.2 km on the 7th day.
    expect(dates("distance-week")).toEqual(["2026-10-18"]);
    expect(dates("flights-10")).toEqual(["2026-10-15"]);
    expect(dates("stand-3h")).toHaveLength(7);
    expect(dates("exercise-60")).toEqual(["2026-10-15"]);
    // 40 + 30 + 35 + 70 = 175: the 150 minutes on the 15th; 245 by Sunday, short of 300.
    expect(dates("exercise-150")).toEqual(["2026-10-15"]);
    expect(dates("exercise-300")).toEqual([]);
    expect(dates("active-1000")).toEqual(["2026-10-15"]);
    // 600 + 450 + 500 + 1,100 + 400 + 480 = 3,530 on the 17th.
    expect(dates("active-week")).toEqual(["2026-10-17"]);
    // 430, 425, 450, 425 and 480 minutes: the 5th night of 7 hours is the 17th.
    expect(dates("sleep-week")).toEqual(["2026-10-17"]);
    // Deep sleep 60 of 480 minutes is 12.5 %: not that night.
    expect(dates("sleep-deep")).not.toContain("2026-10-17");
    expect(dates("sleep-unbroken")).toEqual(["2026-10-14"]);
    // Every night at 23:30: the 5th one is the 16th.
    expect(dates("sleep-regular")).toEqual(["2026-10-16"]);
    expect(dates("resting-hr-60")).toHaveLength(7);
    expect(dates("oxygen-week")).toEqual(["2026-10-18"]);
    // 7,000 steps, 30 minutes and 7 hours: the 12th, 13th, 14th, 15th and 17th.
    expect(dates("full-day")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-17"]);
    expect(dates("full-week")).toEqual(["2026-10-17"]);
    expect(badge(a, "full-day")).toMatchObject({ group: "balance", level: 1, nextAt: 30 });
  });

  it("counts Apple Health streaks every 7 and 30 days in a row, and compares finished months", () => {
    const day = (i: number, h: Partial<HealthDayFacts>): HealthDayFacts => ({
      date: new Date(Date.parse("2026-08-01T00:00:00Z") + i * DAY).toISOString().slice(0, 10),
      steps: null,
      distanceKm: null,
      flightsClimbed: null,
      standMin: null,
      exerciseMin: null,
      activeKcal: null,
      restingHr: null,
      hrvMs: null,
      bloodOxygenPct: null,
      sleep: null,
      ...h,
    });
    // August and September, 61 days of 30 minutes; one day without exercise on Sept 20 (day 50).
    const days = Array.from({ length: 61 }, (_, i) =>
      day(i, { exerciseMin: i === 50 ? 5 : 30, restingHr: i < 31 ? 70 : 67, hrvMs: i < 31 ? 40 : 43 }),
    );
    const a = run([], [], days);
    const dates = (id: string) => badge(a, id).dates.map((d) => d.slice(0, 10));
    // Days 7, 14, ... 49 of the first run, then 7 days into the second (Sept 27).
    expect(dates("exercise-streak-7")).toEqual(["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18", "2026-09-27"]);
    expect(dates("exercise-streak-30")).toEqual(["2026-08-30"]);
    // September against August: 3 beats lower and 7.5 % more HRV.
    expect(dates("resting-hr-down")).toEqual(["2026-09-30"]);
    expect(dates("hrv-up")).toEqual(["2026-09-30"]);
  });

  it("counts levels within the current year and keeps past years, except long-term progress", () => {
    // 35 days weighed in December 2025 (from 105 kg down to 99.75 kg), then 3 days this year.
    const lastYear = Array.from({ length: 35 }, (_, i) => reading(Date.parse("2025-11-27T07:00:00-05:00") + i * DAY, 105 - i * 0.15));
    const thisYear = daily(3, 0, () => 99);
    const a = run([...lastYear, ...thisYear]);
    // 35 weigh-ins last year (silver: 30) and 3 this year (bronze); every date is kept.
    expect(badge(a, "weigh-days")).toMatchObject({ scope: "year", count: 3, level: 1, nextAt: 30 });
    expect(badge(a, "weigh-days").dates).toHaveLength(38);
    expect(badge(a, "weigh-days").pastYears).toEqual([{ year: 2025, count: 35, level: 2 }]);
    // Each 5 % lost still counts across years.
    expect(badge(a, "loss-5")).toMatchObject({ scope: "all", count: 1, level: 1, pastYears: [] });
  });
});
