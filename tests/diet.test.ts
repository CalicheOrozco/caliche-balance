import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { collections, ensureIndexes } from "../server/db.ts";
import { mealOfSlot, mondayOf, shoppingList } from "../shared/diet.ts";

let mongo: MongoMemoryServer;
let client: MongoClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await new MongoClient(mongo.getUri()).connect();
  const c = collections(client.db("test"));
  await ensureIndexes(c);
  app = createApp({ getCollections: async () => c, secureCookies: false });
});

beforeEach(async () => {
  await client.db("test").collection("rateLimits").deleteMany({});
});

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

const profile = { sex: "male", birthDate: "1997-12-14", heightCm: 185, language: "es", unit: "kg" };

const avena = {
  title: "Avena con plátano",
  emoji: "🥣",
  servings: 1,
  kcal: 380,
  proteinG: 14,
  carbsG: 62,
  fatG: 8,
  prepMin: 5,
  cookMin: 5,
  tags: ["rápida"],
  ingredients: [
    { qty: 50, unit: "g", item: "Avena" },
    { qty: 1, unit: "pz", item: "Plátano" },
    { qty: 250, unit: "ml", item: "Leche" },
  ],
  steps: ["Calienta la leche.", "Agrega la avena y el plátano."],
};
const huevos = { ...avena, title: "Huevos a la mexicana", emoji: "🍳", kcal: 300, ingredients: [{ qty: 2, unit: "pz", item: "Huevo" }, { qty: null, unit: null, item: "Sal" }] };
const pollo = {
  ...avena,
  title: "Pollo con verduras",
  emoji: "🍗",
  servings: 4,
  kcal: 450,
  ingredients: [
    { qty: 800, unit: "g", item: "Pechuga de pollo" },
    { qty: 1, unit: "l", item: "Caldo" },
  ],
};

async function signedIn(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ username, password: `contraseña-${username}` });
  await agent.put("/api/me/profile").send(profile);
  return agent;
}

describe("diet", () => {
  it("keeps recipes, a plan with options, the week's choice carried over, and checks ownership", async () => {
    const agent = await signedIn("dieta");
    const a = (await agent.post("/api/diet/recipes").send(avena)).body;
    const h = (await agent.post("/api/diet/recipes").send(huevos)).body;
    const p = (await agent.post("/api/diet/recipes").send(pollo)).body;
    expect(a).toMatchObject({ title: "Avena con plátano", favorite: false, ingredients: avena.ingredients });
    expect((await agent.post("/api/diet/recipes").send({ ...avena, imageUrl: "http://inseguro.example/a.jpg" })).status).toBe(400);

    // The first plan becomes the active one.
    const plan = await agent.post("/api/diet/plans").send({
      name: "Plan noviembre",
      month: "2026-11",
      author: "nutritionist",
      source: "Nutrióloga Ana",
      kcalTarget: 1_900,
      slots: [
        { name: "Desayuno", time: "08:00", options: [a.id, h.id] },
        { name: "Comida", options: [p.id] },
      ],
    });
    expect(plan.status).toBe(201);
    expect(plan.body).toMatchObject({ active: true, slots: [{ name: "Desayuno", meal: "breakfast" }, { name: "Comida", meal: "lunch" }] });
    const [desayuno, comida] = plan.body.slots as { id: string }[];

    // Only options of that meal can be chosen.
    expect((await agent.put("/api/diet/weeks/2026-11-04").send({ planId: plan.body.id, choices: { [desayuno!.id]: p.id } })).status).toBe(400);
    expect((await agent.put("/api/diet/weeks/2026-11-04").send({ planId: plan.body.id, choices: { [desayuno!.id]: h.id, [comida!.id]: p.id } })).status).toBe(204);

    const now = (await agent.get("/api/diet").query({ week: "2026-11-08" })).body;
    expect(now.week).toMatchObject({ week: "2026-11-02", carried: false, choices: { [desayuno!.id]: h.id, [comida!.id]: p.id } });
    // A week nothing was chosen for starts with the last choice.
    const next = (await agent.get("/api/diet").query({ week: "2026-11-12" })).body;
    expect(next.week).toMatchObject({ week: "2026-11-09", carried: true, choices: { [desayuno!.id]: h.id } });

    // Checking off the list of a carried week keeps the choice it showed.
    expect((await agent.put("/api/diet/weeks/2026-11-09/shopping").send({ days: 5, servings: 1, checked: ["huevo|pz"] })).status).toBe(204);
    const saved = (await agent.get("/api/diet").query({ week: "2026-11-09" })).body.week;
    expect(saved).toMatchObject({ carried: false, shopping: { days: 5, checked: ["huevo|pz"] }, choices: { [desayuno!.id]: h.id } });

    // A second plan can be made active; the first is archived, not deleted.
    const second = (await agent.post("/api/diet/plans").send({ name: "Plan Claude", author: "claude", slots: [{ name: "Cena", options: [a.id] }], activate: true })).body;
    const plans = (await agent.get("/api/diet")).body.plans as { id: string; active: boolean }[];
    expect(plans.map((x) => [x.id, x.active])).toEqual([
      [second.id, true],
      [plan.body.id, false],
    ]);

    // Deleting a recipe takes it out of every plan and choice.
    await agent.put(`/api/diet/recipes/${h.id}/favorite`).send({ favorite: true });
    expect((await agent.delete(`/api/diet/recipes/${h.id}`)).status).toBe(204);
    await agent.post(`/api/diet/plans/${plan.body.id}/activate`);
    const after = (await agent.get("/api/diet").query({ week: "2026-11-08" })).body;
    expect(after.plans.find((x: { id: string }) => x.id === plan.body.id).slots[0].options).toEqual([a.id]);
    expect(after.week.choices).toEqual({ [comida!.id]: p.id });

    // Likes for Claude.
    expect((await agent.put("/api/diet/prefs").send({ likes: "Tacos, comida mexicana", allergies: "Ninguna" })).body).toEqual({ likes: "Tacos, comida mexicana", allergies: "Ninguna" });

    // Nobody else can see or use them.
    const other = await signedIn("otro-dieta");
    expect((await other.get("/api/diet")).body).toMatchObject({ plans: [], recipes: [], prefs: {} });
    expect((await other.delete(`/api/diet/recipes/${a.id}`)).status).toBe(404);
    expect((await other.post("/api/diet/plans").send({ name: "X", author: "me", slots: [{ name: "Cena", options: [a.id] }] })).status).toBe(400);
  });
});

describe("diet helpers", () => {
  it("adds up the shopping list across recipes, scaled to the days and servings", () => {
    const list = shoppingList(
      [
        { title: "Avena", servings: 1, ingredients: [{ qty: 50, unit: "g", item: "Avena" }, { qty: 250, unit: "ml", item: "Leche" }] },
        { title: "Licuado", servings: 2, ingredients: [{ qty: 0.5, unit: "l", item: "leche " }, { qty: null, unit: null, item: "Canela" }] },
        { title: "Pollo", servings: 4, ingredients: [{ qty: 800, unit: "gr", item: "Pechuga de pollo" }] },
      ],
      7,
      1,
    );
    expect(list).toEqual([
      { key: "avena|g", item: "Avena", qty: 350, unit: "g", recipes: ["Avena"] },
      { key: "canela|", item: "Canela", qty: null, unit: null, recipes: ["Licuado"] },
      // 250 ml × 7 + 500 ml × 7 / 2
      { key: "leche|ml", item: "Leche", qty: 3.5, unit: "l", recipes: ["Avena", "Licuado"] },
      { key: "pechuga de pollo|g", item: "Pechuga de pollo", qty: 1.4, unit: "kg", recipes: ["Pollo"] },
    ]);
  });

  it("knows the week and the kind of meal", () => {
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(mondayOf("2026-11-09")).toBe("2026-11-09");
    expect(mealOfSlot("Colación 1")).toBe("snack");
    expect(mealOfSlot("Cena")).toBe("dinner");
    expect(mealOfSlot("Pre-entreno", "06:30")).toBe("breakfast");
  });
});
