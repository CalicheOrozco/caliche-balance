import { describe, expect, it } from "vitest";
import { recalculate } from "../shared/composition.ts";
import { bmiPercentile } from "../shared/percentiles.ts";
import { bmiPart, bodyFatPart, bodyScore, musclePart } from "../shared/score.ts";

describe("bmiPercentile (CDC NHANES 2015-2018, tables 14 and 15)", () => {
  it("reads the published points exactly", () => {
    // Men 20-29: 50th percentile BMI 26.5; Mexican American men 20-39: 75th 33.7.
    expect(bmiPercentile(26.5, "male", 28, "us")!.percentile).toBeCloseTo(50, 6);
    expect(bmiPercentile(33.7, "male", 28, "mexican-american")!.percentile).toBeCloseTo(75, 6);
    // Women 60-69: 95th percentile 42.9.
    expect(bmiPercentile(42.9, "female", 65, "us")).toMatchObject({ percentile: 95, beyond: "above" });
  });

  it("interpolates between points and marks values outside 5th to 95th", () => {
    // Men 20-29: 75th 31.6, 85th 34.4 -> 29.1 sits between 50th (26.5) and 75th (31.6).
    expect(bmiPercentile(29.1, "male", 28, "us")!.percentile).toBeCloseTo(50 + ((29.1 - 26.5) / (31.6 - 26.5)) * 25, 6);
    expect(bmiPercentile(15, "female", 25, "us")).toMatchObject({ percentile: 5, beyond: "below" });
    expect(bmiPercentile(25, "male", 18, "us")).toBeNull();
  });
});

describe("Caliche body score", () => {
  it("scores each part against its reference", () => {
    // Men under 40: healthy fat 8-20 %, obese from 25 %.
    expect(bodyFatPart(15, "male", 30)).toBe(100);
    expect(bodyFatPart(25, "male", 30)).toBe(50);
    expect(bodyFatPart(35, "male", 30)).toBe(0);
    expect(bmiPart(22)).toBe(100);
    expect(bmiPart(27.5)).toBeCloseTo(75);
    expect(bmiPart(30)).toBe(50);
    expect(musclePart(11, "male")).toBe(100);
    expect(musclePart(8.5, "male")).toBe(50);
  });

  it("weights fat 50 %, BMI 30 % and muscle 20 %", () => {
    const composition = recalculate({ sex: "male", heightCm: 185, age: 28, weightKg: 99.55, impedance: 495 })!;
    const result = bodyScore({ sex: "male", age: 28, bmi: 99.55 / 1.85 ** 2, bodyFatPct: composition.bodyFatPct, composition });
    const expected =
      0.5 * bodyFatPart(composition.bodyFatPct, "male", 28) + 0.3 * bmiPart(99.55 / 1.85 ** 2) + 0.2 * musclePart(composition.skeletalMuscleIndex, "male");
    expect(result.score).toBe(Math.round(expected));
    expect(result.score).toBe(43);
    expect(result.parts.map((p) => p.part)).toEqual(["bodyFat", "bmi", "muscle"]);
  });

  it("re-weights the parts that exist when there is no impedance", () => {
    const result = bodyScore({ sex: "female", age: 30, bmi: 22, bodyFatPct: null, composition: null });
    expect(result).toEqual({ score: 100, parts: [{ part: "bmi", value: 22, score: 100, weight: 1 }] });
  });
});
