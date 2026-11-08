import { describe, expect, it } from "vitest";
import { bodyFatAge, metabolicAge } from "../shared/bodyAge.ts";
import { assessWaist } from "../shared/waist.ts";

describe("bodyFatAge (Kelly 2009, NHANES DXA medians)", () => {
  it("finds the age whose median matches, between table points", () => {
    // Mexican American men: 27.2 % at 30, 27.9 % at 35.
    expect(bodyFatAge(27.2, "male", "mexican-american")).toEqual({ kind: "age", age: 30 });
    expect(bodyFatAge(27.55, "male", "mexican-american")).toEqual({ kind: "age", age: 33 });
  });

  it("says under 20 or over the peak instead of extrapolating", () => {
    expect(bodyFatAge(15, "male", "white")).toEqual({ kind: "under", age: 20 });
    expect(bodyFatAge(31.8, "male", "mexican-american")).toEqual({ kind: "over", age: 70 });
    // Women peak at 65 (white): anything at or above it reads "65 or older".
    expect(bodyFatAge(43.0, "female", "white")).toEqual({ kind: "over", age: 65 });
  });
});

describe("assessWaist", () => {
  it("uses waist-to-height and both national cut points", () => {
    const a = assessWaist(95, 185, "male");
    expect(a.ratio).toBeCloseTo(0.514, 3);
    expect(a.band.key).toBe("whtr-increased");
    expect(a.usCanada).toEqual({ cutoffCm: 102, above: false });
    expect(a.mexico).toEqual({ cutoffCm: 90, above: true });
    expect(assessWaist(80, 170, "female").band.key).toBe("whtr-low");
    expect(assessWaist(110, 170, "female").band.key).toBe("whtr-high");
  });
});

describe("metabolicAge", () => {
  it("gives a typical person their own age", () => {
    // Mexican American men: median 26.72 % at 28.
    expect(metabolicAge({ fatPct: 26.72, weightKg: 80, age: 28, sex: "male" })).toEqual({ kind: "age", age: 28 });
  });

  it("adds about 4 years per kg of fat above typical, with no ceiling at the median curve", () => {
    // 100.7 kg at 31.8 %: 28 + 21.6 / 5 x 100.7 x (31.8 - 26.72) / 100 = 50.1.
    expect(metabolicAge({ fatPct: 31.8, weightKg: 100.7, age: 28, sex: "male" })).toEqual({ kind: "age", age: 50 });
  });

  it("keeps very lean and very fat bodies inside 18 to 80", () => {
    expect(metabolicAge({ fatPct: 12, weightKg: 70, age: 28, sex: "male" })).toEqual({ kind: "under", age: 18 });
    expect(metabolicAge({ fatPct: 45, weightKg: 130, age: 50, sex: "male" })).toEqual({ kind: "over", age: 80 });
  });
});
