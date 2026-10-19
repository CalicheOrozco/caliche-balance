/**
 * Body composition reference ranges used across the Americas.
 *
 * This module owns every interpretation of a measurement. The API stores raw values and the
 * UI only renders what these functions return, so a range is defined in exactly one place.
 */

export type Sex = "male" | "female";

/** good = within the healthy range, warn = one step outside it, bad = clearly outside it. */
export type Status = "good" | "warn" | "bad";

export type SourceId =
  | "who-bmi"
  | "who-asian-bmi"
  | "gallagher-2000"
  | "ace"
  | "mifflin-st-jeor"
  | "sun-2003"
  | "janssen"
  | "katch-mcardle";

export interface Band {
  key: string;
  /** Inclusive lower bound; null means no lower bound. */
  min: number | null;
  /** Exclusive upper bound; null means no upper bound. */
  max: number | null;
  status: Status;
}

export interface Classification {
  value: number;
  band: Band;
  bands: Band[];
  source: SourceId;
}

export const MIN_SUPPORTED_AGE = 18;

export function ageAt(birthDate: Date, at: Date): number {
  let age = at.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < birthDate.getUTCMonth() ||
    (at.getUTCMonth() === birthDate.getUTCMonth() && at.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function bmi(weightKg: number, heightCm: number): number {
  const meters = heightCm / 100;
  return weightKg / (meters * meters);
}

function pick(value: number, bands: Band[], source: SourceId): Classification {
  const band = bands.find((b) => (b.min === null || value >= b.min) && (b.max === null || value < b.max));
  // Bands cover the whole number line, so a match always exists.
  return { value, band: band!, bands, source };
}

/** WHO adult BMI categories, used by the health systems of Mexico, the United States and Canada. */
export const WHO_BMI_BANDS: Band[] = [
  { key: "underweight", min: null, max: 18.5, status: "warn" },
  { key: "normal", min: 18.5, max: 25, status: "good" },
  { key: "overweight", min: 25, max: 30, status: "warn" },
  { key: "obese", min: 30, max: null, status: "bad" },
];

/** WHO expert consultation cut-offs for Asian populations (Lancet 2004), shown only for comparison. */
export const WHO_ASIAN_BMI_BANDS: Band[] = [
  { key: "underweight", min: null, max: 18.5, status: "warn" },
  { key: "normal", min: 18.5, max: 23, status: "good" },
  { key: "overweight", min: 23, max: 27.5, status: "warn" },
  { key: "obese", min: 27.5, max: null, status: "bad" },
];

export function classifyBmi(value: number): Classification {
  return pick(value, WHO_BMI_BANDS, "who-bmi");
}

export function classifyBmiAsian(value: number): Classification {
  return pick(value, WHO_ASIAN_BMI_BANDS, "who-asian-bmi");
}

/**
 * Healthy body fat ranges by sex and age from Gallagher et al. (2000), Am J Clin Nutr 72:694-701,
 * derived from BMI cut-offs in white and African American adults. Asian participants in the
 * same study needed different ranges, which is the gap this app fills.
 * Thresholds: [underfat/healthy, healthy/overfat, overfat/obese].
 */
const GALLAGHER: Record<Sex, { maxAge: number; thresholds: [number, number, number] }[]> = {
  female: [
    { maxAge: 40, thresholds: [21, 33, 39] },
    { maxAge: 60, thresholds: [23, 34, 40] },
    { maxAge: Infinity, thresholds: [24, 36, 42] },
  ],
  male: [
    { maxAge: 40, thresholds: [8, 20, 25] },
    { maxAge: 60, thresholds: [11, 22, 28] },
    { maxAge: Infinity, thresholds: [13, 25, 30] },
  ],
};

export function bodyFatBands(sex: Sex, age: number): Band[] {
  const row = GALLAGHER[sex].find((r) => age < r.maxAge)!;
  const [low, high, obese] = row.thresholds;
  return [
    { key: "underfat", min: null, max: low, status: "warn" },
    { key: "healthy", min: low, max: high, status: "good" },
    { key: "overfat", min: high, max: obese, status: "warn" },
    { key: "obese", min: obese, max: null, status: "bad" },
  ];
}

export function classifyBodyFat(value: number, sex: Sex, age: number): Classification {
  return pick(value, bodyFatBands(sex, age), "gallagher-2000");
}

/** American Council on Exercise body fat categories (fitness context, not age adjusted). */
const ACE: Record<Sex, [number, number, number, number]> = {
  // Upper bounds of essential, athletes, fitness and average.
  female: [14, 21, 25, 32],
  male: [6, 14, 18, 25],
};

export function aceBodyFatCategory(value: number, sex: Sex): Classification {
  const [essential, athletes, fitness, average] = ACE[sex];
  return pick(
    value,
    [
      { key: "essential", min: null, max: essential, status: "warn" },
      { key: "athletes", min: essential, max: athletes, status: "good" },
      { key: "fitness", min: athletes, max: fitness, status: "good" },
      { key: "average", min: fitness, max: average, status: "warn" },
      { key: "obese", min: average, max: null, status: "bad" },
    ],
    "ace",
  );
}

/** Resting energy expenditure in kcal/day (Mifflin-St Jeor, 1990). */
export function basalMetabolicRate(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161);
}

/**
 * Weight range that keeps BMI within the WHO normal band for this height: 18.5 to 24.9, the
 * values people are told to reach (the band itself ends just below 25).
 */
export function healthyWeightRange(heightCm: number): { min: number; max: number } {
  const meters = heightCm / 100;
  return { min: 18.5 * meters * meters, max: 24.9 * meters * meters };
}

export interface Profile {
  sex: Sex;
  birthDate: Date;
  heightCm: number;
}

export interface MeasurementValues {
  measuredAt: Date;
  weightKg: number;
  bodyFatPct?: number | null;
}

export interface Assessment {
  age: number;
  bmi: Classification;
  bmiAsian: Classification;
  bodyFat: Classification | null;
  bodyFatAce: Classification | null;
  bmrKcal: number;
  healthyWeight: { min: number; max: number };
  /** Notes the UI must show, e.g. when the age is outside the studied range. */
  notes: ("under-supported-age" | "age-above-studied-range")[];
}

export function assess(profile: Profile, measurement: MeasurementValues): Assessment {
  const age = ageAt(profile.birthDate, measurement.measuredAt);
  const notes: Assessment["notes"] = [];
  if (age < MIN_SUPPORTED_AGE) notes.push("under-supported-age");
  if (age >= 80) notes.push("age-above-studied-range");

  const bmiValue = bmi(measurement.weightKg, profile.heightCm);
  const bodyFat = measurement.bodyFatPct ?? null;
  return {
    age,
    bmi: classifyBmi(bmiValue),
    bmiAsian: classifyBmiAsian(bmiValue),
    bodyFat: bodyFat === null ? null : classifyBodyFat(bodyFat, profile.sex, age),
    bodyFatAce: bodyFat === null ? null : aceBodyFatCategory(bodyFat, profile.sex),
    bmrKcal: basalMetabolicRate(measurement.weightKg, profile.heightCm, age, profile.sex),
    healthyWeight: healthyWeightRange(profile.heightCm),
    notes,
  };
}
