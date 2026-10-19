import { describe, expect, it } from "vitest";
import { achievements, levelOf, localDay } from "../shared/achievements.ts";
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

const run = (measurements: MeasurementDto[], goalHistory: GoalHistoryEntry[] = []) => achievements({ profile, measurements, goalHistory, timeZone, now });
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
});
