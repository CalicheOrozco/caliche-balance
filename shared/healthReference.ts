import { basalMetabolicRate, bmi, bodyFatBands, healthyWeightRange, type Sex } from "./reference.ts";

/**
 * What is recommended for this person, for each Apple Health measure: the numbers the info
 * windows quote, worked out from sex, age, height and weight with published references.
 */

export interface PersonFacts {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
}

export interface HealthTargets {
  /** Steps a day where the benefit levels off: 8,000 to 10,000 under 60, 6,000 to 8,000 from 60 (Paluch et al., Lancet Public Health 2022). */
  steps: [number, number];
  /** Typical step length for your height (about 41.5 % of it). */
  stepLengthCm: number;
  /** The recommended steps as distance, with that step length. */
  distanceKm: [number, number];
  /** Weekly exercise minutes: 150 to 300 (US and Canadian guidelines); 250 or more to lose weight (ACSM 2009). */
  exerciseWeek: [number, number];
  exerciseForLoss: number | null;
  /** Resting energy expected for you (Mifflin-St Jeor). */
  bmrKcal: number;
  /** Activity that helps keep weight off: about 2,000 kcal a week (ACSM), as a daily figure. */
  activeDayKcal: number;
  bmi: number;
  healthyWeightKg: { min: number; max: number };
  /** Healthy body fat for your sex and age (Gallagher et al. 2000). */
  bodyFatPct: [number, number];
}

export function healthTargets(p: PersonFacts): HealthTargets {
  const steps: [number, number] = p.age >= 60 ? [6_000, 8_000] : [8_000, 10_000];
  const stepLengthCm = p.heightCm * (p.sex === "male" ? 0.415 : 0.413);
  const index = bmi(p.weightKg, p.heightCm);
  const healthy = bodyFatBands(p.sex, p.age).find((b) => b.key === "healthy")!;
  return {
    steps,
    stepLengthCm,
    distanceKm: [(steps[0] * stepLengthCm) / 100_000, (steps[1] * stepLengthCm) / 100_000],
    exerciseWeek: [150, 300],
    exerciseForLoss: index >= 25 ? 250 : null,
    bmrKcal: basalMetabolicRate(p.weightKg, p.heightCm, p.age, p.sex),
    activeDayKcal: Math.round(2_000 / 7),
    bmi: index,
    healthyWeightKg: healthyWeightRange(p.heightCm),
    bodyFatPct: [healthy.min!, healthy.max!],
  };
}
