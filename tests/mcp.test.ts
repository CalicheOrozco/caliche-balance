import { createHash, randomBytes } from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { collections, ensureIndexes } from "../server/db.ts";

let mongo: MongoMemoryServer;
let client: MongoClient;
let app: ReturnType<typeof createApp>;

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

beforeAll(async () => {
  process.env.MCP_SECRET = "una-llave-de-prueba-de-al-menos-32-caracteres";
  process.env.PUBLIC_URL = "http://127.0.0.1";
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

/** What Claude does: register, open the sign-in page, sign in, and trade the code for tokens. */
async function connect(username: string, password: string) {
  const registered = await request(app).post("/register").send({ redirect_uris: [REDIRECT], client_name: "Claude", token_endpoint_auth_method: "none" });
  expect(registered.status).toBe(201);
  const clientId = registered.body.client_id as string;

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  // The sign-in page lives under /api/oauth, where no version of the app's service worker answers.
  const meta = await request(app).get("/.well-known/oauth-authorization-server");
  expect(meta.body.authorization_endpoint).toBe("http://127.0.0.1/api/oauth/authorize");
  const page = await request(app)
    .get("/api/oauth/authorize")
    .query({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  expect(page.status).toBe(200);
  expect(page.text).toContain("Conectar con Claude");
  const signIn = /name="request" value="([^"]+)"/.exec(page.text)![1]!;

  expect(page.text).toContain('action="/api/oauth/login"');
  const wrong = await request(app).post("/api/oauth/login").type("form").send({ request: signIn, username, password: "no-es-esta", action: "allow" });
  expect(wrong.status).toBe(401);

  const login = await request(app).post("/api/oauth/login").type("form").send({ request: signIn, username, password, action: "allow" });
  expect(login.status).toBe(302);
  const back = new URL(login.headers.location as string);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("xyz");

  const tokens = await request(app)
    .post("/token")
    .type("form")
    .send({ grant_type: "authorization_code", code: back.searchParams.get("code"), code_verifier: verifier, redirect_uri: REDIRECT, client_id: clientId });
  expect(tokens.status).toBe(200);
  return { clientId, access: tokens.body.access_token as string, refresh: tokens.body.refresh_token as string };
}

let rpcId = 0;
async function call(access: string, method: string, params: object) {
  return request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${access}`)
    .set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id: ++rpcId, method, params });
}

async function tool(access: string, name: string, args: object = {}) {
  const res = await call(access, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const result = res.body.result;
  return { isError: Boolean(result.isError), text: result.content[0].text as string, data: result.isError ? null : JSON.parse(result.content[0].text) };
}

describe("Claude connector (MCP)", () => {
  it("publishes its OAuth metadata and asks for a token", async () => {
    const meta = await request(app).get("/.well-known/oauth-authorization-server");
    expect(meta.status).toBe(200);
    expect(meta.body.authorization_endpoint).toBe("http://127.0.0.1/api/oauth/authorize");
    expect((await request(app).post("/mcp").send({})).status).toBe(401);
    // Only Claude's hosts may register.
    expect((await request(app).post("/register").send({ redirect_uris: ["https://evil.example/cb"] })).status).toBe(400);
  });

  it("signs in, saves and reads data as the person, and ends when the password changes", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ username: "clau", password: "contraseña-clau" });
    await agent.put("/api/me/profile").send({ sex: "male", birthDate: "1997-12-14", heightCm: 180, language: "es", unit: "kg" });

    const { access, refresh, clientId } = await connect("clau", "contraseña-clau");

    // Claude shows the connector with the app's icon and site.
    const init = await call(access, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result.serverInfo).toMatchObject({ title: "Caliche Balance", websiteUrl: "http://127.0.0.1" });
    expect(init.body.result.serverInfo.icons[0].src).toBe("http://127.0.0.1/icon-512.png");

    const list = await call(access, "tools/list", {});
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_body_summary", "add_weigh_in", "add_lab_study", "get_lab_study", "set_goals"]));

    const added = await tool(access, "add_weigh_in", { weight: 100.7, bodyFatPct: 30.8, waist: 96, note: "Cena tarde", measuredAt: "2026-11-07T09:39:00-04:00" });
    expect(added.isError).toBe(false);
    expect(added.data).toMatchObject({ weightKg: 100.7, waistCm: 96, note: "Cena tarde", bodyFat: { pct: 30.8, source: "xiaomi" } });
    // The weigh-in is the app's own: it shows up in the app's API.
    expect((await agent.get("/api/measurements")).body[0].note).toBe("Cena tarde");

    const summary = await tool(access, "get_body_summary");
    expect(summary.data.latestFullWeighInReport.rated.map((r: { measure: string }) => r.measure)).toContain("bmi");

    const goals = await tool(access, "set_goals", { weight: { value: 90, unit: "kg" } });
    expect(goals.data.weight.targetKg).toBe(90);

    const lab = await tool(access, "add_lab_study", {
      takenAt: "2026-08-29",
      results: [
        { name: "GLUCOSA", value: 96.7, unit: "mg/dL", ref: "74.0 - 106.0" },
        { name: "COLESTEROL HDL", value: 43.3, unit: "mg/dL", ref: ">55.0", flagged: true },
        { name: "CREATININA EN SUERO", value: 1.06, unit: "mg/dL", ref: "0.70 - 1.20" },
        { name: "BACTERIAS", text: "Moderadas", ref: "Ausentes", flagged: true, group: "urine" },
      ],
    });
    expect(lab.isError).toBe(false);
    expect(lab.data.counts).toEqual({ good: 2, warn: 2, bad: 0 });
    expect(lab.data.computed.egfrMlMin).toBe(98);
    expect(lab.data.results.find((r: { key: string }) => r.key === "hdl").explanation).toContain("40 mg/dL");
    expect((await agent.get("/api/labs")).body).toHaveLength(1);

    // An electrocardiogram from the same day joins the study instead of replacing it.
    const ecg = await tool(access, "add_lab_study", {
      takenAt: "2026-08-29",
      merge: true,
      results: [
        { name: "RITMO", text: "Sinusal", group: "ecg" },
        { name: "FRECUENCIA CARDIACA", value: 60, unit: "lpm", group: "ecg" },
      ],
    });
    expect(ecg.isError).toBe(false);
    const labs = (await agent.get("/api/labs")).body;
    expect(labs).toHaveLength(1);
    expect(labs[0].results).toHaveLength(6);
    expect(labs[0].results.find((r: { key: string }) => r.key === "ecgHr").group).toBe("ecg");

    // Apple Health days from Claude, like the Shortcut sends them; a bad day is skipped, not the rest.
    const health = await tool(access, "add_health_days", {
      days: [
        {
          date: "2026-11-06",
          steps: 9500,
          restingHr: 61,
          hrvMs: 42,
          sleep: [
            { start: "2026-11-05T23:30:00-04:00", end: "2026-11-06T03:00:00-04:00", stage: "core" },
            { start: "2026-11-06T03:00:00-04:00", end: "2026-11-06T04:00:00-04:00", stage: "deep" },
            { start: "2026-11-06T04:00:00-04:00", end: "2026-11-06T06:30:00-04:00", stage: "rem" },
          ],
          symptoms: { fatigue: "Mild" },
        },
        { date: "2026-11-07", steps: 12000, activeKcal: 640 },
        { date: "2026-11-08" },
      ],
    });
    expect(health.isError).toBe(false);
    expect(health.data).toMatchObject({ savedDays: 2, from: "2026-11-06", to: "2026-11-07" });
    expect(health.data.skipped).toHaveLength(1);
    const days = await tool(access, "list_health_days");
    const night = days.data.find((d: { date: string }) => d.date === "2026-11-06");
    expect(night.steps).toBe(9500);
    expect(night.symptoms.fatigue).toBeTruthy();
    expect(night.sleep.asleepMin).toBe(420);
    expect((await agent.get("/api/me")).body.appleHealth).toBeTruthy();

    // Food Claude worked out, against what Apple Health says was spent that day.
    const food = await tool(access, "add_food", {
      entries: [
        { date: "2026-11-06", meal: "lunch", name: "Tacos al pastor", amount: "3 tacos", kcal: 450, proteinG: 24, carbsG: 45, fatG: 18, note: "Tortilla de maíz, con piña" },
        { date: "2026-11-06", meal: "lunch", name: "Coca-Cola", amount: "600 ml", kcal: 252, carbsG: 63 },
      ],
    });
    expect(food.isError).toBe(false);
    expect(food.data.days).toEqual([{ date: "2026-11-06", totals: { kcal: 702, proteinG: 24, carbsG: 108, fatG: 18, fiberG: 0, entries: 2 } }]);
    const eaten = await tool(access, "list_food", { to: "2026-11-07", days: 2 });
    const day = eaten.data.find((d: { date: string }) => d.date === "2026-11-06");
    expect(day.entries[0].source).toBe("claude");
    expect(day.spentKcal).toBeNull();
    expect((await agent.get("/api/food").query({ from: "2026-11-06", to: "2026-11-06" })).body).toHaveLength(2);

    // A diet plan made by Claude with new recipes, the week chosen, and its shopping list.
    await tool(access, "set_diet_preferences", { likes: "Comida mexicana", dislikes: "Hígado" });
    const dietPlan = await tool(access, "create_diet_plan", {
      name: "Plan de prueba",
      author: "claude",
      kcalTarget: 1_900,
      slots: [
        {
          name: "Desayuno",
          options: [
            { recipe: { title: "Chilaquiles verdes", emoji: "🌶️", servings: 2, kcal: 520, ingredients: [{ qty: 200, unit: "g", item: "Totopos" }], steps: ["Hierve la salsa."] } },
            { recipe: { title: "Molletes", servings: 1, kcal: 430, ingredients: [{ qty: 1, unit: "pz", item: "Bolillo" }] } },
          ],
        },
      ],
    });
    expect(dietPlan.isError).toBe(false);
    expect(dietPlan.data.active).toBe(true);
    const slot = dietPlan.data.slots[0];
    const chosen = await tool(access, "choose_week", { choices: [{ slotId: slot.id, recipeId: slot.options[0] }] });
    expect(chosen.data.choices).toEqual({ [slot.id]: slot.options[0] });
    const diet = await tool(access, "get_diet");
    expect(diet.data.preferences.dislikes).toBe("Hígado");
    expect(diet.data.week.kcalChosen).toBe(520);
    const shopping = await tool(access, "get_shopping_list", {});
    // 200 g for 2 servings, one serving a day for 7 days.
    expect(shopping.data.items).toEqual([{ key: "totopos|g", item: "Totopos", qty: 700, unit: "g", recipes: ["Chilaquiles verdes"], checked: false }]);
    expect((await tool(access, "choose_week", { choices: [{ slotId: slot.id, recipeId: "0123456789abcdef01234567" }] })).isError).toBe(true);

    const bad = await tool(access, "get_weigh_in", { id: "not-an-id" });
    expect(bad.isError).toBe(true);

    // Refresh tokens rotate; using an old one again looks like theft and ends that sign-in.
    const refreshed = await request(app).post("/token").type("form").send({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
    expect(refreshed.status).toBe(200);
    const fresh = refreshed.body.access_token as string;
    expect((await call(fresh, "tools/list", {})).status).toBe(200);
    expect((await request(app).post("/token").type("form").send({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId })).status).toBe(400);
    expect((await call(fresh, "tools/list", {})).status).toBe(401);

    // A new password ends every connector.
    const again = await connect("clau", "contraseña-clau");
    expect((await call(again.access, "tools/list", {})).status).toBe(200);
    await agent.put("/api/me/password").send({ currentPassword: "contraseña-clau", newPassword: "otra-contraseña" });
    expect((await call(again.access, "tools/list", {})).status).toBe(401);
  });

  it("never shows one person's data to another", async () => {
    const a = request.agent(app);
    await a.post("/api/auth/register").send({ username: "ana-mcp", password: "contraseña-ana" });
    await a.put("/api/me/profile").send({ sex: "female", birthDate: "1990-01-01", heightCm: 165, language: "en", unit: "kg" });
    await a.post("/api/measurements").send({ weight: 60 });
    const b = request.agent(app);
    await b.post("/api/auth/register").send({ username: "beto-mcp", password: "contraseña-beto" });
    await b.put("/api/me/profile").send({ sex: "male", birthDate: "1990-01-01", heightCm: 175, language: "es", unit: "kg" });

    const { access } = await connect("beto-mcp", "contraseña-beto");
    const anaId = (await a.get("/api/measurements")).body[0].id;
    expect((await tool(access, "list_weigh_ins")).data).toEqual([]);
    expect((await tool(access, "get_weigh_in", { id: anaId })).isError).toBe(true);
    expect((await tool(access, "delete_weigh_in", { id: anaId })).isError).toBe(true);
    expect((await a.get("/api/measurements")).body).toHaveLength(1);
  });
});
