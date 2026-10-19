import { describe, expect, it } from "vitest";
import { healthAverages, healthDaySchema, parseHealthNumber } from "../shared/health.ts";

describe("parseHealthNumber", () => {
  it("reads what a Shortcut can send in any region format", () => {
    expect(parseHealthNumber(8452, true)).toBe(8452);
    // Steps with a thousands separator: English, Spanish (Mexico), Spain, and with a space.
    expect(["8,452", "8.452", "8 452", "8 452", "8452 pasos"].map((v) => parseHealthNumber(v, true))).toEqual([8452, 8452, 8452, 8452, 8452]);
    // Decimals in a measure that has them.
    expect(["512.4", "512,4", "512,4 kcal", "1,234.5", "1.234,5", "6,25 km"].map((v) => parseHealthNumber(v, false))).toEqual([512.4, 512.4, 512.4, 1234.5, 1234.5, 6.25]);
    // A repeated mark always separates thousands.
    expect(parseHealthNumber("12,345,678", true)).toBe(12345678);
    // Text with no number is left for the schema to reject.
    expect(parseHealthNumber("nada", true)).toBe("nada");
  });
});

describe("healthDaySchema", () => {
  it("accepts any subset of metrics and rejects an empty or impossible day", () => {
    expect(healthDaySchema.parse({ steps: "8,452", restingHr: 58 })).toEqual({ steps: 8452, restingHr: 58 });
    expect(healthDaySchema.safeParse({ date: "2026-10-19" }).success).toBe(false);
    // Distance from an iPhone set to miles.
    expect(healthDaySchema.parse({ distanceKm: "3,1", distanceUnit: "mi" }).distanceKm).toBeCloseTo(4.989, 3);
    // Without an Apple Watch some metrics have no samples and come as empty text.
    expect(healthDaySchema.parse({ steps: "8452", exerciseMin: "", restingHr: " " })).toEqual({ steps: 8452, exerciseMin: null, restingHr: null });
    expect(healthDaySchema.safeParse({ steps: "", restingHr: "" }).success).toBe(false);
    expect(healthDaySchema.safeParse({ steps: -5 }).success).toBe(false);
    expect(healthDaySchema.safeParse({ restingHr: 400 }).success).toBe(false);
  });

  it("averages only the days that have each metric", () => {
    const day = (steps: number | null, restingHr: number | null) => ({
      date: "2026-10-19",
      steps,
      activeKcal: null,
      exerciseMin: null,
      distanceKm: null,
      restingHr,
      sleepHours: null,
    });
    expect(healthAverages([day(8000, 60), day(10000, null)])).toMatchObject({ steps: 9000, restingHr: 60, sleepHours: null });
  });
});
