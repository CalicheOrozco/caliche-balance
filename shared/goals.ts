/** Progress toward a weight or body fat goal. Owns every goal calculation; the UI only renders it. */

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
