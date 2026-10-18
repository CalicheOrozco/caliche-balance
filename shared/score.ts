import { bodyFatOf, type Composition, compositionOf, MUSCLE_INDEX_CUTOFFS, type ProfileFacts, type ReadingFacts } from "./composition.ts";
import { ageAt, bmi, bodyFatBands, type Sex } from "./reference.ts";

/**
 * Caliche Balance's own 0 to 100 body score. Unlike Xiaomi's, every part is visible: three
 * measures, each scored against a published North American reference, then weighted.
 *
 * - Body fat (50 %): healthy range from Gallagher et al. 2000 (sex and age).
 * - BMI (30 %): WHO categories.
 * - Skeletal muscle index (20 %): Janssen et al. 2004 cut points (NHANES III).
 *
 * The references are published; the weights and the slopes between them are this app's choice,
 * not a clinical standard. A missing part (no impedance) is left out and the rest re-weighted.
 */

export type ScorePart = "bodyFat" | "bmi" | "muscle";

export interface PartScore {
  part: ScorePart;
  value: number;
  score: number;
  weight: number;
}

export interface BodyScore {
  score: number;
  parts: PartScore[];
}

const WEIGHTS: Record<ScorePart, number> = { bodyFat: 0.5, bmi: 0.3, muscle: 0.2 };

/** Straight line from (x0, y0) to (x1, y1), clamped to 0..100. */
function ramp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  const y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  return Math.min(Math.max(y, 0), 100);
}

/** 100 inside the healthy range; 50 at the obesity threshold; 0 ten points past it. Low fat mirrors it. */
export function bodyFatPart(pct: number, sex: Sex, age: number): number {
  const bands = bodyFatBands(sex, age);
  const low = bands.find((b) => b.key === "healthy")!.min!;
  const high = bands.find((b) => b.key === "healthy")!.max!;
  const obese = bands.find((b) => b.key === "obese")!.min!;
  if (pct < low) return ramp(pct, low, 100, Math.max(low - 6, 0), 0);
  if (pct <= high) return 100;
  if (pct <= obese) return ramp(pct, high, 100, obese, 50);
  return ramp(pct, obese, 50, obese + 10, 0);
}

/** 100 for 18.5 to 24.9; 50 at 30; 0 at 40. Underweight: 50 at 16, 0 at 15. */
export function bmiPart(bmi: number): number {
  if (bmi < 16) return ramp(bmi, 16, 50, 15, 0);
  if (bmi < 18.5) return ramp(bmi, 18.5, 100, 16, 50);
  if (bmi < 25) return 100;
  if (bmi < 30) return ramp(bmi, 25, 100, 30, 50);
  return ramp(bmi, 30, 50, 40, 0);
}

/** 100 above Janssen's moderate-risk cut point; 50 at the high-risk one; 0 two units below it. */
export function musclePart(index: number, sex: Sex): number {
  const { low, moderate } = MUSCLE_INDEX_CUTOFFS[sex];
  if (index > moderate) return 100;
  if (index > low) return ramp(index, moderate, 100, low, 50);
  return ramp(index, low, 50, low - 2, 0);
}

export function bodyScore(input: {
  sex: Sex;
  age: number;
  bmi: number;
  bodyFatPct: number | null;
  composition: Composition | null;
}): BodyScore {
  const parts: PartScore[] = [];
  if (input.bodyFatPct !== null) {
    parts.push({ part: "bodyFat", value: input.bodyFatPct, score: bodyFatPart(input.bodyFatPct, input.sex, input.age), weight: WEIGHTS.bodyFat });
  }
  parts.push({ part: "bmi", value: input.bmi, score: bmiPart(input.bmi), weight: WEIGHTS.bmi });
  if (input.composition) {
    const index = input.composition.skeletalMuscleIndex;
    parts.push({ part: "muscle", value: index, score: musclePart(index, input.sex), weight: WEIGHTS.muscle });
  }
  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.map((p) => ({ ...p, weight: p.weight / total }));
  return { score: Math.round(weighted.reduce((sum, p) => sum + p.score * p.weight, 0)), parts: weighted };
}

/** The score for one stored reading, with the age the person had that day. */
export function scoreOf(profile: ProfileFacts, reading: ReadingFacts): BodyScore {
  return bodyScore({
    sex: profile.sex,
    age: ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(reading.measuredAt)),
    bmi: bmi(reading.weightKg, profile.heightCm),
    bodyFatPct: bodyFatOf(profile, reading)?.value ?? null,
    composition: compositionOf(profile, reading),
  });
}
