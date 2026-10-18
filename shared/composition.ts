import { ageAt, type Sex } from "./reference.ts";

/**
 * Body composition recalculated from the scale's raw impedance with equations developed in
 * North American populations, instead of the values Zepp Life computes with its own formulas.
 *
 * - Fat-free mass and total body water: Sun SS, Chumlea WC, Heymsfield SB, et al. Development of
 *   bioelectrical impedance analysis prediction equations for body composition with the use of a
 *   multicomponent model for use in epidemiologic surveys. Am J Clin Nutr 2003;77:331-40.
 *   The NHANES III equations: 734 men and 1,095 women, 12 to 94 years, white and African American
 *   US adults; coefficients as tabulated in Kyle UG et al., ESPEN BIA part I, Clin Nutr 2004.
 * - Skeletal muscle mass: Janssen I, Heymsfield SB, Baumgartner RN, Ross R. Estimation of skeletal
 *   muscle mass by bioelectrical impedance analysis. J Appl Physiol 2000;89:465-71 (MRI reference,
 *   388 adults, 18 to 86 years, multiethnic).
 * - Skeletal muscle index cut points: Janssen I et al. Am J Epidemiol 2004;159:413-21 (NHANES III,
 *   4,449 adults aged 60 or more).
 * - Basal metabolic rate from fat-free mass: Katch-McArdle, 370 + 21.6 x FFM.
 *
 * Limitation: these equations were built with hand-to-foot resistance at 50 kHz. The Xiaomi scale
 * measures foot to foot, so results are estimates, not a validated measurement for this device.
 */

export interface CompositionInput {
  sex: Sex;
  heightCm: number;
  age: number;
  weightKg: number;
  /** Ohms, as reported by the scale. */
  impedance: number | null | undefined;
}

export interface Composition {
  fatFreeMassKg: number;
  fatMassKg: number;
  bodyFatPct: number;
  bodyWaterL: number;
  bodyWaterPct: number;
  skeletalMuscleKg: number;
  /** Skeletal muscle / height², kg/m². */
  skeletalMuscleIndex: number;
  /** Janssen 2004 class; only defined from age 60, the population it was derived from. */
  muscleClass: "normal" | "moderately-low" | "low" | null;
  bmrKcal: number;
}

/** Impedance outside this window is a failed or partial reading, not a body. */
const MIN_IMPEDANCE = 200;
const MAX_IMPEDANCE = 1000;
export const MIN_COMPOSITION_AGE = 18;

export function recalculate(input: CompositionInput): Composition | null {
  const { sex, heightCm, age, weightKg, impedance: r } = input;
  if (!r || r < MIN_IMPEDANCE || r > MAX_IMPEDANCE || age < MIN_COMPOSITION_AGE) return null;

  const index = (heightCm * heightCm) / r; // height² / resistance
  const male = sex === "male";

  const fatFreeMassKg = male
    ? -10.678 + 0.652 * index + 0.262 * weightKg + 0.015 * r
    : -9.529 + 0.696 * index + 0.168 * weightKg + 0.016 * r;
  const bodyWaterL = male ? 1.203 + 0.449 * index + 0.176 * weightKg : 3.747 + 0.45 * index + 0.113 * weightKg;
  const skeletalMuscleKg = 0.401 * index + (male ? 3.825 : 0) - 0.071 * age + 5.102;

  // A fat-free mass at or above body weight means the inputs do not describe this person.
  if (fatFreeMassKg <= 0 || fatFreeMassKg >= weightKg) return null;

  const meters = heightCm / 100;
  const skeletalMuscleIndex = skeletalMuscleKg / (meters * meters);
  const [low, moderate] = male ? [8.5, 10.75] : [5.75, 6.75];
  const muscleClass =
    age < 60 ? null : skeletalMuscleIndex <= low ? "low" : skeletalMuscleIndex <= moderate ? "moderately-low" : "normal";

  return {
    fatFreeMassKg,
    fatMassKg: weightKg - fatFreeMassKg,
    bodyFatPct: ((weightKg - fatFreeMassKg) / weightKg) * 100,
    bodyWaterL,
    bodyWaterPct: (bodyWaterL / weightKg) * 100,
    skeletalMuscleKg,
    skeletalMuscleIndex,
    muscleClass,
    bmrKcal: 370 + 21.6 * fatFreeMassKg,
  };
}

/**
 * The body fat the app uses everywhere (classification, goals, charts): the North American
 * recalculation when the reading has impedance, otherwise the value the scale or the person gave.
 */
export function effectiveBodyFat(
  input: Omit<CompositionInput, "impedance"> & { impedance?: number | null; bodyFatPct: number | null },
): { value: number; source: "north-america" | "xiaomi" } | null {
  const recalculated = recalculate({ ...input, impedance: input.impedance ?? null });
  if (recalculated) return { value: recalculated.bodyFatPct, source: "north-america" };
  return input.bodyFatPct === null ? null : { value: input.bodyFatPct, source: "xiaomi" };
}

/** The person facts every recalculation needs, as stored in the profile. */
export interface ProfileFacts {
  sex: Sex;
  heightCm: number;
  /** "yyyy-MM-dd" */
  birthDate: string;
}

export interface ReadingFacts {
  measuredAt: string | Date;
  weightKg: number;
  impedance?: number | null;
  bodyFatPct: number | null;
}

function inputFor(profile: ProfileFacts, reading: ReadingFacts) {
  return {
    sex: profile.sex,
    heightCm: profile.heightCm,
    age: ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(reading.measuredAt)),
    weightKg: reading.weightKg,
    impedance: reading.impedance ?? null,
  };
}

/** Recalculation for one stored reading, with the age the person had that day. */
export function compositionOf(profile: ProfileFacts, reading: ReadingFacts): Composition | null {
  return recalculate(inputFor(profile, reading));
}

export function bodyFatOf(profile: ProfileFacts, reading: ReadingFacts) {
  return effectiveBodyFat({ ...inputFor(profile, reading), bodyFatPct: reading.bodyFatPct });
}

/** Xiaomi's own numbers for the measures that mean the same thing as the recalculation. */
export interface XiaomiComparable {
  bodyFatPct: number | null;
  fatFreeMassKg: number | null;
  bodyWaterPct: number | null;
  bmrKcal: number | null;
}

export function xiaomiComparable(reading: {
  weightKg: number;
  bodyFatPct: number | null;
  waterPct?: number | null;
  bmrKcal?: number | null;
}): XiaomiComparable {
  return {
    bodyFatPct: reading.bodyFatPct,
    fatFreeMassKg: reading.bodyFatPct === null ? null : reading.weightKg * (1 - reading.bodyFatPct / 100),
    bodyWaterPct: reading.waterPct ?? null,
    bmrKcal: reading.bmrKcal ?? null,
  };
}
