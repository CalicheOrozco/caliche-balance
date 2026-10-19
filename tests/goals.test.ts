import { describe, expect, it } from "vitest";
import { dailyTrend, estimateEta, evaluateGoals, goalProgress, maintainRange, nextBodyFatGoal, nextWeightGoal } from "../shared/goals.ts";

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

describe("goal milestones", () => {
  const setAt = new Date(Date.UTC(2026, 0, 1));
  const at = (days: number) => new Date(setAt.getTime() + days * DAY);
  const none = { weight: null, bodyFat: null, maintain: null };

  it("marks a weight goal reached once, with the days it took", () => {
    const goals = { ...none, weight: { targetKg: 93, startKg: 99.6, setAt, reachedAt: null } };
    expect(evaluateGoals(goals, { kg: 92.9, at: at(98) }, null)).toEqual({
      changes: { weightReachedAt: at(98) },
      events: [{ kind: "weight-reached", targetKg: 93, days: 98 }],
    });
    // Already reached: nothing new, even if the weight drops further.
    expect(evaluateGoals({ ...goals, weight: { ...goals.weight, reachedAt: at(98) } }, { kg: 92, at: at(100) }, null)).toEqual({ changes: {}, events: [] });
    // A reading from before the goal was set does not count.
    expect(evaluateGoals(goals, { kg: 92, at: at(-1) }, null).events).toEqual([]);
  });

  it("marks a body fat goal reached", () => {
    const goals = { ...none, bodyFat: { targetPct: 24, startPct: 31.8, setAt, reachedAt: null } };
    expect(evaluateGoals(goals, null, { pct: 23.9, at: at(10) }).events).toEqual([{ kind: "fat-reached", targetPct: 24, days: 10 }]);
    expect(evaluateGoals(goals, null, { pct: 25, at: at(10) }).events).toEqual([]);
  });

  it("alerts when the weight leaves the maintenance range, not again while it stays out", () => {
    const range = maintainRange(93);
    expect(range.minKg).toBeCloseTo(90.21, 2);
    expect(range.maxKg).toBeCloseTo(95.79, 2);
    const goals = { ...none, maintain: { ...range, setAt, outside: null } };
    expect(evaluateGoals(goals, { kg: 94, at: at(5) }, null)).toEqual({ changes: {}, events: [] });
    expect(evaluateGoals(goals, { kg: 96, at: at(5) }, null)).toEqual({
      changes: { maintainOutside: "above" },
      events: [{ kind: "maintain-left", side: "above", weightKg: 96, ...range }],
    });
    const outside = { ...goals, maintain: { ...goals.maintain, outside: "above" as const } };
    expect(evaluateGoals(outside, { kg: 96.5, at: at(6) }, null)).toEqual({ changes: {}, events: [] });
    // Back in range: the state clears quietly, so a later exit alerts again.
    expect(evaluateGoals(outside, { kg: 94, at: at(7) }, null)).toEqual({ changes: { maintainOutside: null }, events: [] });
  });

  it("suggests the next goal: 5 % less, never below the healthy range", () => {
    expect(nextWeightGoal(93, 85.2)).toBe(88.4);
    expect(nextWeightGoal(88, 85.2)).toBe(85.2);
    expect(nextWeightGoal(84, 85.2)).toBeNull();
    expect(nextBodyFatGoal(24, 20)).toBe(20);
    expect(nextBodyFatGoal(19, 20)).toBeNull();
  });
});
