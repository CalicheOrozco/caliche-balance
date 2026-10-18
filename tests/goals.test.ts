import { describe, expect, it } from "vitest";
import { dailyTrend, estimateEta, goalProgress } from "../shared/goals.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 18);

describe("goalProgress", () => {
  it("measures the way from start to target when losing", () => {
    expect(goalProgress(100, 95, 90)).toEqual({ fraction: 0.5, remaining: 5, reached: false, direction: "down" });
    expect(goalProgress(100, 89.5, 90)).toMatchObject({ fraction: 1, remaining: 0, reached: true });
  });

  it("works for gaining and never goes below zero when moving away", () => {
    expect(goalProgress(60, 63, 66)).toMatchObject({ fraction: 0.5, remaining: 3, direction: "up" });
    expect(goalProgress(60, 58, 66)).toMatchObject({ fraction: 0, remaining: 8 });
  });

  it("has no progress without a starting value", () => {
    expect(goalProgress(null, 95, 90)).toMatchObject({ fraction: 0, remaining: 5, direction: "down" });
  });
});

describe("dailyTrend and estimateEta", () => {
  const losing = [0, 7, 14, 21].map((d) => ({ time: now - (21 - d) * DAY, value: 100 - d * 0.1 })); // -0.1 kg/day

  it("fits the last four weeks", () => {
    expect(dailyTrend(losing, now)).toBeCloseTo(-0.1, 5);
  });

  it("needs three readings over at least a week", () => {
    expect(dailyTrend(losing.slice(0, 2), now)).toBeNull();
    expect(dailyTrend([{ time: now - 2 * DAY, value: 90 }, { time: now - DAY, value: 89 }, { time: now, value: 88 }], now)).toBeNull();
  });

  it("estimates weeks, or says why it cannot", () => {
    expect(estimateEta(goalProgress(100, 97.9, 90), -0.1)).toEqual({ kind: "weeks", weeks: 11 });
    expect(estimateEta(goalProgress(100, 97.9, 90), 0.05)).toEqual({ kind: "wrong-way" });
    expect(estimateEta(goalProgress(100, 97.9, 90), null)).toEqual({ kind: "unknown" });
    expect(estimateEta(goalProgress(100, 89, 90), -0.1)).toEqual({ kind: "reached" });
  });
});
