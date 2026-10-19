import { bodyFatOf, compositionOf, type ProfileFacts } from "./composition.ts";
import type { MeasurementDto } from "./schemas.ts";
import { scoreOf } from "./score.ts";

/**
 * "Real weight": an exponentially smoothed weight that removes day-to-day water swings, as in
 * John Walker's The Hacker's Diet (each weigh-in moves the trend 10 % of the way toward it).
 * It needs regular weigh-ins to mean anything, which is why a streak unlocks it.
 */
export const TREND_SMOOTHING = 0.1;

const DAY = 24 * 60 * 60 * 1000;

export interface TrendPoint {
  time: number;
  weightKg: number;
  trendKg: number;
}

/** The trend after each weigh-in, oldest first. */
export function weightTrend(measurements: { measuredAt: string; weightKg: number }[]): TrendPoint[] {
  const sorted = [...measurements].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
  let trend: number | null = null;
  return sorted.map((m) => {
    trend = trend === null ? m.weightKg : trend + TREND_SMOOTHING * (m.weightKg - trend);
    return { time: Date.parse(m.measuredAt), weightKg: m.weightKg, trendKg: trend };
  });
}

/** The latest trend and how much it moved in the last 7 days (kg per week); null without enough data. */
export function trendNow(points: TrendPoint[]): { trendKg: number; perWeekKg: number | null } | null {
  const last = points[points.length - 1];
  if (!last) return null;
  // The trend a week before the latest weigh-in (the newest point at or before it).
  const weekAgo = [...points].reverse().find((p) => p.time <= last.time - 7 * DAY);
  return { trendKg: last.trendKg, perWeekKg: weekAgo ? last.trendKg - weekAgo.trendKg : null };
}

export interface PeriodSummary {
  /** Weigh-ins in the period. */
  count: number;
  weightKg: number | null;
  bodyFatPct: number | null;
  fatMassKg: number | null;
  leanSoftKg: number | null;
  skeletalMuscleKg: number | null;
  score: number | null;
  /** Latest waist in the period. */
  waistCm: number | null;
}

const average = (values: (number | null)[]) => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
};

/** Averages over weigh-ins in [from, to), so one heavy day does not decide the comparison. */
export function summarize(profile: ProfileFacts, measurements: MeasurementDto[], from: number, to: number): PeriodSummary {
  const inside = measurements.filter((m) => Date.parse(m.measuredAt) >= from && Date.parse(m.measuredAt) < to);
  const comp = inside.map((m) => compositionOf(profile, m));
  const waist = [...inside].sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt)).find((m) => m.waistCm !== null);
  return {
    count: inside.length,
    weightKg: average(inside.map((m) => m.weightKg)),
    bodyFatPct: average(inside.map((m) => bodyFatOf(profile, m)?.value ?? null)),
    fatMassKg: average(comp.map((c) => c?.fatMassKg ?? null)),
    leanSoftKg: average(comp.map((c) => c?.leanSoftKg ?? null)),
    skeletalMuscleKg: average(comp.map((c) => c?.skeletalMuscleKg ?? null)),
    score: average(inside.map((m) => (m.bodyFatPct !== null || m.impedance !== null ? scoreOf(profile, m).score : null))),
    waistCm: waist?.waistCm ?? null,
  };
}

/** The last `days` days against the `days` before them. */
export function periodReport(profile: ProfileFacts, measurements: MeasurementDto[], days: number, now: number) {
  return {
    current: summarize(profile, measurements, now - days * DAY, now + 1),
    previous: summarize(profile, measurements, now - 2 * days * DAY, now - days * DAY),
  };
}
