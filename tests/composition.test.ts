import { describe, expect, it } from "vitest";
import { effectiveBodyFat, recalculate } from "../shared/composition.ts";

describe("recalculate (Sun 2003, Janssen 2000/2004, Katch-McArdle)", () => {
  it("reproduces the published equations for a man", () => {
    // 185 cm, 99.55 kg, 495 ohm, 28 years: Ht²/R = 34225 / 495 = 69.1414
    const c = recalculate({ sex: "male", heightCm: 185, age: 28, weightKg: 99.55, impedance: 495 })!;
    const index = 34225 / 495;
    expect(c.fatFreeMassKg).toBeCloseTo(-10.678 + 0.652 * index + 0.262 * 99.55 + 0.015 * 495, 6);
    expect(c.fatFreeMassKg).toBeCloseTo(67.91, 2);
    expect(c.bodyFatPct).toBeCloseTo(31.78, 2);
    expect(c.bodyWaterL).toBeCloseTo(1.203 + 0.449 * index + 0.176 * 99.55, 6);
    expect(c.skeletalMuscleKg).toBeCloseTo(0.401 * index + 3.825 - 0.071 * 28 + 5.102, 6);
    expect(c.bmrKcal).toBeCloseTo(370 + 21.6 * c.fatFreeMassKg, 6);
    expect(c.muscleClass).toBeNull(); // the cut points were derived at 60+
  });

  it("uses the women's equations", () => {
    const c = recalculate({ sex: "female", heightCm: 162, age: 65, weightKg: 61, impedance: 560 })!;
    const index = (162 * 162) / 560;
    expect(c.fatFreeMassKg).toBeCloseTo(-9.529 + 0.696 * index + 0.168 * 61 + 0.016 * 560, 6);
    expect(c.bodyWaterL).toBeCloseTo(3.747 + 0.45 * index + 0.113 * 61, 6);
    expect(c.skeletalMuscleKg).toBeCloseTo(0.401 * index - 0.071 * 65 + 5.102, 6);
    expect(c.muscleClass).toBe("normal");
  });

  it("refuses readings that cannot describe a body", () => {
    const base = { sex: "male" as const, heightCm: 180, age: 30, weightKg: 80 };
    expect(recalculate({ ...base, impedance: null })).toBeNull();
    expect(recalculate({ ...base, impedance: 50 })).toBeNull();
    expect(recalculate({ ...base, impedance: 1500 })).toBeNull();
    expect(recalculate({ ...base, age: 15, impedance: 500 })).toBeNull();
  });
});

describe("effectiveBodyFat", () => {
  it("prefers the recalculation and falls back to the scale's value", () => {
    const base = { sex: "male" as const, heightCm: 185, age: 28, weightKg: 99.55 };
    expect(effectiveBodyFat({ ...base, impedance: 495, bodyFatPct: 30.2 })).toMatchObject({ source: "north-america" });
    expect(effectiveBodyFat({ ...base, impedance: null, bodyFatPct: 30.2 })).toEqual({ value: 30.2, source: "xiaomi" });
    expect(effectiveBodyFat({ ...base, impedance: null, bodyFatPct: null })).toBeNull();
  });
});
