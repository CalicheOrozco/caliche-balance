import type { Band, Sex } from "./reference.ts";

/**
 * Visceral (abdominal) fat risk from waist circumference. A foot-to-foot scale cannot see abdominal
 * fat; North American guidelines use the waist instead.
 *
 * - Waist-to-height ratio: 0.5 and 0.6 boundaries (Ashwell M, Gibson S. "Keep your waist to less
 *   than half your height"; BMJ Open 2016;6:e010159). Works for any height, sex and origin.
 * - US and Canada: waist above 102 cm in men and 88 cm in women (NHLBI 1998 clinical guidelines;
 *   Health Canada, Canadian Guidelines for Body Weight Classification in Adults, 2003).
 * - Mexico: 90 cm in men and 80 cm in women (NOM-008-SSA3-2017, overweight and obesity).
 */

export const WHTR_BANDS: Band[] = [
  { key: "whtr-low", min: null, max: 0.5, status: "good" },
  { key: "whtr-increased", min: 0.5, max: 0.6, status: "warn" },
  { key: "whtr-high", min: 0.6, max: null, status: "bad" },
];

export const WAIST_CUTOFFS_CM: Record<"usCanada" | "mexico", Record<Sex, number>> = {
  usCanada: { male: 102, female: 88 },
  mexico: { male: 90, female: 80 },
};

export interface WaistAssessment {
  waistCm: number;
  ratio: number;
  band: Band;
  usCanada: { cutoffCm: number; above: boolean };
  mexico: { cutoffCm: number; above: boolean };
}

export function assessWaist(waistCm: number, heightCm: number, sex: Sex): WaistAssessment {
  const ratio = waistCm / heightCm;
  const band = WHTR_BANDS.find((b) => (b.min === null || ratio >= b.min) && (b.max === null || ratio < b.max))!;
  const us = WAIST_CUTOFFS_CM.usCanada[sex];
  const mx = WAIST_CUTOFFS_CM.mexico[sex];
  return {
    waistCm,
    ratio,
    band,
    // The guidelines say "above" (greater than) the value.
    usCanada: { cutoffCm: us, above: waistCm > us },
    mexico: { cutoffCm: mx, above: waistCm >= mx },
  };
}
