import { z } from "zod";

/*
 * What the person eats, to compare the calories eaten with the calories spent (Apple Health's
 * active plus resting energy). An entry is one food or dish with its calories and, when known, its
 * protein, carbohydrates, fat and fiber. It can be typed by hand in the app or estimated by Claude
 * through the connector, from a description or a photo; both are estimates, not lab values.
 */

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];

const grams = z.number().finite().min(0).max(1_000).nullable().optional();

export const foodEntryInputSchema = z.object({
  /** The person's local day, YYYY-MM-DD. */
  date: z.iso.date(),
  /** Local time eaten, HH:MM; optional. */
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  meal: z.enum(MEALS),
  name: z.string().trim().min(1).max(120),
  /** How much, in the person's words: "2 tacos", "1 taza", "250 g". */
  amount: z.string().trim().max(60).nullable().optional(),
  kcal: z.number().finite().min(0).max(10_000),
  proteinG: grams,
  carbsG: grams,
  fatG: grams,
  fiberG: grams,
  note: z.string().trim().max(280).nullable().optional(),
});

export type FoodEntryInput = z.input<typeof foodEntryInputSchema>;
export type FoodEntryParsed = z.output<typeof foodEntryInputSchema>;

/** Who wrote the entry: the person in the app, or Claude through the connector. */
export type FoodSource = "manual" | "claude";

export interface FoodEntryDto {
  id: string;
  date: string;
  time: string | null;
  meal: Meal;
  name: string;
  amount: string | null;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  note: string | null;
  source: FoodSource;
}

export interface FoodTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  entries: number;
}

/** Adds up a set of entries; a nutrient an entry does not have counts as 0. */
export function foodTotals(entries: Pick<FoodEntryDto, "kcal" | "proteinG" | "carbsG" | "fatG" | "fiberG">[]): FoodTotals {
  const sum = (pick: (e: (typeof entries)[number]) => number | null) => Math.round(entries.reduce((s, e) => s + (pick(e) ?? 0), 0) * 10) / 10;
  return {
    kcal: Math.round(entries.reduce((s, e) => s + e.kcal, 0)),
    proteinG: sum((e) => e.proteinG),
    carbsG: sum((e) => e.carbsG),
    fatG: sum((e) => e.fatG),
    fiberG: sum((e) => e.fiberG),
    entries: entries.length,
  };
}

/** The meal a time of day most likely is, to preselect it. */
export function mealAt(hour: number): Meal {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 13 && hour < 17) return "lunch";
  if (hour >= 19 && hour < 23) return "dinner";
  return "snack";
}

/**
 * Calories from the macronutrients (4 kcal per gram of protein and carbohydrate, 9 per gram of
 * fat), to fill in the calories when only the macros are known. Null without any of them.
 */
export function kcalFromMacros(proteinG: number | null | undefined, carbsG: number | null | undefined, fatG: number | null | undefined): number | null {
  if (proteinG == null && carbsG == null && fatG == null) return null;
  return Math.round((proteinG ?? 0) * 4 + (carbsG ?? 0) * 4 + (fatG ?? 0) * 9);
}
