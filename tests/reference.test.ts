import { describe, expect, it } from "vitest";
import {
  aceBodyFatCategory,
  ageAt,
  assess,
  basalMetabolicRate,
  bmi,
  classifyBmi,
  classifyBmiAsian,
  classifyBodyFat,
} from "../shared/reference.ts";

describe("ageAt", () => {
  it("counts a birthday only once it has happened", () => {
    const birth = new Date("1995-10-20T00:00:00Z");
    expect(ageAt(birth, new Date("2026-10-19T12:00:00Z"))).toBe(30);
    expect(ageAt(birth, new Date("2026-10-20T00:00:00Z"))).toBe(31);
  });
});

describe("BMI", () => {
  it("computes kg/m2", () => {
    expect(bmi(70, 175)).toBeCloseTo(22.86, 2);
  });

  it("uses WHO cut-offs, which differ from the Asian ones at the boundary", () => {
    expect(classifyBmi(24).band.key).toBe("normal");
    expect(classifyBmiAsian(24).band.key).toBe("overweight");
    expect(classifyBmi(25).band.key).toBe("overweight");
    expect(classifyBmi(30).band.key).toBe("obese");
    expect(classifyBmiAsian(27.5).band.key).toBe("obese");
    expect(classifyBmi(18.4).band.key).toBe("underweight");
  });
});

describe("body fat (Gallagher 2000)", () => {
  it("adjusts the healthy range by sex and age", () => {
    expect(classifyBodyFat(20, "male", 30).band.key).toBe("overfat");
    expect(classifyBodyFat(20, "male", 45).band.key).toBe("healthy");
    expect(classifyBodyFat(33, "female", 30).band.key).toBe("overfat");
    expect(classifyBodyFat(33, "female", 65).band.key).toBe("healthy");
    expect(classifyBodyFat(7, "male", 25).band.key).toBe("underfat");
    expect(classifyBodyFat(42, "female", 70).band.key).toBe("obese");
  });
});

describe("ACE categories", () => {
  it("places published category edges correctly", () => {
    expect(aceBodyFatCategory(13, "male").band.key).toBe("athletes");
    expect(aceBodyFatCategory(14, "male").band.key).toBe("fitness");
    expect(aceBodyFatCategory(24, "female").band.key).toBe("fitness");
    expect(aceBodyFatCategory(32, "female").band.key).toBe("obese");
  });
});

describe("assess", () => {
  it("combines every reference for one measurement", () => {
    const result = assess(
      { sex: "male", birthDate: new Date("1996-01-01T00:00:00Z"), heightCm: 175 },
      { measuredAt: new Date("2026-10-18T00:00:00Z"), weightKg: 74, bodyFatPct: 19 },
    );
    expect(result.age).toBe(30);
    expect(result.bmi.band.key).toBe("normal");
    expect(result.bmiAsian.band.key).toBe("overweight");
    expect(result.bodyFat?.band.key).toBe("healthy");
    expect(result.bmrKcal).toBeCloseTo(basalMetabolicRate(74, 175, 30, "male"));
    expect(result.healthyWeight.min).toBeCloseTo(56.66, 1);
    expect(result.notes).toEqual([]);
  });

  it("flags ages the references do not cover", () => {
    const result = assess(
      { sex: "female", birthDate: new Date("2012-01-01T00:00:00Z"), heightCm: 150 },
      { measuredAt: new Date("2026-10-18T00:00:00Z"), weightKg: 45, bodyFatPct: null },
    );
    expect(result.notes).toContain("under-supported-age");
    expect(result.bodyFat).toBeNull();
  });
});
