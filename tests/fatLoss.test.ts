import { describe, expect, it } from "vitest";
import { lossPlan } from "../shared/fatLoss.ts";

describe("lossPlan", () => {
  it("aims for the person's own goal when it is below the current weight", () => {
    // 99.6 to 93 kg is 6.6 kg: 8 weeks at 0.9 kg a week, 15 at 0.45.
    expect(lossPlan(99.6, 85.2, 93)).toEqual({ target: "goal", targetKg: 93, toLoseKg: expect.closeTo(6.6, 6), weeksFast: 8, weeksSlow: 15 });
  });

  it("falls back to the top of the healthy range without a goal", () => {
    expect(lossPlan(99.6, 85.2, null)).toMatchObject({ target: "healthy", targetKg: 85.2, weeksFast: 16, weeksSlow: 32 });
  });

  it("has no plan when there is nothing to lose", () => {
    expect(lossPlan(80, 85.2, null)).toBeNull();
    // A goal above the current weight is not a loss goal.
    expect(lossPlan(80, 85.2, 82)).toBeNull();
  });
});
