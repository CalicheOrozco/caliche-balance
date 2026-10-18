import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { collections, ensureIndexes } from "../server/db.ts";
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
  app = createApp({ getCollections: async () => c, secureCookies: false, zepp, cronSecret: "cron-secreto" });
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
});
