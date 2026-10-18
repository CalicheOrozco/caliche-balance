import type { Sex } from "./reference.ts";

/**
 * Where a BMI falls among US adults of the same sex and age, from:
 * Fryar CD, Carroll MD, Gu Q, Afful J, Ogden CL. Anthropometric reference data for children and
 * adults: United States, 2015-2018. National Center for Health Statistics. Vital Health Stat 3(46).
 * 2021. Tables 14 (women, pregnant excluded) and 15 (men). NHANES 2015-2018, weighted estimates.
 *
 * Two comparison groups: everyone (by decade of age) and Mexican American adults (by 20-year band).
 */

export type PercentileGroup = "us" | "mexican-american";

/** Percentile ranks that each row lists, in order. */
export const RANKS = [5, 10, 15, 25, 50, 75, 85, 90, 95] as const;

interface AgeRow {
  /** Upper age bound, exclusive. */
  below: number;
  bmi: readonly [number, number, number, number, number, number, number, number, number];
}

const TABLES: Record<PercentileGroup, Record<Sex, AgeRow[]>> = {
  us: {
    female: [
      { below: 30, bmi: [18.6, 19.6, 20.4, 21.9, 26.2, 32.9, 37.4, 39.6, 43.3] },
      { below: 40, bmi: [19.8, 21.2, 22.0, 23.6, 28.3, 34.2, 38.2, 41.1, 46.1] },
      { below: 50, bmi: [20.6, 22.0, 22.8, 24.4, 28.6, 34.8, 39.3, 43.1, 46.6] },
      { below: 60, bmi: [19.6, 21.5, 22.5, 24.3, 29.1, 34.2, 37.7, 41.5, 45.7] },
      { below: 70, bmi: [20.4, 22.2, 23.2, 24.9, 29.2, 34.7, 37.2, 39.5, 42.9] },
      { below: 80, bmi: [20.8, 22.0, 23.3, 25.3, 28.8, 33.3, 35.7, 37.9, 42.1] },
      { below: Infinity, bmi: [19.9, 20.8, 22.2, 23.8, 27.5, 30.8, 33.5, 35.5, 39.3] },
    ],
    male: [
      { below: 30, bmi: [18.7, 20.0, 21.0, 22.6, 26.5, 31.6, 34.4, 36.8, 39.5] },
      { below: 40, bmi: [21.6, 23.0, 23.8, 25.4, 28.9, 33.7, 36.4, 38.3, 43.4] },
      { below: 50, bmi: [22.1, 23.5, 24.7, 26.2, 29.1, 32.8, 35.5, 38.1, 41.8] },
      { below: 60, bmi: [21.8, 22.6, 24.0, 25.2, 29.1, 32.8, 35.5, 37.4, 41.7] },
      { below: 70, bmi: [22.2, 23.2, 23.9, 25.8, 28.9, 33.3, 35.3, 37.1, 40.3] },
      { below: 80, bmi: [20.9, 22.9, 24.1, 25.9, 28.2, 32.8, 34.5, 35.6, 37.2] },
      { below: Infinity, bmi: [21.1, 22.3, 22.9, 24.3, 27.2, 30.2, 32.3, 34.0, 35.5] },
    ],
  },
  "mexican-american": {
    female: [
      { below: 40, bmi: [20.0, 21.6, 23.2, 25.6, 29.7, 36.0, 39.8, 42.7, 48.8] },
      { below: 60, bmi: [22.7, 23.6, 24.8, 26.8, 30.4, 36.0, 38.9, 41.2, 43.4] },
      { below: Infinity, bmi: [23.3, 24.5, 25.3, 27.0, 30.0, 35.2, 38.4, 40.5, 46.2] },
    ],
    male: [
      { below: 40, bmi: [20.6, 22.3, 24.3, 26.4, 29.9, 33.7, 35.9, 37.2, 42.5] },
      { below: 60, bmi: [23.4, 25.1, 25.9, 27.2, 30.1, 33.2, 36.2, 38.6, 42.0] },
      { below: Infinity, bmi: [23.1, 23.9, 24.8, 26.3, 29.2, 31.9, 34.3, 35.7, 37.0] },
    ],
  },
};

export const MIN_PERCENTILE_AGE = 20;

export interface PercentileResult {
  group: PercentileGroup;
  /** Share of people in the group with a lower BMI, 0 to 100. */
  percentile: number;
  /** True when the value is outside the 5th to 95th range the tables give. */
  beyond: "below" | "above" | null;
  /** Age band of the comparison group, in years (ageTo null means "and over"). */
  ageFrom: number;
  ageTo: number | null;
  /** The group's 5th, 50th and 95th percentile BMI, for context. */
  p5: number;
  p50: number;
  p95: number;
}

/** Linear interpolation between the published percentile points. */
export function bmiPercentile(bmi: number, sex: Sex, age: number, group: PercentileGroup): PercentileResult | null {
  if (age < MIN_PERCENTILE_AGE) return null;
  const rows = TABLES[group][sex];
  const index = rows.findIndex((r) => age < r.below);
  const row = rows[index]!.bmi;
  const ageFrom = index === 0 ? MIN_PERCENTILE_AGE : rows[index - 1]!.below;
  const below = rows[index]!.below;
  const base = { group, ageFrom, ageTo: below === Infinity ? null : below - 1, p5: row[0], p50: row[4], p95: row[8] };
  if (bmi <= row[0]) return { ...base, percentile: 5, beyond: "below" };
  if (bmi >= row[8]) return { ...base, percentile: 95, beyond: "above" };
  for (let i = 1; i < row.length; i++) {
    const hi = row[i]!;
    if (bmi <= hi) {
      const lo = row[i - 1]!;
      const share = hi === lo ? 0 : (bmi - lo) / (hi - lo);
      return { ...base, percentile: RANKS[i - 1]! + share * (RANKS[i]! - RANKS[i - 1]!), beyond: null };
    }
  }
  return { ...base, percentile: 95, beyond: "above" };
}
