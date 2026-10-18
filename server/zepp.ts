import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Client for the unofficial Zepp Life cloud API (the one the app itself uses), as found in
 * github.com/kubulashvili/zepp-life-mcp and confirmed against a real account. It is not
 * documented by Zepp and can change without notice; every response is parsed defensively.
 */

const API = "https://api-mifit.zepp.com";
const PAGE_SIZE = 200;
const TIMEOUT_MS = 20_000;

export class ZeppError extends Error {
  constructor(
    readonly code: "invalid-token" | "unavailable" | "unexpected-response",
    message: string,
  ) {
    super(message);
  }
}

const memberSchema = z.object({
  memberId: z.coerce.string(),
  nickname: z.string().nullish(),
  gender: z.coerce.number().nullish(),
  birthday: z.string().nullish(),
  height: z.coerce.number().nullish(),
});

const num = z.coerce.number().finite().nullish().catch(null);

/** One reading. Every body value is optional: weight-only readings (no bare feet) omit them. */
const recordSchema = z.object({
  memberId: z.coerce.string(),
  generatedTime: z.coerce.number().int().positive(),
  summary: z.object({
    weight: z.coerce.number().positive(),
    fatRate: num,
    bodyWaterRate: num,
    boneMass: num,
    muscleRate: num,
    proteinRatio: num,
    visceralFat: num,
    metabolism: num,
    muscleAge: num,
    bodyScore: num,
    impedance: num,
    standBodyWeight: num,
  }),
});

export type ZeppMember = z.infer<typeof memberSchema>;
export type ZeppRecord = z.infer<typeof recordSchema>;

export interface ZeppClient {
  members(token: string, zeppUserId: string): Promise<ZeppMember[]>;
  /** Newest first; stops once records are at or before `since` (unix seconds). */
  records(token: string, zeppUserId: string, memberId: string, since: number): Promise<ZeppRecord[]>;
}

async function getJson(url: string, token: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { apptoken: token, appPlatform: "web", appname: "com.xiaomi.hm.health" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ZeppError("unavailable", `Zepp did not respond: ${(error as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new ZeppError("invalid-token", `Zepp rejected the token (${res.status})`);
  if (!res.ok) throw new ZeppError("unavailable", `Zepp answered ${res.status}`);
  return res.json().catch(() => {
    throw new ZeppError("unexpected-response", "Zepp answered with something that is not JSON");
  });
}

const listSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(z.unknown()), next: z.coerce.number().nullish() }).transform((page) => ({
    // Skip individual malformed items instead of failing the whole page.
    items: page.items.flatMap((raw) => {
      const parsed = item.safeParse(raw);
      return parsed.success ? [parsed.data as z.infer<T>] : [];
    }),
    next: page.next ?? null,
  }));

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new ZeppError("unexpected-response", "Zepp changed the shape of its response");
  return result.data;
}

export const zeppClient: ZeppClient = {
  async members(token, zeppUserId) {
    const data = await getJson(`${API}/users/${encodeURIComponent(zeppUserId)}/members`, token);
    return parse(listSchema(memberSchema), data).items;
  },

  async records(token, zeppUserId, memberId, since) {
    const all: ZeppRecord[] = [];
    let toTime: number | null = null;
    const seen = new Set<number>();
    // A page's `next` is the time of the next older record; passing it as toTime returns that
    // page, including the record itself, so duplicates are skipped by time.
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (toTime !== null) query.set("toTime", String(toTime));
      const url = `${API}/users/${encodeURIComponent(zeppUserId)}/members/${encodeURIComponent(memberId)}/weightRecords?${query}`;
      const { items, next } = parse(listSchema(recordSchema), await getJson(url, token));
      let reachedKnown = false;
      for (const record of items) {
        if (record.generatedTime <= since) {
          reachedKnown = true;
          continue;
        }
        if (!seen.has(record.generatedTime)) {
          seen.add(record.generatedTime);
          all.push(record);
        }
      }
      if (reachedKnown || !next || next === toTime) break;
      toTime = next;
    }
    return all;
  },
};

/**
 * The Zepp token gives access to a whole Zepp account, so it is stored encrypted with
 * AES-256-GCM. The key (32 bytes, base64) lives only in the server environment.
 */
function key(): Buffer {
  const raw = process.env.ZEPP_TOKEN_KEY;
  const buf = raw ? Buffer.from(raw, "base64") : null;
  if (!buf || buf.length !== 32) throw new Error("ZEPP_TOKEN_KEY must be 32 bytes in base64");
  return buf;
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(stored: string): string {
  const [iv, tag, data] = stored.split(".").map((part) => Buffer.from(part, "base64"));
  if (!iv || !tag || !data) throw new Error("Stored Zepp token is malformed");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
