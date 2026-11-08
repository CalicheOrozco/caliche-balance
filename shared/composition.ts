import { ageAt, basalMetabolicRate, type Band, type Sex } from "./reference.ts";

/**
 * Body composition recalculated from the scale's raw impedance with published equations, instead
 * of the values Zepp Life computes with its own formulas, and judged with North American ranges.
 *
 * - Fat-free mass (and so body fat): Bousbiat S, Jaffrin MY, Dongmo E. Comparison of body fat-free
 *   masses calculated from hand-to-foot and foot-to-foot resistances with DXA measurements. Med
 *   Biol Eng Comput 2011;49:1329-36; equations as given in Jaffrin MY, Bousbiat S. J Healthc Eng
 *   2014;5(2):123-44, eq. 12 (women) and 13 (men), "L2". Built for FOOT-TO-FOOT resistance (R34),
 *   the way this scale measures, against DXA in 127 men and 129 women aged 20 to 74 (France), and
 *   validated in a separate group (mean difference with DXA 0.06 kg in men, 0.05 kg in women).
 *   Height in cm: with the male cohort's means (177 cm, 467 ohm, 81.47 kg, 45.7 years) it gives
 *   61.05 kg against 61.02 kg by DXA. Sun 2003 (below) was used before, but it was built with
 *   hand-to-foot resistance and overestimated fat with this scale.
 * - Total body water: Sun SS, Chumlea WC, Heymsfield SB, et al. Development of
 *   bioelectrical impedance analysis prediction equations for body composition with the use of a
 *   multicomponent model for use in epidemiologic surveys. Am J Clin Nutr 2003;77:331-40.
 *   The NHANES III equations: 734 men and 1,095 women, 12 to 94 years, white and African American
 *   US adults; coefficients as tabulated in Kyle UG et al., ESPEN BIA part I, Clin Nutr 2004.
 * - Skeletal muscle mass: Janssen I, Heymsfield SB, Baumgartner RN, Ross R. Estimation of skeletal
 *   muscle mass by bioelectrical impedance analysis. J Appl Physiol 2000;89:465-71 (MRI reference,
 *   388 adults, 18 to 86 years, multiethnic).
 * - Skeletal muscle index cut points: Janssen I et al. Am J Epidemiol 2004;159:413-21 (NHANES III,
 *   4,449 adults aged 60 or more).
 * - Basal metabolic rate: Mifflin-St Jeor (weight, height, age, sex), the equation the Academy of
 *   Nutrition and Dietetics recommends. It does not use the impedance, so a foot-to-foot reading
 *   that skews fat-free mass cannot skew it too (Katch-McArdle from that fat-free mass did).
 * - Protein and lean soft mass (experimental): fat-free mass is water, protein and minerals; minerals
 *   taken as 6.5 % of it, after ICRP Reference Man as cited by Heymsfield SB et al., J Endocr Soc
 *   2024;8:bvae164. Protein is what remains after water and minerals, so errors add up.
 *
 * Limitation: water and skeletal muscle still come from hand-to-foot equations, and no equation was
 * validated with this exact scale or in Mexican adults; results are estimates for following a trend.
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
  /** Experimental: fat-free mass minus water and minerals; null when the estimate is not plausible. */
  proteinKg: number | null;
  proteinPct: number | null;
  /** Fat-free mass without minerals: the closest equivalent to what Xiaomi calls "muscle". */
  leanSoftKg: number;
}

/** Share of fat-free mass that is mineral (bone and soft tissue), ICRP Reference Man. */
export const MINERAL_FRACTION_OF_FFM = 0.065;

/** Impedance outside this window is a failed or partial reading, not a body. */
const MIN_IMPEDANCE = 200;
const MAX_IMPEDANCE = 1000;
export const MIN_COMPOSITION_AGE = 18;

/** Janssen 2004 skeletal muscle index cut points (kg/m²): high risk at or below low, moderate risk up to moderate. */
export const MUSCLE_INDEX_CUTOFFS: Record<Sex, { low: number; moderate: number }> = {
  male: { low: 8.5, moderate: 10.75 },
  female: { low: 5.75, moderate: 6.75 },
};

/** Studied in adults aged 60 or more; younger people can use the bands only as a guide. */
export const MUSCLE_INDEX_STUDIED_FROM_AGE = 60;

export function muscleIndexBands(sex: Sex): Band[] {
  const { low, moderate } = MUSCLE_INDEX_CUTOFFS[sex];
  return [
    { key: "low", min: null, max: low, status: "bad" },
    { key: "moderately-low", min: low, max: moderate, status: "warn" },
    { key: "normal", min: moderate, max: null, status: "good" },
  ];
}

export function recalculate(input: CompositionInput): Composition | null {
  const { sex, heightCm, age, weightKg, impedance: r } = input;
  if (!r || r < MIN_IMPEDANCE || r > MAX_IMPEDANCE || age < MIN_COMPOSITION_AGE) return null;

  const index = (heightCm * heightCm) / r; // height² / resistance
  const male = sex === "male";

  const fatFreeMassKg = male
    ? 0.528 * index + 0.306 * weightKg - 0.0698 * age + 0.0353 * r - 12.6
    : 0.354 * index + 0.229 * weightKg - 0.043 * age + 0.0177 * r + 1.91;
  const bodyWaterL = male ? 1.203 + 0.449 * index + 0.176 * weightKg : 3.747 + 0.45 * index + 0.113 * weightKg;
  const skeletalMuscleKg = 0.401 * index + (male ? 3.825 : 0) - 0.071 * age + 5.102;

  // A fat-free mass at or above body weight means the inputs do not describe this person.
  if (fatFreeMassKg <= 0 || fatFreeMassKg >= weightKg) return null;

  const meters = heightCm / 100;
  const skeletalMuscleIndex = skeletalMuscleKg / (meters * meters);
  const muscleClass =
    age < MUSCLE_INDEX_STUDIED_FROM_AGE
      ? null
      : (muscleIndexBands(sex).find((b) => (b.min === null || skeletalMuscleIndex >= b.min) && (b.max === null || skeletalMuscleIndex < b.max))!
          .key as NonNullable<Composition["muscleClass"]>);

  const mineralKg = MINERAL_FRACTION_OF_FFM * fatFreeMassKg;
  const protein = fatFreeMassKg - bodyWaterL - mineralKg; // 1 L of body water is about 1 kg
  // Protein below ~5 % of weight means the water and fat-free estimates disagree too much to use.
  const proteinKg = protein / weightKg >= 0.05 ? protein : null;

  return {
    proteinKg,
    proteinPct: proteinKg === null ? null : (proteinKg / weightKg) * 100,
    leanSoftKg: fatFreeMassKg - mineralKg,
    fatFreeMassKg,
    fatMassKg: weightKg - fatFreeMassKg,
    bodyFatPct: ((weightKg - fatFreeMassKg) / weightKg) * 100,
    bodyWaterL,
    bodyWaterPct: (bodyWaterL / weightKg) * 100,
    skeletalMuscleKg,
    skeletalMuscleIndex,
    muscleClass,
    bmrKcal: basalMetabolicRate(weightKg, heightCm, age, sex),
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
  proteinPct: number | null;
  /** Xiaomi's "muscle": its fat-free mass minus bone, compared with our lean soft mass. */
  muscleKg: number | null;
}

export function xiaomiComparable(reading: {
  weightKg: number;
  bodyFatPct: number | null;
  waterPct?: number | null;
  bmrKcal?: number | null;
  proteinPct?: number | null;
  muscleKg?: number | null;
}): XiaomiComparable {
  return {
    proteinPct: reading.proteinPct ?? null,
    muscleKg: reading.muscleKg ?? null,
    bodyFatPct: reading.bodyFatPct,
    fatFreeMassKg: reading.bodyFatPct === null ? null : reading.weightKg * (1 - reading.bodyFatPct / 100),
    bodyWaterPct: reading.waterPct ?? null,
    bmrKcal: reading.bmrKcal ?? null,
  };
}
