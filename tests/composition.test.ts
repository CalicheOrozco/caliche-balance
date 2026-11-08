import { describe, expect, it } from "vitest";
import { effectiveBodyFat, recalculate, xiaomiComparable } from "../shared/composition.ts";

describe("recalculate (Bousbiat/Jaffrin 2011, Sun 2003, Janssen 2000/2004, Mifflin-St Jeor)", () => {
  it("reproduces the published equations for a man", () => {
    // 185 cm, 99.55 kg, 495 ohm, 28 years: Ht²/R = 34225 / 495 = 69.1414
    const c = recalculate({ sex: "male", heightCm: 185, age: 28, weightKg: 99.55, impedance: 495 })!;
    const index = 34225 / 495;
    // Foot-to-foot fat-free mass, men (Jaffrin and Bousbiat 2014, eq. 13).
    expect(c.fatFreeMassKg).toBeCloseTo(0.528 * index + 0.306 * 99.55 - 0.0698 * 28 + 0.0353 * 495 - 12.6, 6);
    expect(c.bodyWaterL).toBeCloseTo(1.203 + 0.449 * index + 0.176 * 99.55, 6);
    expect(c.skeletalMuscleKg).toBeCloseTo(0.401 * index + 3.825 - 0.071 * 28 + 5.102, 6);
    expect(c.bmrKcal).toBeCloseTo(10 * 99.55 + 6.25 * 185 - 5 * 28 + 5, 6);
    expect(c.muscleClass).toBeNull(); // the cut points were derived at 60+
  });

  it("uses the women's equations", () => {
    const c = recalculate({ sex: "female", heightCm: 162, age: 65, weightKg: 61, impedance: 560 })!;
    const index = (162 * 162) / 560;
    expect(c.fatFreeMassKg).toBeCloseTo(0.354 * index + 0.229 * 61 - 0.043 * 65 + 0.0177 * 560 + 1.91, 6);
    expect(c.bodyWaterL).toBeCloseTo(3.747 + 0.45 * index + 0.113 * 61, 6);
    expect(c.skeletalMuscleKg).toBeCloseTo(0.401 * index - 0.071 * 65 + 5.102, 6);
    expect(c.muscleClass).toBe("normal");
  });

  it("gives the DXA fat-free mass of the men it was built on, from their mean values", () => {
    // Bousbiat et al. 2011, male development group: 177 cm, 467 ohm, 81.47 kg, 45.7 years; DXA 61.02 kg.
    const c = recalculate({ sex: "male", heightCm: 177, age: 45.7, weightKg: 81.47, impedance: 467 })!;
    expect(c.fatFreeMassKg).toBeCloseTo(61.02, 0);
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

describe("xiaomiComparable", () => {
  it("derives Xiaomi's fat-free mass from its own body fat, for a like-for-like comparison", () => {
    expect(xiaomiComparable({ weightKg: 100, bodyFatPct: 30, waterPct: 50, bmrKcal: 1977, proteinPct: 16.3, muscleKg: 65.9 })).toEqual({
      bodyFatPct: 30,
      fatFreeMassKg: 70,
      bodyWaterPct: 50,
      bmrKcal: 1977,
      proteinPct: 16.3,
      muscleKg: 65.9,
    });
    expect(xiaomiComparable({ weightKg: 100, bodyFatPct: null })).toEqual({
      bodyFatPct: null,
      fatFreeMassKg: null,
      bodyWaterPct: null,
      bmrKcal: null,
      proteinPct: null,
      muscleKg: null,
    });
  });
});

describe("protein and lean soft mass (experimental)", () => {
  it("is fat-free mass minus water and 6.5 % minerals", () => {
    const c = recalculate({ sex: "male", heightCm: 185, age: 28, weightKg: 99.55, impedance: 495 })!;
    expect(c.leanSoftKg).toBeCloseTo(c.fatFreeMassKg * 0.935, 6);
    expect(c.proteinKg).toBeCloseTo(c.fatFreeMassKg - c.bodyWaterL - 0.065 * c.fatFreeMassKg, 6);
    expect(c.proteinPct).toBeCloseTo(15.65, 1);
  });
});
