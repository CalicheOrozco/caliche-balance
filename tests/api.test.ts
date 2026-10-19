import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { collections, ensureIndexes } from "../server/db.ts";

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

// Every test registers from the same IP; start each one with fresh attempt counters.
beforeEach(async () => {
  await client.db("test").collection("rateLimits").deleteMany({});
});

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

const profile = { sex: "male", birthDate: "1996-01-01", heightCm: 175, language: "es", unit: "kg" };

describe("Caliche Balance API", () => {
  it("runs the whole flow: register, profile, manual readings, history, logout, recovery", async () => {
    const agent = request.agent(app);

    const register = await agent.post("/api/auth/register").send({ username: " Caliche ", password: "contraseña-segura" });
    expect(register.status).toBe(201);
    expect(register.body.user).toEqual({
      username: "caliche",
      profile: null,
      goals: { weight: null, bodyFat: null, maintain: null },
      notifications: { newWeighIn: true, zepp: true, goals: true },
    });
    expect(register.body.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    expect(register.headers["set-cookie"]?.[0]).toMatch(/cb_session=.*HttpOnly/);

    expect((await agent.post("/api/auth/register").send({ username: "caliche", password: "otra-contraseña" })).status).toBe(409);

    const saved = await agent.put("/api/me/profile").send(profile);
    expect(saved.status).toBe(200);
    expect(saved.body.profile).toMatchObject({ sex: "male", heightCm: 175, displayName: null });

    // What a person may type on an iPhone in Spanish: decimal commas and pounds.
    const add = () =>
      agent.post("/api/measurements").send({ weight: "163,1", weightUnit: "lb", bodyFatPct: "19,2", measuredAt: "2026-10-18T07:30:00-03:00" });
    const first = await add();
    expect(first.status).toBe(201);
    expect(first.body.weightKg).toBeCloseTo(73.98, 2);
    expect(first.body.bodyFatPct).toBeCloseTo(19.2);
    expect(first.body.source).toBe("manual");

    // Saving the same instant again updates it instead of duplicating it.
    expect((await add()).status).toBe(201);
    const later = await agent.post("/api/measurements").send({ weight: 74.5, bodyFatPct: 19.4, muscleKg: 55.2 });

    const history = await agent.get("/api/measurements");
    expect(history.body).toHaveLength(2);
    expect(history.body[0].id).toBe(later.body.id);

    // Without a session nothing can be added or read.
    expect((await request(app).post("/api/measurements").send({ weight: 70 })).status).toBe(401);
    expect((await request(app).get("/api/measurements")).status).toBe(401);

    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/me")).status).toBe(401);

    expect((await agent.post("/api/auth/login").send({ username: "caliche", password: "equivocada-123" })).body.error).toBe("wrong-password");

    const recovered = await agent.post("/api/auth/recover").send({
      username: "caliche",
      recoveryCode: register.body.recoveryCode.toLowerCase().replaceAll("-", " "),
      newPassword: "nueva-contraseña",
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.recoveryCode).not.toBe(register.body.recoveryCode);

    // The old recovery code is spent; the new password works.
    expect(
      (
        await request(app)
          .post("/api/auth/recover")
          .send({ username: "caliche", recoveryCode: register.body.recoveryCode, newPassword: "otra-mas-123" })
      ).status,
    ).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ username: "caliche", password: "nueva-contraseña" })).status).toBe(200);
  });

  it("saves goals with the starting point from the latest reading", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ username: "gaby", password: "contraseña-gaby" });
    await agent.post("/api/measurements").send({ weight: 99.5, bodyFatPct: 30.2, measuredAt: "2026-10-01T08:00:00Z" });
    await agent.post("/api/measurements").send({ weight: 98, measuredAt: "2026-10-10T08:00:00Z" });

    const set = await agent.put("/api/me/goals").send({ weight: { value: "198,4", unit: "lb" }, bodyFatPct: 22 });
    expect(set.status).toBe(200);
    expect(set.body.goals.weight).toMatchObject({ targetKg: 89.99, startKg: 98 });
    // Body fat starts from the newest reading that has it.
    expect(set.body.goals.bodyFat).toMatchObject({ targetPct: 22, startPct: 30.2 });

    // Re-saving the same target keeps its start; removing one leaves the other.
    await agent.post("/api/measurements").send({ weight: 96 });
    const again = await agent.put("/api/me/goals").send({ weight: { value: 89.99, unit: "kg" }, bodyFatPct: null });
    expect(again.body.goals.weight.startKg).toBe(98);
    expect(again.body.goals.bodyFat).toBeNull();
    expect((await agent.get("/api/me")).body.goals.weight.targetKg).toBe(89.99);

    expect((await agent.put("/api/me/goals").send({ weight: { value: 10, unit: "kg" }, bodyFatPct: null })).status).toBe(400);
  });

  it("stores a waist when adding a reading or later on an existing one", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ username: "hugo", password: "contraseña-hugo" });
    const withWaist = await agent.post("/api/measurements").send({ weight: 90, waist: "37,5", waistUnit: "in" });
    expect(withWaist.body.waistCm).toBeCloseTo(95.3, 1);

    const plain = await agent.post("/api/measurements").send({ weight: 89, measuredAt: "2026-10-01T08:00:00Z" });
    expect(plain.body.waistCm).toBeNull();
    const patched = await agent.patch(`/api/measurements/${plain.body.id}/waist`).send({ waist: 96, waistUnit: "cm" });
    expect(patched.body.waistCm).toBe(96);
    expect((await agent.patch(`/api/measurements/${plain.body.id}/waist`).send({ waist: null })).body.waistCm).toBeNull();

    // Nobody else can touch it.
    const other = request.agent(app);
    await other.post("/api/auth/register").send({ username: "ines", password: "contraseña-ines" });
    expect((await other.patch(`/api/measurements/${plain.body.id}/waist`).send({ waist: 80 })).status).toBe(404);
  });

  it("keeps each person's data private", async () => {
    const ana = request.agent(app);
    const beto = request.agent(app);
    await ana.post("/api/auth/register").send({ username: "ana", password: "contraseña-ana" });
    await beto.post("/api/auth/register").send({ username: "beto", password: "contraseña-beto" });

    const reading = await ana.post("/api/measurements").send({ weight: 60 });
    expect((await beto.get("/api/measurements")).body).toEqual([]);
    expect((await beto.delete(`/api/measurements/${reading.body.id}`)).status).toBe(404);
    expect((await ana.get("/api/measurements")).body).toHaveLength(1);
  });

  it("rejects invalid input with field details", async () => {
    const agent = request.agent(app);
    const bad = await agent.post("/api/auth/register").send({ username: "a", password: "corta" });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.map((f: { path: string }) => f.path).sort()).toEqual(["password", "username"]);

    await agent.post("/api/auth/register").send({ username: "carla", password: "contraseña-carla" });
    expect((await agent.post("/api/measurements").send({ weight: 70, bodyFatPct: 90 })).status).toBe(400);
    expect((await agent.post("/api/measurements").send({ weight: 70, measuredAt: "ayer" })).status).toBe(400);
  });

  it("explains why a login failed and locks after repeated wrong passwords", async () => {
    await request(app).post("/api/auth/register").send({ username: "dani", password: "contraseña-dani" });

    const missing = await request(app).post("/api/auth/login").send({ username: "Dany", password: "lo-que-sea" });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ error: "user-not-found", username: "dany" });

    // Any length is accepted at login; the 8-character rule only applies to new passwords.
    const short = await request(app).post("/api/auth/login").send({ username: "dani", password: "abc" });
    expect(short.status).toBe(401);
    expect(short.body).toEqual({ error: "wrong-password", attemptsLeft: 9 });

    const statuses = [];
    for (let i = 0; i < 9; i++) {
      statuses.push((await request(app).post("/api/auth/login").send({ username: "dani", password: "incorrecta-1" })).body);
    }
    expect(statuses.at(-2)).toEqual({ error: "wrong-password", attemptsLeft: 1 });
    expect(statuses.at(-1)).toEqual({ error: "wrong-password", attemptsLeft: 0 });

    // Locked: even the right password waits, and the answer says for how long.
    const locked = await request(app).post("/api/auth/login").send({ username: "dani", password: "contraseña-dani" });
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBeDefined();
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(800);
  });

  it("does not count successful logins toward the lock", async () => {
    await request(app).post("/api/auth/register").send({ username: "fer", password: "contraseña-fer" });
    for (let i = 0; i < 12; i++) {
      expect((await request(app).post("/api/auth/login").send({ username: "fer", password: "contraseña-fer" })).status).toBe(200);
    }
  });

  it("deletes an account with all of its data", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ username: "eli", password: "contraseña-eli" });
    await agent.post("/api/measurements").send({ weight: 58 });
    expect((await agent.delete("/api/me")).status).toBe(204);
    const db = client.db("test");
    expect(await db.collection("users").countDocuments({ username: "eli" })).toBe(0);
    expect((await request(app).post("/api/auth/login").send({ username: "eli", password: "contraseña-eli" })).body.error).toBe("user-not-found");
  });
});
