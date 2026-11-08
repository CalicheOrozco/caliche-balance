import express, { type RequestHandler } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  type DietDto,
  type DietPrefs,
  dietPrefsSchema,
  type DietWeekDto,
  mealOfSlot,
  mondayOf,
  type PlanDto,
  type PlanInput,
  planInputSchema,
  type RecipeDto,
  type RecipeInput,
  recipeInputSchema,
  shoppingStateSchema,
  slotId,
  weekChoicesSchema,
} from "../shared/diet.ts";
import type { Collections, DietPlanDoc, DietWeekDoc, RecipeDoc, UserDoc } from "./db.ts";
import { asyncRoute } from "./http.ts";

/*
 * The diet, shared by the app's API (dietRoutes below) and the Claude connector (server/mcp): the
 * same checks and the same rules whoever saves it.
 */

/** A problem the person can fix, said in words; the API answers 400 and the connector shows it. */
export class DietProblem extends Error {}

export function toRecipeDto(d: RecipeDoc): RecipeDto {
  return {
    id: d._id.toHexString(),
    title: d.title,
    emoji: d.emoji,
    imageUrl: d.imageUrl,
    servings: d.servings,
    kcal: d.kcal,
    proteinG: d.proteinG,
    carbsG: d.carbsG,
    fatG: d.fatG,
    fiberG: d.fiberG,
    prepMin: d.prepMin,
    cookMin: d.cookMin,
    tags: d.tags,
    ingredients: d.ingredients,
    steps: d.steps,
    note: d.note,
    favorite: d.favorite,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toPlanDto(d: DietPlanDoc): PlanDto {
  return {
    id: d._id.toHexString(),
    name: d.name,
    month: d.month,
    author: d.author,
    source: d.source,
    kcalTarget: d.kcalTarget,
    note: d.note,
    active: d.active,
    slots: d.slots,
    createdAt: d.createdAt.toISOString(),
  };
}

const one = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

function recipeFields(raw: RecipeInput) {
  const r = recipeInputSchema.parse(raw);
  return {
    title: r.title,
    emoji: r.emoji || null,
    imageUrl: r.imageUrl || null,
    servings: r.servings,
    kcal: Math.round(r.kcal),
    proteinG: one(r.proteinG),
    carbsG: one(r.carbsG),
    fatG: one(r.fatG),
    fiberG: one(r.fiberG),
    prepMin: r.prepMin ?? null,
    cookMin: r.cookMin ?? null,
    tags: [...new Set(r.tags ?? [])],
    ingredients: (r.ingredients ?? []).map((i) => ({ qty: i.qty ?? null, unit: i.unit || null, item: i.item })),
    steps: r.steps ?? [],
    note: r.note || null,
  };
}

/** Saves a new recipe, or replaces one of the person's (null when it is not theirs). */
export async function saveRecipe(c: Collections, userId: ObjectId, raw: RecipeInput, id?: ObjectId): Promise<RecipeDoc | null> {
  const fields = recipeFields(raw);
  const now = new Date();
  if (id) {
    return c.recipes.findOneAndUpdate(
      { _id: id, userId },
      { $set: { ...fields, ...(raw.favorite === undefined ? {} : { favorite: raw.favorite }), updatedAt: now } },
      { returnDocument: "after" },
    );
  }
  const doc: RecipeDoc = { _id: new ObjectId(), userId, ...fields, favorite: raw.favorite ?? false, createdAt: now, updatedAt: now };
  await c.recipes.insertOne(doc);
  return doc;
}

export async function setFavorite(c: Collections, userId: ObjectId, id: ObjectId, favorite: boolean): Promise<RecipeDoc | null> {
  return c.recipes.findOneAndUpdate({ _id: id, userId }, { $set: { favorite } }, { returnDocument: "after" });
}

/** Deletes a recipe and takes it out of every plan and week that offered it. */
export async function deleteRecipe(c: Collections, userId: ObjectId, id: ObjectId): Promise<boolean> {
  const result = await c.recipes.deleteOne({ _id: id, userId });
  if (!result.deletedCount) return false;
  const hex = id.toHexString();
  await c.dietPlans.updateMany({ userId, "slots.options": hex }, { $pull: { "slots.$[].options": hex } });
  const weeks = await c.dietWeeks.find({ userId }).toArray();
  for (const w of weeks) {
    const kept = Object.fromEntries(Object.entries(w.choices).filter(([, r]) => r !== hex));
    if (Object.keys(kept).length !== Object.keys(w.choices).length) await c.dietWeeks.updateOne({ _id: w._id }, { $set: { choices: kept } });
  }
  return true;
}

/** Checks that every option is one of the person's recipes and gives each meal an id. */
async function planFields(c: Collections, userId: ObjectId, raw: PlanInput, previous?: DietPlanDoc) {
  const p = planInputSchema.parse(raw);
  const ids = [...new Set(p.slots.flatMap((s) => s.options))];
  const owned = await c.recipes.countDocuments({ userId, _id: { $in: ids.map((x) => new ObjectId(x)) } });
  if (owned !== ids.length) throw new DietProblem("unknown-recipe");
  const known = new Set(previous?.slots.map((s) => s.id) ?? []);
  return {
    name: p.name,
    month: p.month ?? null,
    author: p.author,
    source: p.source || null,
    kcalTarget: p.kcalTarget == null ? null : Math.round(p.kcalTarget),
    note: p.note || null,
    slots: p.slots.map((s) => ({
      id: s.id && known.has(s.id) ? s.id : slotId(),
      name: s.name,
      meal: s.meal ?? mealOfSlot(s.name, s.time),
      time: s.time ?? null,
      options: [...new Set(s.options)],
    })),
  };
}

/** Saves a new plan (active when asked or when it is the first one), or replaces one of the person's. */
export async function savePlan(c: Collections, userId: ObjectId, raw: PlanInput, options: { id?: ObjectId; activate?: boolean } = {}): Promise<DietPlanDoc | null> {
  if (options.id) {
    const previous = await c.dietPlans.findOne({ _id: options.id, userId });
    if (!previous) return null;
    const saved = await c.dietPlans.findOneAndUpdate({ _id: options.id, userId }, { $set: await planFields(c, userId, raw, previous) }, { returnDocument: "after" });
    if (saved && options.activate) await activatePlan(c, userId, saved._id);
    return saved && options.activate ? { ...saved, active: true } : saved;
  }
  const fields = await planFields(c, userId, raw);
  const first = (await c.dietPlans.countDocuments({ userId, active: true })) === 0;
  const doc: DietPlanDoc = { _id: new ObjectId(), userId, ...fields, active: false, createdAt: new Date() };
  await c.dietPlans.insertOne(doc);
  if (options.activate || first) {
    await activatePlan(c, userId, doc._id);
    doc.active = true;
  }
  return doc;
}

/** Makes one plan the active one; the others are archived (kept, never deleted). */
export async function activatePlan(c: Collections, userId: ObjectId, id: ObjectId): Promise<boolean> {
  const found = await c.dietPlans.updateOne({ _id: id, userId }, { $set: { active: true } });
  if (!found.matchedCount) return false;
  await c.dietPlans.updateMany({ userId, _id: { $ne: id } }, { $set: { active: false } });
  return true;
}

export async function archivePlan(c: Collections, userId: ObjectId, id: ObjectId): Promise<boolean> {
  return (await c.dietPlans.updateOne({ _id: id, userId }, { $set: { active: false } })).matchedCount > 0;
}

/** Deletes a plan; its recipes stay, so favorites and other plans keep them. */
export async function deletePlan(c: Collections, userId: ObjectId, id: ObjectId): Promise<boolean> {
  return (await c.dietPlans.deleteOne({ _id: id, userId })).deletedCount > 0;
}

const DEFAULT_SHOPPING = { days: 7, servings: 1, checked: [] as string[] };

/**
 * The week's choice for the active plan. A week nothing was chosen for starts with the latest
 * earlier choice for the same plan ("carried"), so a choice repeats until it is changed.
 */
export async function weekOf(c: Collections, userId: ObjectId, week: string, active: DietPlanDoc | null): Promise<DietWeekDto> {
  const monday = mondayOf(week);
  const own = await c.dietWeeks.findOne({ userId, week: monday });
  const planId = active?._id ?? null;
  const fromPlan = (doc: DietWeekDoc | null) => (doc && planId && doc.planId?.equals(planId) ? doc.choices : {});
  let choices = fromPlan(own);
  let carried = false;
  if (Object.keys(choices).length === 0 && planId) {
    const before = await c.dietWeeks.findOne({ userId, planId, week: { $lt: monday } }, { sort: { week: -1 } });
    if (before && Object.keys(before.choices).length) {
      choices = before.choices;
      carried = true;
    }
  }
  // Only meals and options the plan still has.
  const valid = Object.fromEntries(Object.entries(choices).filter(([slot, recipe]) => active?.slots.some((s) => s.id === slot && s.options.includes(recipe))));
  return { week: monday, planId: planId?.toHexString() ?? null, choices: valid, carried, shopping: own?.shopping ?? DEFAULT_SHOPPING };
}

export async function chooseWeek(c: Collections, userId: ObjectId, week: string, raw: z.input<typeof weekChoicesSchema>): Promise<void> {
  const input = weekChoicesSchema.parse(raw);
  const plan = await c.dietPlans.findOne({ _id: new ObjectId(input.planId), userId });
  if (!plan) throw new DietProblem("unknown-plan");
  for (const [slot, recipe] of Object.entries(input.choices)) {
    if (!plan.slots.some((s) => s.id === slot && s.options.includes(recipe))) throw new DietProblem("not-an-option");
  }
  await c.dietWeeks.updateOne(
    { userId, week: mondayOf(week) },
    { $set: { planId: plan._id, choices: input.choices, updatedAt: new Date() }, $setOnInsert: { _id: new ObjectId(), shopping: DEFAULT_SHOPPING } },
    { upsert: true },
  );
}

export async function setShopping(c: Collections, userId: ObjectId, week: string, raw: z.input<typeof shoppingStateSchema>): Promise<void> {
  const shopping = shoppingStateSchema.parse(raw);
  const monday = mondayOf(week);
  // A week saved only for its list keeps the choice it was showing.
  const existing = await c.dietWeeks.findOne({ userId, week: monday });
  if (!existing) {
    const active = await c.dietPlans.findOne({ userId, active: true });
    const shown = await weekOf(c, userId, monday, active);
    await c.dietWeeks.insertOne({
      _id: new ObjectId(),
      userId,
      week: monday,
      planId: active?._id ?? null,
      choices: shown.choices,
      shopping,
      updatedAt: new Date(),
    });
    return;
  }
  await c.dietWeeks.updateOne({ _id: existing._id }, { $set: { shopping, updatedAt: new Date() } });
}

export async function setDietPrefs(c: Collections, userId: ObjectId, raw: unknown): Promise<DietPrefs> {
  const prefs = dietPrefsSchema.parse(raw);
  await c.users.updateOne({ _id: userId }, { $set: { dietPrefs: prefs } });
  return prefs;
}

/** Everything the diet screens need: likes, plans (active first), recipes and the week. */
export async function dietOf(c: Collections, user: UserDoc, week: string): Promise<DietDto> {
  const [plans, recipes] = await Promise.all([
    c.dietPlans.find({ userId: user._id }).sort({ active: -1, createdAt: -1 }).toArray(),
    c.recipes.find({ userId: user._id }).sort({ title: 1 }).toArray(),
  ]);
  const active = plans.find((p) => p.active) ?? null;
  return { prefs: user.dietPrefs ?? {}, plans: plans.map(toPlanDto), recipes: recipes.map(toRecipeDto), week: await weekOf(c, user._id, week, active) };
}

// ---- HTTP -------------------------------------------------------------------------------------

const objectId = z.string().regex(/^[0-9a-f]{24}$/).transform((x) => new ObjectId(x));
const day = z.iso.date();

export function dietRoutes({ collections, withUser }: { collections: () => Collections; withUser: () => RequestHandler }) {
  const router = express.Router();
  const route = (handler: Parameters<typeof asyncRoute>[0]) => [
    withUser(),
    asyncRoute(async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (error instanceof DietProblem) return void res.status(400).json({ error: error.message });
        throw error;
      }
    }),
  ];
  const notFound = (res: express.Response) => res.status(404).json({ error: "not-found" });

  router.get("/diet", ...route(async (req, res) => {
    const week = day.catch(new Date().toISOString().slice(0, 10)).parse(req.query.week);
    res.json(await dietOf(collections(), req.user!, week));
  }));
  router.put("/diet/prefs", ...route(async (req, res) => {
    res.json(await setDietPrefs(collections(), req.user!._id, req.body));
  }));

  router.post("/diet/recipes", ...route(async (req, res) => {
    res.status(201).json(toRecipeDto((await saveRecipe(collections(), req.user!._id, req.body))!));
  }));
  router.put("/diet/recipes/:id", ...route(async (req, res) => {
    const saved = await saveRecipe(collections(), req.user!._id, req.body, objectId.parse(req.params.id));
    return saved ? void res.json(toRecipeDto(saved)) : void notFound(res);
  }));
  router.put("/diet/recipes/:id/favorite", ...route(async (req, res) => {
    const saved = await setFavorite(collections(), req.user!._id, objectId.parse(req.params.id), z.boolean().parse(req.body?.favorite));
    return saved ? void res.json(toRecipeDto(saved)) : void notFound(res);
  }));
  router.delete("/diet/recipes/:id", ...route(async (req, res) => {
    res.status((await deleteRecipe(collections(), req.user!._id, objectId.parse(req.params.id))) ? 204 : 404).end();
  }));

  router.post("/diet/plans", ...route(async (req, res) => {
    const saved = await savePlan(collections(), req.user!._id, req.body, { activate: req.body?.activate === true });
    res.status(201).json(toPlanDto(saved!));
  }));
  router.put("/diet/plans/:id", ...route(async (req, res) => {
    const saved = await savePlan(collections(), req.user!._id, req.body, { id: objectId.parse(req.params.id) });
    return saved ? void res.json(toPlanDto(saved)) : void notFound(res);
  }));
  router.post("/diet/plans/:id/activate", ...route(async (req, res) => {
    res.status((await activatePlan(collections(), req.user!._id, objectId.parse(req.params.id))) ? 204 : 404).end();
  }));
  router.post("/diet/plans/:id/archive", ...route(async (req, res) => {
    res.status((await archivePlan(collections(), req.user!._id, objectId.parse(req.params.id))) ? 204 : 404).end();
  }));
  router.delete("/diet/plans/:id", ...route(async (req, res) => {
    res.status((await deletePlan(collections(), req.user!._id, objectId.parse(req.params.id))) ? 204 : 404).end();
  }));

  router.put("/diet/weeks/:week", ...route(async (req, res) => {
    await chooseWeek(collections(), req.user!._id, day.parse(req.params.week), req.body);
    res.status(204).end();
  }));
  router.put("/diet/weeks/:week/shopping", ...route(async (req, res) => {
    await setShopping(collections(), req.user!._id, day.parse(req.params.week), req.body);
    res.status(204).end();
  }));

  return router;
}
