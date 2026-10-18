import { describe, expect, it } from "vitest";
import type { MeasurementDto } from "../shared/schemas.ts";
import { keepForOffline } from "../src/offline.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 18);

function reading(daysAgo: number, bodyFatPct: number | null): MeasurementDto {
  return {
    id: String(daysAgo),
    measuredAt: new Date(now - daysAgo * DAY).toISOString(),
    weightKg: 90,
    bodyFatPct,
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
    source: "zepp",
  };
}

describe("keepForOffline", () => {
  it("keeps the last three months", () => {
    const kept = keepForOffline([reading(1, 30), reading(45, 30), reading(89, 30), reading(91, 30), reading(400, 30)], now);
    expect(kept.map((m) => m.id)).toEqual(["1", "45", "89"]);
  });

  it("always keeps the newest weigh-in and the newest one with body composition", () => {
    const kept = keepForOffline([reading(120, null), reading(200, 31), reading(300, 32)], now);
    expect(kept.map((m) => m.id)).toEqual(["120", "200"]);
  });
});
