/**
 * Numbers behind the fat loss tips.
 *
 * - Pace: 1 to 2 lb (0.45 to 0.9 kg) a week, NIH National Heart, Lung, and Blood Institute,
 *   "Aim for a Healthy Weight". A deficit of about 500 kcal a day gives roughly 0.45 kg a week.
 * - Calorie floor: NHLBI suggests 1,200 to 1,500 kcal a day for women and 1,500 to 1,800 for men
 *   for weight loss; lower intakes need medical supervision.
 */

export const SAFE_LOSS_KG_PER_WEEK = { min: 0.45, max: 0.9 } as const;
export const DAILY_DEFICIT_KCAL = 500;
export const MIN_INTAKE_KCAL = { female: 1200, male: 1500 } as const;

export interface LossPlan {
  /** What the plan aims for: the person's own weight goal, or the top of the healthy range. */
  target: "goal" | "healthy";
  targetKg: number;
  toLoseKg: number;
  /** Weeks at the fastest and the slowest safe pace, rounded up. */
  weeksFast: number;
  weeksSlow: number;
}

/**
 * The weight to aim for and how long a safe pace takes to get there. Null when there is nothing
 * to lose: no goal below the current weight and already within the healthy range.
 */
export function lossPlan(currentKg: number, healthyMaxKg: number, goalKg: number | null): LossPlan | null {
  const target = goalKg !== null && goalKg < currentKg ? { kind: "goal" as const, kg: goalKg } : currentKg > healthyMaxKg ? { kind: "healthy" as const, kg: healthyMaxKg } : null;
  if (!target) return null;
  const toLoseKg = currentKg - target.kg;
  return {
    target: target.kind,
    targetKg: target.kg,
    toLoseKg,
    weeksFast: Math.ceil(toLoseKg / SAFE_LOSS_KG_PER_WEEK.max),
    weeksSlow: Math.ceil(toLoseKg / SAFE_LOSS_KG_PER_WEEK.min),
  };
}
