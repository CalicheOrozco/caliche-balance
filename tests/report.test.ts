import { describe, expect, it } from "vitest";
import { recalculate } from "../shared/composition.ts";
import { readingReport, recentChanges, waistFor } from "../shared/report.ts";
import type { MeasurementDto } from "../shared/schemas.ts";

const profile = { sex: "male" as const, heightCm: 185, birthDate: "1998-01-01" };
const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 18, 12);

function reading(daysAgo: number, weightKg: number, extra: Partial<MeasurementDto> = {}): MeasurementDto {
  return {
    id: String(daysAgo),
    measuredAt: new Date(now - daysAgo * DAY).toISOString(),
    weightKg,
    bodyFatPct: 30.2,
    muscleKg: null,
    waterPct: null,
    boneKg: null,
    visceralFat: null,
    proteinPct: null,
    bmrKcal: null,
    bodyAge: null,
    bodyScore: null,
    impedance: 495,
    idealWeightKg: null,
    waistCm: null,
    source: "zepp",
    ...extra,
  };
}

describe("readingReport", () => {
  it("groups each measure by status, worst first, with the distance to the healthy range", () => {
    const today = reading(0, 99.55, { waistCm: 98 });
    const report = readingReport(profile, today, [today]);
    const na = recalculate({ sex: "male", heightCm: 185, age: 28, weightKg: 99.55, impedance: 495 })!;

    expect(report.groups.map((g) => [g.status, g.items.map((i) => i.key)])).toEqual([
      ["bad", ["bodyFat"]],
      // Muscle index 10.1 kg/m² is under Janssen's 10.75 cut point for men.
      ["warn", ["bmi", "muscleIndex", "waist"]],
      ["good", []],
    ]);
    const byKey = Object.fromEntries(report.items.map((i) => [i.key, i]));
    // BMI 29.1: to 24.9 at 1.85 m is 99.55 - 24.9 x 1.85².
    expect(byKey.bmi!.toHealthy).toBeCloseTo(99.55 - 24.9 * 1.85 ** 2, 6);
    // Fat to lose to reach 20 % (men under 40) keeping the same fat-free mass.
    expect(byKey.bodyFat!.toHealthy).toBeCloseTo(99.55 - na.fatFreeMassKg / 0.8, 6);
    // Waist 98 cm on 185 cm: 5.5 cm above half the height.
    expect(byKey.waist!.value).toBeCloseTo(98 / 185, 6);
    expect(byKey.waist!.toHealthy).toBeCloseTo(5.5, 6);
    expect(byKey.muscleIndex!.toHealthy).toBeNull();
    expect(report.fatRange).toEqual({ min: 8, max: 20, obese: 25 });
    expect(report.muscleBandsAsGuide).toBe(true);
  });

  it("rates only BMI for a weigh-in without body composition", () => {
    const today = reading(0, 80, { bodyFatPct: null, impedance: null });
    const report = readingReport(profile, today, [today]);
    expect(report.items.map((i) => [i.key, i.band.key, i.toHealthy])).toEqual([["bmi", "normal", null]]);
    expect(report.score.parts.map((p) => p.part)).toEqual(["bmi"]);
  });
});

describe("waistFor", () => {
  it("uses the reading's own waist or a recent earlier one, never a later or stale one", () => {
    const later = reading(0, 99, { waistCm: 97 });
    const recent = reading(60, 99, { waistCm: 100 });
    const stale = reading(200, 99, { waistCm: 105 });
    const target = reading(30, 99);
    expect(waistFor(target, [later, target, recent, stale])).toEqual({ cm: 100, measuredAt: recent.measuredAt });
    expect(waistFor(later, [later, recent])).toEqual({ cm: 97, measuredAt: later.measuredAt });
    expect(waistFor(reading(100, 99), [stale])).toBeNull();
  });
});

describe("recentChanges", () => {
  it("compares with the newest weigh-in a month earlier and with the first one", () => {
    const all = [reading(0, 99.55), reading(20, 100), reading(35, 101), reading(90, 95, { impedance: null })];
    const [weight, fatMass, muscle] = recentChanges(profile, all[0]!, all);
    expect(weight!.key).toBe("weight");
    expect(weight!.vsMonth).toEqual({ delta: 99.55 - 101, measuredAt: all[2]!.measuredAt });
    expect(weight!.vsFirst!.delta).toBeCloseTo(4.55, 6);
    expect(weight!.points.map((p) => p.value)).toEqual([95, 101, 100, 99.55]);
    // Fat mass needs impedance, so the first weigh-in without it is skipped.
    expect(fatMass!.key).toBe("fatMass");
    expect(fatMass!.vsFirst!.measuredAt).toBe(all[2]!.measuredAt);
    expect(muscle!.key).toBe("skeletalMuscle");
  });

  it("has nothing to compare for the first weigh-in", () => {
    const first = reading(0, 90);
    expect(recentChanges(profile, first, [first]).map((c) => [c.key, c.vsMonth, c.vsFirst])).toEqual([
      ["weight", null, null],
      ["fatMass", null, null],
      ["skeletalMuscle", null, null],
    ]);
  });
});
