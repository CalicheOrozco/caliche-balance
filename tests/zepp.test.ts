import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { collections, ensureIndexes } from "../server/db.ts";
import type { PushSender, PushTarget } from "../server/push.ts";
import { type ZeppClient, ZeppError, type ZeppMember, type ZeppRecord, decryptToken } from "../server/zepp.ts";

process.env.ZEPP_TOKEN_KEY = randomBytes(32).toString("base64");

const GOOD_TOKEN = "zepp-token-de-prueba-123";

/** In-memory stand-in for the Zepp cloud: a household of three. */
class FakeZepp implements ZeppClient {
  members_: ZeppMember[] = [
    { memberId: "-1", nickname: "Caliche" },
    { memberId: "111", nickname: "Ana" },
    { memberId: "222", nickname: "Beto" },
  ];
  readings: Record<string, ZeppRecord[]> = { "-1": [], "111": [], "222": [] };
  calls = 0;

  add(memberId: string, generatedTime: number, weight: number, extra: Partial<ZeppRecord["summary"]> = {}) {
    this.readings[memberId]!.push({ memberId, generatedTime, summary: { weight, ...extra } as ZeppRecord["summary"] });
  }

  async members(token: string) {
    this.calls++;
    if (token !== GOOD_TOKEN) throw new ZeppError("invalid-token", "rejected");
    return this.members_;
  }

  async records(token: string, _uid: string, memberId: string, since: number) {
    if (token !== GOOD_TOKEN) throw new ZeppError("invalid-token", "rejected");
    return (this.readings[memberId] ?? []).filter((r) => r.generatedTime > since).sort((a, b) => b.generatedTime - a.generatedTime);
  }
}

/** Records what would be pushed; "gone" endpoints behave like an uninstalled app. */
class FakePush implements PushSender {
  publicKey = "test-public-key";
  sent: { endpoint: string; body: string; url: string }[] = [];
  gone = new Set<string>();
  async send(target: PushTarget, payload: string) {
    if (this.gone.has(target.endpoint)) return "gone" as const;
    const { body, url } = JSON.parse(payload);
    this.sent.push({ endpoint: target.endpoint, body, url });
    return "sent" as const;
  }
}

let push: FakePush;
let mongo: MongoMemoryServer;
let client: MongoClient;
let zepp: FakeZepp;
let app: ReturnType<typeof createApp>;
let dbName = 0;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await new MongoClient(mongo.getUri()).connect();
});

beforeEach(async () => {
  const c = collections(client.db(`zepp${dbName++}`));
  await ensureIndexes(c);
  zepp = new FakeZepp();
  push = new FakePush();
  app = createApp({ getCollections: async () => c, secureCookies: false, zepp, cronSecret: "cron-secreto", push });
});

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

async function signUp(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ username, password: `${username}-contraseña` });
  return agent;
}

const connect = (agent: ReturnType<typeof request.agent>) =>
  agent.post("/api/zepp/connect").send({ appToken: GOOD_TOKEN, zeppUserId: "3025876290" });

describe("Zepp connection", () => {
  it("imports every value of the owner's readings and keeps the token encrypted", async () => {
    zepp.add("-1", 1_760_000_000, 99.55, {
      fatRate: 30.2, bodyWaterRate: 49.7, boneMass: 3.54, muscleRate: 65.85, proteinRatio: 16.3,
      visceralFat: 12, metabolism: 1977, muscleAge: 44, bodyScore: 48, impedance: 495, standBodyWeight: 73.5,
    });
    zepp.add("-1", 1_759_000_000, 98.1); // weight only (no bare feet)
    const caliche = await signUp("caliche");

    const res = await connect(caliche);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: "owner", status: "ok", imported: 2 });
    expect(res.body.members.map((m: { memberId: string }) => m.memberId).sort()).toEqual(["-1", "111", "222"]);

    const list = (await caliche.get("/api/measurements")).body;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      source: "zepp", weightKg: 99.55, bodyFatPct: 30.2, waterPct: 49.7, boneKg: 3.54, muscleKg: 65.85,
      proteinPct: 16.3, visceralFat: 12, bmrKcal: 1977, bodyAge: 44, bodyScore: 48, impedance: 495, idealWeightKg: 73.5,
    });
    expect(list[1]).toMatchObject({ weightKg: 98.1, bodyFatPct: null, impedance: null });

    const stored = await client.db(`zepp${dbName - 1}`).collection("zeppConnections").findOne({});
    expect(JSON.stringify(stored)).not.toContain(GOOD_TOKEN);
    expect(decryptToken(stored!.tokenEncrypted)).toBe(GOOD_TOKEN);
  });

  it("rejects a token Zepp does not accept", async () => {
    const caliche = await signUp("caliche");
    const res = await caliche.post("/api/zepp/connect").send({ appToken: "token-equivocado-123", zeppUserId: "3025876290" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("zepp-invalid-token");
    expect((await caliche.get("/api/zepp")).body.role).toBe("none");
  });

  it("shares one scale between three people, each seeing only their own readings", async () => {
    zepp.add("-1", 1_760_000_000, 99.5);
    zepp.add("111", 1_760_000_100, 61.2);
    zepp.add("222", 1_760_000_200, 74.0);
    const caliche = await signUp("caliche");
    await connect(caliche);

    // Ana's readings wait, unassigned, until she joins.
    const invite = await caliche.post("/api/zepp/members/111/invite");
    expect(invite.body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const ana = await signUp("ana");
    expect((await ana.get("/api/measurements")).body).toEqual([]);
    const joined = await ana.post("/api/zepp/join").send({ code: invite.body.code.toLowerCase() });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ role: "member", ownerUsername: "caliche", members: [] });
    expect((await ana.get("/api/measurements")).body.map((m: { weightKg: number }) => m.weightKg)).toEqual([61.2]);

    // The code is single use.
    const other = await signUp("otra");
    expect((await other.post("/api/zepp/join").send({ code: invite.body.code })).status).toBe(400);

    // New readings go straight to whoever is linked; syncs never duplicate.
    zepp.add("111", 1_760_100_000, 60.8);
    await client.db(`zepp${dbName - 1}`).collection("zeppConnections").updateMany({}, { $set: { lastSyncAt: null } });
    expect((await ana.post("/api/zepp/sync")).body.imported).toBe(1);
    await client.db(`zepp${dbName - 1}`).collection("zeppConnections").updateMany({}, { $set: { lastSyncAt: null } });
    expect((await ana.post("/api/zepp/sync")).body.imported).toBe(0);
    expect((await ana.get("/api/measurements")).body).toHaveLength(2);
    expect((await caliche.get("/api/measurements")).body.map((m: { weightKg: number }) => m.weightKg)).toEqual([99.5]);

    // The owner sees who is linked and what is waiting; members do not see the list.
    const status = (await caliche.get("/api/zepp")).body;
    expect(status.members.find((m: { memberId: string }) => m.memberId === "111")).toMatchObject({ linkedUsername: "ana" });
    expect(status.members.find((m: { memberId: string }) => m.memberId === "222")).toMatchObject({ linkedUsername: null, unassignedCount: 1 });
    expect((await ana.get("/api/zepp/unassigned")).status).toBe(404);
  });

  it("lets a person reject a reading and the owner reassign it", async () => {
    zepp.add("111", 1_760_000_100, 74.3); // Zepp mistook Beto for Ana
    const caliche = await signUp("caliche");
    await connect(caliche);
    const invite = await caliche.post("/api/zepp/members/111/invite");
    const ana = await signUp("ana");
    await ana.post("/api/zepp/join").send({ code: invite.body.code });
    const beto = await signUp("beto");
    const betoInvite = await caliche.post("/api/zepp/members/222/invite");
    await beto.post("/api/zepp/join").send({ code: betoInvite.body.code });

    const [reading] = (await ana.get("/api/measurements")).body;
    expect((await ana.post(`/api/measurements/${reading.id}/not-mine`)).status).toBe(204);
    expect((await ana.get("/api/measurements")).body).toEqual([]);

    const unassigned = (await caliche.get("/api/zepp/unassigned")).body;
    expect(unassigned).toHaveLength(1);
    expect((await caliche.post(`/api/zepp/unassigned/${reading.id}/assign`).send({ memberId: "222" })).status).toBe(204);
    expect((await beto.get("/api/measurements")).body.map((m: { weightKg: number }) => m.weightKg)).toEqual([74.3]);

    // A later sync does not hand it back to Ana.
    await client.db(`zepp${dbName - 1}`).collection("zeppConnections").updateMany({}, { $set: { lastSyncAt: null } });
    await ana.post("/api/zepp/sync");
    expect((await ana.get("/api/measurements")).body).toEqual([]);
  });

  it("marks the connection when the token expires, and the daily cron needs its secret", async () => {
    const caliche = await signUp("caliche");
    await connect(caliche);
    await client.db(`zepp${dbName - 1}`).collection("zeppConnections").updateMany({}, { $set: { lastSyncAt: null } });
    zepp.members = async () => {
      throw new ZeppError("invalid-token", "expired");
    };
    expect((await caliche.post("/api/zepp/sync")).body.status).toBe("invalid-token");
    expect((await caliche.get("/api/zepp")).body.status).toBe("invalid-token");

    expect((await request(app).get("/api/cron/zepp-sync")).status).toBe(401);
    const cron = await request(app).get("/api/cron/zepp-sync").set("Authorization", "Bearer cron-secreto");
    expect(cron.status).toBe(200);
    expect(cron.body.connections).toBe(0); // expired connections wait for a new token
  });

  it("removes the household link and unclaimed readings when the owner deletes their account", async () => {
    zepp.add("-1", 1_760_000_000, 99.5);
    zepp.add("222", 1_760_000_200, 74.0);
    const caliche = await signUp("caliche");
    await connect(caliche);
    const invite = await caliche.post("/api/zepp/members/111/invite");
    const ana = await signUp("ana");
    await ana.post("/api/zepp/join").send({ code: invite.body.code });

    expect((await caliche.delete("/api/me")).status).toBe(204);
    const db = client.db(`zepp${dbName - 1}`);
    expect(await db.collection("zeppConnections").countDocuments()).toBe(0);
    expect(await db.collection("zeppMembers").countDocuments()).toBe(0);
    expect(await db.collection("measurements").countDocuments()).toBe(0);
    expect((await ana.get("/api/zepp")).body.role).toBe("none");
  });

  it("notifies the person of a new weigh-in with the change, and the owner when the token expires", async () => {
    const now = Math.floor(Date.now() / 1000);
    const resync = () => client.db(`zepp${dbName - 1}`).collection("zeppConnections").updateMany({}, { $set: { lastSyncAt: null } });
    const subscribe = (agent: ReturnType<typeof request.agent>, endpoint: string) =>
      agent.post("/api/push/subscribe").send({ endpoint, keys: { p256dh: "p256dh-de-prueba-123", auth: "auth-de-prueba-1" } });

    zepp.add("-1", now - 3 * 86400, 99.5);
    zepp.add("111", now - 2 * 86400, 61.2);
    const caliche = await signUp("caliche");
    await caliche.put("/api/me/profile").send({ sex: "male", birthDate: "1996-01-01", heightCm: 185, language: "es", unit: "kg" });
    expect((await subscribe(caliche, "https://push.example/caliche")).status).toBe(204);
    await connect(caliche);
    expect(push.sent).toEqual([]); // the first import is history, not news

    const invite = await caliche.post("/api/zepp/members/111/invite");
    const ana = await signUp("ana");
    await ana.put("/api/me/profile").send({ sex: "female", birthDate: "1995-05-05", heightCm: 162, language: "en", unit: "lb" });
    await ana.post("/api/zepp/join").send({ code: invite.body.code });
    await subscribe(ana, "https://push.example/ana");

    zepp.add("111", now - 60, 60.8);
    await resync();
    await ana.post("/api/zepp/sync");
    // In Ana's language and unit, with the change since her previous weigh-in.
    expect(push.sent).toEqual([{ endpoint: "https://push.example/ana", body: "New weigh-in: 134.0 lb (\u22120.9 lb)", url: "/" }]);

    // Turning the kind off stops it.
    await ana.put("/api/me/notifications").send({ newWeighIn: false, zepp: true });
    zepp.add("111", now - 30, 60.5);
    await resync();
    await ana.post("/api/zepp/sync");
    expect(push.sent).toHaveLength(1);

    // The token expires: the owner hears once, not on every failed sync.
    zepp.members = async () => {
      throw new ZeppError("invalid-token", "expired");
    };
    await resync();
    await caliche.post("/api/zepp/sync");
    await resync();
    await caliche.post("/api/zepp/sync");
    expect(push.sent.slice(1)).toEqual([
      { endpoint: "https://push.example/caliche", body: "Tu token de Zepp caducó. Pega uno nuevo en Ajustes para seguir recibiendo tus pesadas.", url: "/ajustes" },
    ]);
  });

  it("tells the person once when a weigh-in reaches a goal, and when the weight leaves the maintenance range", async () => {
    const gaby = await signUp("gaby");
    await gaby.put("/api/me/profile").send({ sex: "female", birthDate: "1995-05-05", heightCm: 165, language: "es", unit: "kg" });
    await gaby.post("/api/push/subscribe").send({ endpoint: "https://push.example/gaby", keys: { p256dh: "p256dh-de-prueba-123", auth: "auth-de-prueba-1" } });
    await gaby.post("/api/measurements").send({ weight: 80, measuredAt: new Date(Date.now() - 86_400_000).toISOString() });
    await gaby.put("/api/me/goals").send({ weight: { value: 78, unit: "kg" }, bodyFatPct: null });

    await gaby.post("/api/measurements").send({ weight: 78.5 });
    expect(push.sent).toEqual([]);
    await gaby.post("/api/measurements").send({ weight: 77.9 });
    expect(push.sent).toEqual([{ endpoint: "https://push.example/gaby", body: "¡Llegaste a tu meta de 78.0 kg! Te tomó menos de un día. 💚", url: "/" }]);
    const me = (await gaby.get("/api/me")).body;
    expect(me.goals.weight.reachedAt).toEqual(expect.any(String));
    // The history keeps it after the goal is replaced, so the badge stays.
    expect(me.goalHistory).toEqual([{ kind: "weight", target: 78, setAt: me.goals.weight.setAt, reachedAt: me.goals.weight.reachedAt }]);
    // Reached once: further weigh-ins under the target do not repeat it.
    await gaby.post("/api/measurements").send({ weight: 77.5 });
    expect(push.sent).toHaveLength(1);

    // A weight target and maintenance are alternatives.
    const conflict = await gaby.put("/api/me/goals").send({ weight: { value: 75, unit: "kg" }, bodyFatPct: null, maintain: { value: 77.5, unit: "kg" } });
    expect(conflict.status).toBe(400);
    expect(conflict.body.fields).toEqual([{ path: "maintain", code: "goal-conflict" }]);

    const maintain = await gaby.put("/api/me/goals").send({ weight: null, bodyFatPct: null, maintain: { value: 77.5, unit: "kg" } });
    expect(maintain.body.goals).toMatchObject({ weight: null, maintain: { centerKg: 77.5, outside: null } });
    expect(maintain.body.goals.maintain.minKg).toBeCloseTo(75.175, 3);
    expect(maintain.body.goals.maintain.maxKg).toBeCloseTo(79.825, 3);

    await gaby.post("/api/measurements").send({ weight: 80.2 });
    expect(push.sent[1]).toEqual({
      endpoint: "https://push.example/gaby",
      body: "Tu peso (80.2 kg) quedó arriba de tu rango para mantener (75.2 kg a 79.8 kg).",
      url: "/",
    });
    // Still above: no repeat. Back inside: quiet, and the state clears for the next exit.
    await gaby.post("/api/measurements").send({ weight: 80.5 });
    await gaby.post("/api/measurements").send({ weight: 78 });
    expect(push.sent).toHaveLength(2);
    expect((await gaby.get("/api/me")).body.goals.maintain.outside).toBeNull();

    expect((await gaby.get("/api/me")).body.goalHistory).toHaveLength(1);
    // A goals form that does not send maintenance keeps it.
    expect((await gaby.put("/api/me/goals").send({ weight: null, bodyFatPct: 28 })).body.goals.maintain.centerKg).toBe(77.5);
  });

  it("sends a test notification and forgets devices that unsubscribed", async () => {
    const caliche = await signUp("caliche");
    expect((await request(app).get("/api/push/key")).body).toEqual({ publicKey: "test-public-key" });
    await caliche.post("/api/push/subscribe").send({ endpoint: "https://push.example/a", keys: { p256dh: "p256dh-de-prueba-123", auth: "auth-de-prueba-1" } });
    await caliche.post("/api/push/subscribe").send({ endpoint: "https://push.example/b", keys: { p256dh: "p256dh-de-prueba-123", auth: "auth-de-prueba-1" } });
    push.gone.add("https://push.example/b");

    expect((await caliche.post("/api/push/test")).body).toEqual({ sent: 1 });
    expect(await client.db(`zepp${dbName - 1}`).collection("pushSubscriptions").countDocuments()).toBe(1);

    await caliche.delete("/api/push/subscribe").send({ endpoint: "https://push.example/a" });
    expect((await caliche.post("/api/push/test")).body).toEqual({ sent: 0 });
  });
});
