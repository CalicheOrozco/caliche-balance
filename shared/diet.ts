import { z } from "zod";
import { MEALS, type Meal } from "./food.ts";

/*
 * The diet: plans with options for each meal of the day (from Claude or a nutritionist), the
 * recipes those options point to, the person's choice for each week, and the shopping list that
 * choice adds up to. A plan has its own meals of the day ("Desayuno", "Colación 1"...), each with a
 * few recipe options; for the week the person picks one option per meal. Recipes live on their
 * own, so a favorite can go into a later plan.
 */

const text = (max: number) => z.string().trim().max(max);
const grams = z.number().finite().min(0).max(1_000).nullable().optional();

export const ingredientSchema = z.object({
  /** Null for "al gusto". */
  qty: z.number().finite().min(0).max(100_000).nullable().optional(),
  unit: text(20).nullable().optional(),
  item: text(80).min(1),
});

export const recipeInputSchema = z.object({
  title: text(120).min(1),
  emoji: text(16).nullable().optional(),
  /** A picture on the internet; shown small, the emoji when it is missing or fails. */
  imageUrl: z
    .string()
    .trim()
    .max(1_000)
    .regex(/^https:\/\//, "https-only")
    .nullable()
    .optional(),
  servings: z.number().finite().min(0.5).max(100),
  /** Per serving. */
  kcal: z.number().finite().min(0).max(10_000),
  proteinG: grams,
  carbsG: grams,
  fatG: grams,
  fiberG: grams,
  prepMin: z.number().int().min(0).max(1_440).nullable().optional(),
  cookMin: z.number().int().min(0).max(1_440).nullable().optional(),
  tags: z.array(text(40).min(1)).max(12).optional(),
  ingredients: z.array(ingredientSchema).max(60).optional(),
  steps: z.array(text(1_000).min(1)).max(40).optional(),
  note: text(1_000).nullable().optional(),
  favorite: z.boolean().optional(),
});

export type Ingredient = z.output<typeof ingredientSchema>;
export type RecipeInput = z.input<typeof recipeInputSchema>;

export interface RecipeDto {
  id: string;
  title: string;
  emoji: string | null;
  imageUrl: string | null;
  servings: number;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  prepMin: number | null;
  cookMin: number | null;
  tags: string[];
  ingredients: { qty: number | null; unit: string | null; item: string }[];
  steps: string[];
  note: string | null;
  favorite: boolean;
  updatedAt: string;
}

export const PLAN_AUTHORS = ["claude", "nutritionist", "me"] as const;
export type PlanAuthor = (typeof PLAN_AUTHORS)[number];

export const planSlotSchema = z.object({
  /** Kept when the plan is edited, so the week's choices stay attached. */
  id: z.string().regex(/^[a-z0-9]{6,24}$/).optional(),
  name: text(40).min(1),
  /** Which kind of meal it is when logged as eaten. */
  meal: z.enum(MEALS).optional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  /** Recipe ids, in order. */
  options: z.array(z.string().regex(/^[0-9a-f]{24}$/)).max(8),
});

export const planInputSchema = z.object({
  name: text(80).min(1),
  /** YYYY-MM, the month it is for; optional. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable()
    .optional(),
  author: z.enum(PLAN_AUTHORS),
  /** The nutritionist's name, or anything about where it came from. */
  source: text(80).nullable().optional(),
  kcalTarget: z.number().finite().min(500).max(10_000).nullable().optional(),
  note: text(1_000).nullable().optional(),
  slots: z.array(planSlotSchema).min(1).max(10),
});

export type PlanInput = z.input<typeof planInputSchema>;
export type PlanSlot = { id: string; name: string; meal: Meal; time: string | null; options: string[] };

export interface PlanDto {
  id: string;
  name: string;
  month: string | null;
  author: PlanAuthor;
  source: string | null;
  kcalTarget: number | null;
  note: string | null;
  active: boolean;
  slots: PlanSlot[];
  createdAt: string;
}

/** Likes and limits Claude reads before suggesting recipes; every field is free text. */
export const dietPrefsSchema = z.object({
  likes: text(1_000).optional(),
  dislikes: text(1_000).optional(),
  allergies: text(500).optional(),
  cookingTime: text(200).optional(),
  budget: text(200).optional(),
  notes: text(1_000).optional(),
});
export type DietPrefs = z.output<typeof dietPrefsSchema>;

/** The week's choice: one recipe per meal of the active plan, and the shopping list's state. */
export interface DietWeekDto {
  /** The Monday it starts, YYYY-MM-DD. */
  week: string;
  planId: string | null;
  /** Slot id to recipe id. */
  choices: Record<string, string>;
  /** True when nothing was chosen for this week yet and these come from an earlier one. */
  carried: boolean;
  shopping: { days: number; servings: number; checked: string[] };
}

export const weekChoicesSchema = z.object({
  planId: z.string().regex(/^[0-9a-f]{24}$/),
  choices: z.record(z.string().regex(/^[a-z0-9]{6,24}$/), z.string().regex(/^[0-9a-f]{24}$/)),
});

export const shoppingStateSchema = z.object({
  days: z.number().int().min(1).max(14),
  servings: z.number().finite().min(0.5).max(10),
  checked: z.array(z.string().max(120)).max(300),
});

export interface DietDto {
  prefs: DietPrefs;
  plans: PlanDto[];
  recipes: RecipeDto[];
  week: DietWeekDto;
}

/** Monday of the week a YYYY-MM-DD day falls in. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** A short random id for a meal of the day. */
export function slotId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/** The kind of meal a name most likely is, to log it as eaten. */
export function mealOfSlot(name: string, time?: string | null): Meal {
  const n = name.toLowerCase();
  if (/desayun|breakfast/.test(n)) return "breakfast";
  if (/cena|dinner|supper/.test(n)) return "dinner";
  if (/colaci|snack|merienda|refrigerio|tentempi/.test(n)) return "snack";
  if (/comida|almuerzo|lunch/.test(n)) return "lunch";
  const hour = time ? Number(time.slice(0, 2)) : null;
  if (hour === null) return "snack";
  return hour < 11 ? "breakfast" : hour < 13 ? "snack" : hour < 17 ? "lunch" : hour < 19 ? "snack" : "dinner";
}

// ---- Shopping list ---------------------------------------------------------------------------

/** Units written different ways, as one; weights and volumes in grams and milliliters. */
const UNITS: Record<string, { unit: string; factor: number }> = {
  g: { unit: "g", factor: 1 },
  gr: { unit: "g", factor: 1 },
  grs: { unit: "g", factor: 1 },
  gramo: { unit: "g", factor: 1 },
  gramos: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1_000 },
  kilo: { unit: "g", factor: 1_000 },
  kilos: { unit: "g", factor: 1_000 },
  ml: { unit: "ml", factor: 1 },
  l: { unit: "ml", factor: 1_000 },
  lt: { unit: "ml", factor: 1_000 },
  litro: { unit: "ml", factor: 1_000 },
  litros: { unit: "ml", factor: 1_000 },
  pz: { unit: "pz", factor: 1 },
  pza: { unit: "pz", factor: 1 },
  pzas: { unit: "pz", factor: 1 },
  pieza: { unit: "pz", factor: 1 },
  piezas: { unit: "pz", factor: 1 },
  taza: { unit: "taza", factor: 1 },
  tazas: { unit: "taza", factor: 1 },
  cda: { unit: "cda", factor: 1 },
  cdas: { unit: "cda", factor: 1 },
  cucharada: { unit: "cda", factor: 1 },
  cucharadas: { unit: "cda", factor: 1 },
  cdita: { unit: "cdita", factor: 1 },
  cditas: { unit: "cdita", factor: 1 },
  cucharadita: { unit: "cdita", factor: 1 },
  cucharaditas: { unit: "cdita", factor: 1 },
};

function normalUnit(unit: string | null): { unit: string | null; factor: number } {
  if (!unit) return { unit: null, factor: 1 };
  const key = unit.trim().toLowerCase().replace(/\.$/, "");
  return UNITS[key] ?? { unit: key, factor: 1 };
}

/** The same ingredient written slightly differently ("Pechuga de pollo " and "pechuga de pollo"). */
export const itemKey = (item: string, unit: string | null) =>
  `${item
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}|${unit ?? ""}`;

export interface ShoppingItem {
  key: string;
  item: string;
  /** Null when no recipe gives an amount ("al gusto"). */
  qty: number | null;
  unit: string | null;
  /** Recipes that use it. */
  recipes: string[];
}

/**
 * Everything the chosen recipes need for `days` days at `servings` servings a day, each recipe
 * scaled from the servings it makes. The same ingredient in the same kind of unit adds up; grams
 * and milliliters turn into kilos and liters at the end.
 */
export function shoppingList(recipes: Pick<RecipeDto, "title" | "servings" | "ingredients">[], days: number, servings: number): ShoppingItem[] {
  const items = new Map<string, ShoppingItem>();
  for (const r of recipes) {
    const scale = (days * servings) / (r.servings || 1);
    for (const ing of r.ingredients) {
      const { unit, factor } = normalUnit(ing.unit);
      const key = itemKey(ing.item, unit);
      const entry = items.get(key) ?? { key, item: ing.item.trim(), qty: null, unit, recipes: [] };
      if (ing.qty != null) entry.qty = (entry.qty ?? 0) + ing.qty * factor * scale;
      if (!entry.recipes.includes(r.title)) entry.recipes.push(r.title);
      items.set(key, entry);
    }
  }
  return [...items.values()]
    .map((x) => {
      if (x.qty === null) return x;
      if (x.unit === "g" && x.qty >= 1_000) return { ...x, qty: round(x.qty / 1_000, 2), unit: "kg" };
      if (x.unit === "ml" && x.qty >= 1_000) return { ...x, qty: round(x.qty / 1_000, 2), unit: "l" };
      return { ...x, qty: round(x.qty, x.qty < 10 ? 1 : 0) };
    })
    .sort((a, b) => a.item.localeCompare(b.item));
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
