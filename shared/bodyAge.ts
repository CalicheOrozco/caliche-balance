import type { Sex } from "./reference.ts";

/**
 * "Body fat age": the age at which the typical North American adult of your sex has your body fat.
 * Medians of whole-body % fat measured by DXA in NHANES 1999-2004, from Kelly TL, Wilson KE,
 * Heymsfield SB. Dual energy X-ray absorptiometry body composition reference values from NHANES.
 * PLoS ONE 2009;4:e7038, Table S2 (ages 20 to 85, every 5 years).
 *
 * Unlike Xiaomi's "body age", this has a stated meaning. It compares a BIA estimate with DXA
 * medians, so it is an approximation. The medians stop rising around 65 to 75, so a higher body
 * fat reads as "that age or older".
 */

export type AgeGroup = "mexican-american" | "white";

const AGES = [20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85] as const;

const MEDIAN_FAT: Record<AgeGroup, Record<Sex, readonly number[]>> = {
  "mexican-american": {
    male: [24.4, 26.0, 27.2, 27.9, 28.4, 28.8, 29.2, 29.8, 30.2, 30.6, 30.7, 30.7, 30.7, 30.7],
    female: [38.0, 39.2, 40.0, 40.6, 41.2, 42.1, 42.9, 43.4, 43.5, 43.6, 43.5, 43.3, 43.2, 43.0],
  },
  white: {
    male: [23.4, 24.6, 25.7, 26.6, 27.5, 28.2, 29.0, 29.8, 30.5, 31.1, 31.4, 31.6, 31.6, 31.6],
    female: [35.1, 36.0, 37.0, 38.0, 38.9, 39.8, 40.8, 41.7, 42.5, 43.0, 43.0, 42.9, 42.5, 42.1],
  },
};

export type BodyFatAge = { kind: "age"; age: number } | { kind: "under"; age: number } | { kind: "over"; age: number };

/** Linear interpolation on the rising part of the median curve (up to its first peak). */
export function bodyFatAge(bodyFatPct: number, sex: Sex, group: AgeGroup): BodyFatAge {
  const medians = MEDIAN_FAT[group][sex];
  const peak = medians.indexOf(Math.max(...medians));
  if (bodyFatPct < medians[0]!) return { kind: "under", age: AGES[0] };
  if (bodyFatPct >= medians[peak]!) return { kind: "over", age: AGES[peak]! };
  for (let i = 1; i <= peak; i++) {
    const hi = medians[i]!;
    if (bodyFatPct < hi) {
      const lo = medians[i - 1]!;
      const share = hi === lo ? 0 : (bodyFatPct - lo) / (hi - lo);
      return { kind: "age", age: Math.round(AGES[i - 1]! + share * (AGES[i]! - AGES[i - 1]!)) };
    }
  }
  return { kind: "over", age: AGES[peak]! };
}

/**
 * The median body fat at a given age (interpolated between the 5-year steps), to say what is
 * typical at the person's own age when their fat is above every age's median.
 */
export function typicalFatAt(age: number, sex: Sex, group: AgeGroup): number {
  const medians = MEDIAN_FAT[group][sex];
  const a = Math.min(Math.max(age, AGES[0]), AGES[AGES.length - 1]!);
  for (let i = 1; i < AGES.length; i++) {
    if (a <= AGES[i]!) {
      const share = (a - AGES[i - 1]!) / (AGES[i]! - AGES[i - 1]!);
      return medians[i - 1]! + share * (medians[i]! - medians[i - 1]!);
    }
  }
  return medians[medians.length - 1]!;
}

/** The highest median body fat of any age: above it there is no age the body fat is typical of. */
export function peakTypicalFat(sex: Sex, group: AgeGroup): number {
  return Math.max(...MEDIAN_FAT[group][sex]);
}

/** The metabolic age is shown between these ages; outside them it reads "under 18" or "80 or older". */
export const METABOLIC_AGE_MIN = 18;
export const METABOLIC_AGE_MAX = 80;

/**
 * Metabolic age: the age whose typical resting burn matches yours, built only from published
 * pieces (Xiaomi's "body age" works this way too, but its formula is not published):
 *
 * - Your resting burn depends on your fat-free mass: Katch-McArdle, 370 + 21.6 x FFM. So each kg of
 *   fat in place of lean mass burns 21.6 kcal a day less.
 * - The typical person of your sex, age and weight has the NHANES median body fat for that age
 *   (Kelly 2009, above). The kcal you burn more or less than them, at the same weight, is
 *   (21.6 x weight x (their fat % - your fat %) / 100).
 * - Mifflin-St Jeor says resting burn falls 5 kcal a day per year of age; that turns the kcal into
 *   years: metabolic age = age + 21.6 x weight x (your fat % - typical fat %) / 100 / 5.
 *
 * A typical person gets exactly their age; more fat than typical, an older age; less, a younger
 * one. It is sensitive: about 4 years per kg of fat above or below typical, so very lean or very
 * fat bodies are shown as "under 18" or "80 or older".
 */
export function metabolicAge(input: { fatPct: number; weightKg: number; age: number; sex: Sex; group?: AgeGroup }): BodyFatAge {
  const typical = typicalFatAt(input.age, input.sex, input.group ?? "mexican-american");
  const years = input.age + ((21.6 / 5) * input.weightKg * (input.fatPct - typical)) / 100;
  if (years < METABOLIC_AGE_MIN) return { kind: "under", age: METABOLIC_AGE_MIN };
  if (years > METABOLIC_AGE_MAX) return { kind: "over", age: METABOLIC_AGE_MAX };
  return { kind: "age", age: Math.round(years) };
}
