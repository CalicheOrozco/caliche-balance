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
  const page = await request(app)
    .get("/authorize")
    .query({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" });
  expect(page.status).toBe(200);
  expect(page.text).toContain("Conectar con Claude");
  const signIn = /name="request" value="([^"]+)"/.exec(page.text)![1]!;

  const wrong = await request(app).post("/mcp-login").type("form").send({ request: signIn, username, password: "no-es-esta", action: "allow" });
  expect(wrong.status).toBe(401);

  const login = await request(app).post("/mcp-login").type("form").send({ request: signIn, username, password, action: "allow" });
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
    expect(meta.body.authorization_endpoint).toBe("http://127.0.0.1/authorize");
    expect((await request(app).post("/mcp").send({})).status).toBe(401);
    // Only Claude's hosts may register.
    expect((await request(app).post("/register").send({ redirect_uris: ["https://evil.example/cb"] })).status).toBe(400);
  });

  it("signs in, saves and reads data as the person, and ends when the password changes", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ username: "clau", password: "contraseña-clau" });
    await agent.put("/api/me/profile").send({ sex: "male", birthDate: "1997-12-14", heightCm: 180, language: "es", unit: "kg" });

    const { access, refresh, clientId } = await connect("clau", "contraseña-clau");

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
