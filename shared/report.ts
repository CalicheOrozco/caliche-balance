import { bodyFatOf, type Composition, compositionOf, MUSCLE_INDEX_STUDIED_FROM_AGE, muscleIndexBands, type ProfileFacts } from "./composition.ts";
import { ageAt, type Band, bmi, bodyFatBands, healthyWeightRange, type Status, WHO_BMI_BANDS } from "./reference.ts";
import type { MeasurementDto } from "./schemas.ts";
import { type BodyScore, scoreOf } from "./score.ts";
import { WHTR_BANDS } from "./waist.ts";

/**
 * Everything the detail page of one weigh-in shows: each measure with a published North American
 * range, grouped by status, how far it is from the healthy range, and recent changes.
 */

export type ReportItemKey = "bodyFat" | "bmi" | "muscleIndex" | "waist";

export interface ReportItem {
  key: ReportItemKey;
  value: number;
  band: Band;
  bands: Band[];
  /**
   * Distance to the nearest edge of the healthy range, always positive: kg of body weight (BMI),
   * kg of fat (body fat) or cm of waist. Null when the value is already healthy.
   */
  toHealthy: number | null;
}

export interface WaistUsed {
  cm: number;
  measuredAt: string;
}

export interface ReadingReport {
  age: number;
  score: BodyScore;
  composition: Composition | null;
  bodyFat: { value: number; source: "north-america" | "xiaomi" } | null;
  items: ReportItem[];
  /** Items by status, worst first; empty groups included so the order never changes. */
  groups: { status: Status; items: ReportItem[] }[];
  waist: WaistUsed | null;
  /** Healthy body fat range for this sex and age (Gallagher 2000). */
  fatRange: { min: number; max: number; obese: number };
  /** True when the muscle index bands come from a study of older adults than this person. */
  muscleBandsAsGuide: boolean;
}

/** A waist taken up to this long before a weigh-in still describes it. */
export const WAIST_VALID_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

function pickBand(value: number, bands: Band[]): Band {
  return bands.find((b) => (b.min === null || value >= b.min) && (b.max === null || value < b.max))!;
}

/** The reading's own waist, or the newest earlier one still recent enough. */
export function waistFor(reading: MeasurementDto, all: MeasurementDto[]): WaistUsed | null {
  if (reading.waistCm !== null) return { cm: reading.waistCm, measuredAt: reading.measuredAt };
  const at = new Date(reading.measuredAt).getTime();
  const earlier = all
    .filter((m) => m.waistCm !== null && new Date(m.measuredAt).getTime() <= at && at - new Date(m.measuredAt).getTime() <= WAIST_VALID_DAYS * DAY)
    .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime())[0];
  return earlier ? { cm: earlier.waistCm!, measuredAt: earlier.measuredAt } : null;
}

const STATUS_ORDER: Status[] = ["bad", "warn", "good"];

export function readingReport(profile: ProfileFacts, reading: MeasurementDto, all: MeasurementDto[]): ReadingReport {
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(reading.measuredAt));
  const composition = compositionOf(profile, reading);
  const bodyFat = bodyFatOf(profile, reading);
  const healthyWeight = healthyWeightRange(profile.heightCm);
  const fatBands = bodyFatBands(profile.sex, age);
  const healthy = fatBands.find((b) => b.key === "healthy")!;
  const fatRange = { min: healthy.min!, max: healthy.max!, obese: fatBands.find((b) => b.key === "obese")!.min! };
  const items: ReportItem[] = [];

  if (bodyFat) {
    const band = pickBand(bodyFat.value, fatBands);
    // Fat to lose or gain to reach the range edge while keeping the same fat-free mass.
    const fatFree = reading.weightKg * (1 - bodyFat.value / 100);
    const weightAt = (pct: number) => fatFree / (1 - pct / 100);
    const toHealthy =
      band.status === "good" ? null : bodyFat.value > fatRange.max ? reading.weightKg - weightAt(fatRange.max) : weightAt(fatRange.min) - reading.weightKg;
    items.push({ key: "bodyFat", value: bodyFat.value, band, bands: fatBands, toHealthy });
  }

  const bmiValue = bmi(reading.weightKg, profile.heightCm);
  const bmiBand = pickBand(bmiValue, WHO_BMI_BANDS);
  items.push({
    key: "bmi",
    value: bmiValue,
    band: bmiBand,
    bands: WHO_BMI_BANDS,
    toHealthy: bmiBand.status === "good" ? null : bmiValue >= 25 ? reading.weightKg - healthyWeight.max : healthyWeight.min - reading.weightKg,
  });

  if (composition) {
    const bands = muscleIndexBands(profile.sex);
    items.push({ key: "muscleIndex", value: composition.skeletalMuscleIndex, band: pickBand(composition.skeletalMuscleIndex, bands), bands, toHealthy: null });
  }

  const waist = waistFor(reading, all);
  if (waist) {
    const ratio = waist.cm / profile.heightCm;
    const band = pickBand(ratio, WHTR_BANDS);
    items.push({ key: "waist", value: ratio, band, bands: WHTR_BANDS, toHealthy: band.status === "good" ? null : waist.cm - 0.5 * profile.heightCm });
  }

  return {
    age,
    score: scoreOf(profile, reading),
    composition,
    bodyFat,
    items,
    groups: STATUS_ORDER.map((status) => ({ status, items: items.filter((i) => i.band.status === status) })),
    waist,
    fatRange,
    muscleBandsAsGuide: age < MUSCLE_INDEX_STUDIED_FROM_AGE,
  };
}

export type ChangeKey = "weight" | "fatMass" | "skeletalMuscle";

export interface Change {
  key: ChangeKey;
  /** Values up to and including this weigh-in, oldest first. */
  points: { time: number; value: number }[];
  /** Against the newest weigh-in at least 30 days earlier. */
  vsMonth: { delta: number; measuredAt: string } | null;
  /** Against the first weigh-in that has this measure. */
  vsFirst: { delta: number; measuredAt: string } | null;
}

export const CHANGE_WINDOW_DAYS = 30;

function valueOf(key: ChangeKey, profile: ProfileFacts, m: MeasurementDto): number | null {
  if (key === "weight") return m.weightKg;
  const c = compositionOf(profile, m);
  if (!c) return null;
  return key === "fatMass" ? c.fatMassKg : c.skeletalMuscleKg;
}

/** Weight, fat mass and skeletal muscle up to this weigh-in, with changes over a month and since the start. */
export function recentChanges(profile: ProfileFacts, reading: MeasurementDto, all: MeasurementDto[]): Change[] {
  const at = new Date(reading.measuredAt).getTime();
  const upTo = all
    .map((m) => ({ m, time: new Date(m.measuredAt).getTime() }))
    .filter((x) => x.time <= at)
    .sort((a, b) => a.time - b.time);
  return (["weight", "fatMass", "skeletalMuscle"] as const).flatMap((key) => {
    const points = upTo.flatMap(({ m, time }) => {
      const value = valueOf(key, profile, m);
      return value === null ? [] : [{ time, value, measuredAt: m.measuredAt }];
    });
    const current = points[points.length - 1];
    // A measure this weigh-in does not have has no change to show.
    if (!current || current.time !== at) return [];
    const month = [...points].reverse().find((p) => p.time <= at - CHANGE_WINDOW_DAYS * DAY);
    const first = points[0]!;
    return [
      {
        key,
        points: points.map(({ time, value }) => ({ time, value })),
        vsMonth: month ? { delta: current.value - month.value, measuredAt: month.measuredAt } : null,
        vsFirst: first.time === at ? null : { delta: current.value - first.value, measuredAt: first.measuredAt },
      },
    ];
  });
}
