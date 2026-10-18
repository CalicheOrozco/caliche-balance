import { describe, expect, it } from "vitest";
import { bodyFatAge } from "../shared/bodyAge.ts";
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
