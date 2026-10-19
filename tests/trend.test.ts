import { describe, expect, it } from "vitest";
import type { MeasurementDto } from "../shared/schemas.ts";
import { periodReport, trendNow, weightTrend } from "../shared/trend.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 19, 12);
const profile = { sex: "male" as const, heightCm: 185, birthDate: "1998-01-01" };

function reading(daysAgo: number, weightKg: number, extra: Partial<MeasurementDto> = {}): MeasurementDto {
  return {
    id: String(daysAgo),
    measuredAt: new Date(now - daysAgo * DAY).toISOString(),
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

describe("weight trend", () => {
  it("moves 10 % of the way toward each weigh-in, so one heavy day barely shifts it", () => {
    const points = weightTrend([reading(2, 100), reading(1, 101), reading(0, 100)]);
    expect(points.map((p) => p.trendKg)).toEqual([100, 100.1, expect.closeTo(100.09, 6)]);
  });

  it("reports the change over the last week", () => {
    const points = weightTrend(Array.from({ length: 15 }, (_, i) => reading(14 - i, 100 - i * 0.1)));
    const now = trendNow(points)!;
    expect(now.trendKg).toBeCloseTo(points[14]!.trendKg, 9);
    expect(now.perWeekKg).toBeCloseTo(points[14]!.trendKg - points[7]!.trendKg, 9);
    expect(trendNow(weightTrend([reading(0, 100)]))).toEqual({ trendKg: 100, perWeekKg: null });
  });
});

describe("period report", () => {
  it("averages this week against the week before", () => {
    const r = periodReport(profile, [reading(1, 99, { waistCm: 98 }), reading(3, 101), reading(9, 102), reading(10, 104)], 7, now);
    expect(r.current).toMatchObject({ count: 2, weightKg: 100, waistCm: 98, bodyFatPct: null });
    expect(r.previous).toMatchObject({ count: 2, weightKg: 103, waistCm: null });
  });
});
