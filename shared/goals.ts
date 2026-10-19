/** Progress toward a weight or body fat goal. Owns every goal calculation; the UI only renders it. */

import type { Band } from "./reference.ts";

export interface GoalProgress {
  /** 0 to 1 of the way from the starting value to the target. */
  fraction: number;
  /** Distance still to go, always positive; 0 once reached. */
  remaining: number;
  reached: boolean;
  direction: "down" | "up";
}

export function goalProgress(start: number | null, current: number, target: number): GoalProgress {
  const direction = target < (start ?? current) ? "down" : "up";
  const reached = direction === "down" ? current <= target : current >= target;
  const remaining = reached ? 0 : Math.abs(target - current);
  // Without a starting value there is nothing to measure against yet.
  const total = start === null ? 0 : Math.abs(target - start);
  const done = start === null ? 0 : direction === "down" ? start - current : current - start;
  const fraction = reached ? 1 : total > 0 ? Math.min(Math.max(done / total, 0), 1) : 0;
  return { fraction, remaining, reached, direction };
}

export interface Point {
  time: number;
  value: number;
}

const DAY = 24 * 60 * 60 * 1000;
export const TREND_DAYS = 28;

/**
 * Change per day over the last four weeks (least-squares line), so one heavy day does not swing
 * the estimate. Needs 3 readings spanning a week; otherwise the trend is unknown (null).
 */
export function dailyTrend(points: Point[], now = Date.now()): number | null {
  const recent = points.filter((p) => p.time >= now - TREND_DAYS * DAY && p.time <= now);
  if (recent.length < 3) return null;
  const times = recent.map((p) => p.time);
  if (Math.max(...times) - Math.min(...times) < 7 * DAY) return null;
  const meanT = times.reduce((a, b) => a + b, 0) / recent.length;
  const meanV = recent.reduce((a, p) => a + p.value, 0) / recent.length;
  let num = 0;
  let den = 0;
  for (const p of recent) {
    num += (p.time - meanT) * (p.value - meanV);
    den += (p.time - meanT) ** 2;
  }
  return den === 0 ? null : (num / den) * DAY;
}

export type Eta =
  | { kind: "reached" }
  | { kind: "unknown" }
  | { kind: "wrong-way" }
  | { kind: "weeks"; weeks: number };

/** Weeks to the target at the recent pace, or why it cannot be estimated. */
export function estimateEta(progress: GoalProgress, perDay: number | null): Eta {
  if (progress.reached) return { kind: "reached" };
  if (perDay === null || Math.abs(perDay) < 1e-6) return { kind: "unknown" };
  const towardTarget = progress.direction === "down" ? perDay < 0 : perDay > 0;
  if (!towardTarget) return { kind: "wrong-way" };
  const days = progress.remaining / Math.abs(perDay);
  // Beyond two years the "estimate" says more about noise than about pace.
  if (days > 730) return { kind: "unknown" };
  return { kind: "weeks", weeks: Math.max(1, Math.round(days / 7)) };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Weight maintenance means staying within 3 % of a weight: Stevens J, Truesdale KP, McClain JE,
 * Cai J. The definition of weight maintenance. Int J Obes 2006;30:391-9.
 */
export const MAINTAIN_FRACTION = 0.03;

export function maintainRange(centerKg: number): { minKg: number; maxKg: number } {
  return { minKg: centerKg * (1 - MAINTAIN_FRACTION), maxKg: centerKg * (1 + MAINTAIN_FRACTION) };
}

export type MaintainSide = "above" | "below" | null;

/** The range as bands for a range bar: inside is good, either side is a warning. */
export function maintainBands(range: { minKg: number; maxKg: number }, toUnit: (kg: number) => number = (kg) => kg): Band[] {
  const min = toUnit(range.minKg);
  const max = toUnit(range.maxKg);
  return [
    { key: "maintain-below", min: null, max: min, status: "warn" },
    { key: "maintain-in", min, max, status: "good" },
    { key: "maintain-above", min: max, max: null, status: "warn" },
  ];
}

export function maintainSide(range: { minKg: number; maxKg: number }, kg: number): MaintainSide {
  return kg > range.maxKg ? "above" : kg < range.minKg ? "below" : null;
}

/**
 * The next weight goal after reaching one: 5 % less, the smallest loss with clear health benefits
 * (CDC, "Losing Weight"), but never below the top of the healthy range. Null when already there.
 */
export const NEXT_STEP_FRACTION = 0.05;

export function nextWeightGoal(currentKg: number, healthyMaxKg: number): number | null {
  if (currentKg <= healthyMaxKg) return null;
  return Math.max(round1(healthyMaxKg), round1(currentKg * (1 - NEXT_STEP_FRACTION)));
}

/** The next body fat goal: the top of the healthy range for the person's sex and age, if still above it. */
export function nextBodyFatGoal(currentPct: number, healthyMaxPct: number): number | null {
  return currentPct > healthyMaxPct ? healthyMaxPct : null;
}

/** Whole days between setting a goal and reaching it. */
export function daysToReach(setAt: Date, reachedAt: Date): number {
  return Math.max(0, Math.round((reachedAt.getTime() - setAt.getTime()) / MS_PER_DAY));
}

export interface GoalState {
  weight: { targetKg: number; startKg: number | null; setAt: Date; reachedAt: Date | null } | null;
  bodyFat: { targetPct: number; startPct: number | null; setAt: Date; reachedAt: Date | null } | null;
  maintain: { minKg: number; maxKg: number; setAt: Date; outside: MaintainSide } | null;
}

export type GoalEvent =
  | { kind: "weight-reached"; targetKg: number; days: number }
  | { kind: "fat-reached"; targetPct: number; days: number }
  | { kind: "maintain-left"; side: "above" | "below"; weightKg: number; minKg: number; maxKg: number };

export interface GoalChanges {
  weightReachedAt?: Date;
  fatReachedAt?: Date;
  maintainOutside?: MaintainSide;
}

/**
 * What the newest readings change in the goals, and what to tell the person. Only readings taken
 * after a goal was set count. A goal is reached once (its date is kept even if the value moves back),
 * and maintenance only alerts when the weight leaves the range, not on every reading outside it.
 */
export function evaluateGoals(
  goals: GoalState,
  latestWeight: { kg: number; at: Date } | null,
  latestFat: { pct: number; at: Date } | null,
): { changes: GoalChanges; events: GoalEvent[] } {
  const changes: GoalChanges = {};
  const events: GoalEvent[] = [];
  const w = goals.weight;
  if (w && !w.reachedAt && latestWeight && latestWeight.at >= w.setAt && goalProgress(w.startKg, latestWeight.kg, w.targetKg).reached) {
    changes.weightReachedAt = latestWeight.at;
    events.push({ kind: "weight-reached", targetKg: w.targetKg, days: daysToReach(w.setAt, latestWeight.at) });
  }
  const b = goals.bodyFat;
  if (b && !b.reachedAt && latestFat && latestFat.at >= b.setAt && goalProgress(b.startPct, latestFat.pct, b.targetPct).reached) {
    changes.fatReachedAt = latestFat.at;
    events.push({ kind: "fat-reached", targetPct: b.targetPct, days: daysToReach(b.setAt, latestFat.at) });
  }
  const m = goals.maintain;
  if (m && latestWeight && latestWeight.at >= m.setAt) {
    const side = maintainSide(m, latestWeight.kg);
    if (side !== m.outside) {
      changes.maintainOutside = side;
      if (side !== null) events.push({ kind: "maintain-left", side, weightKg: latestWeight.kg, minKg: m.minKg, maxKg: m.maxKg });
    }
  }
  return { changes, events };
}
