import { describe, expect, it } from "vitest";
import { achievements, localDay } from "../shared/achievements.ts";
import type { GoalHistoryEntry, MeasurementDto } from "../shared/schemas.ts";

const profile = { sex: "male" as const, heightCm: 185, birthDate: "1998-01-01" };
const timeZone = "America/Toronto";
// Monday 2026-10-19, noon in Toronto (EDT, UTC-4).
const now = Date.parse("2026-10-19T12:00:00-04:00");
const DAY = 24 * 60 * 60 * 1000;

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
const daily = (count: number, daysAgo = 0, weight = 99) =>
  Array.from({ length: count }, (_, i) => reading(Date.parse("2026-10-19T07:00:00-04:00") - (daysAgo + count - 1 - i) * DAY, weight));

describe("achievements", () => {
  it("counts days in the person's time zone, not UTC", () => {
    // 23:30 in Toronto is already the next day in UTC.
    expect(localDay(Date.parse("2026-10-18T23:30:00-04:00"), timeZone)).toBe(localDay(Date.parse("2026-10-18T08:00:00-04:00"), timeZone));
    expect(localDay(Date.parse("2026-10-18T23:30:00-04:00"), "UTC")).toBe(localDay(Date.parse("2026-10-19T08:00:00-04:00"), "UTC"));
  });

  it("tracks streaks: earned on the 7th day in a row, alive through yesterday, reset by a gap", () => {
    const week = daily(7);
    const a = run(week);
    expect(a.streak).toEqual({ current: 7, best: 7, weighedToday: true });
    expect(badge(a, "streak-7").earnedAt).toBe(week[6]!.measuredAt);
    expect(badge(a, "first-weigh-in").earnedAt).toBe(week[0]!.measuredAt);

    // Weighed through yesterday: today's weigh-in may still come.
    expect(run(daily(5, 1)).streak).toEqual({ current: 5, best: 5, weighedToday: false });
    // Last weigh-in two days ago: the streak is over, the best stays.
    const broken = run(daily(5, 2));
    expect(broken.streak).toEqual({ current: 0, best: 5, weighedToday: false });
    expect(badge(broken, "streak-7")).toMatchObject({ earnedAt: null, progress: { value: 5, target: 7 } });
  });

  it("earns the habit badge after 4 weeks in a row with 3 or more weigh-in days", () => {
    // Mondays, Wednesdays and Fridays of the 4 weeks before this one.
    const weeks = [4, 3, 2, 1].flatMap((w) => [7, 5, 3].map((d) => reading(Date.parse("2026-10-19T07:00:00-04:00") - (w * 7 - (7 - d)) * DAY, 99)));
    const a = run(weeks);
    expect(badge(a, "habit-4").earnedAt).toBe(weeks[weeks.length - 1]!.measuredAt);
    expect(badge(a, "habit-12").progress).toEqual({ value: 4, target: 12 });
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

  it("rewards health, not only weight: 5 % loss, body fat down, waist and score", () => {
    const a = run([
      reading("2026-05-01T07:00:00-04:00", 104),
      reading("2026-10-18T07:00:00-04:00", 98.8),
      reading("2026-10-19T07:00:00-04:00", 98.5, { waistCm: 98 }),
    ]);
    // 104 to 98.8 is exactly 5 %.
    expect(badge(a, "loss-5").earnedAt).toBe(new Date(Date.parse("2026-10-18T07:00:00-04:00")).toISOString());
    expect(badge(a, "loss-10").progress?.value).toBeCloseTo(((104 - 98.5) / 104) * 100, 6);
    expect(badge(a, "waist-first").earnedAt).not.toBeNull();
    // 98 cm on 185 cm is over half the height.
    expect(badge(a, "waist-healthy").earnedAt).toBeNull();
    expect(badge(a, "healthy-bmi").earnedAt).toBeNull();
  });

  it("keeps goal badges from the history of reached goals", () => {
    const history = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ kind: "weight" as const, target: 95 - i, setAt: "2026-01-01T00:00:00.000Z", reachedAt: `2026-0${i + 2}-01T00:00:00.000Z` }));
    expect(badge(run([], history(1)), "goal-1").earnedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(badge(run([], history(3)), "goal-3").earnedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(badge(run([], history(2)), "goal-3")).toMatchObject({ earnedAt: null, progress: { value: 2, target: 3 } });
  });
});
