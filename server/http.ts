import type { NextFunction, Request, Response } from "express";
import type { MeasurementDto } from "../shared/schemas.ts";
import type { Collections, MeasurementDoc } from "./db.ts";

export function toMeasurementDto(m: MeasurementDoc): MeasurementDto {
  return {
    id: m._id.toHexString(),
    measuredAt: m.measuredAt.toISOString(),
    weightKg: m.weightKg,
    bodyFatPct: m.bodyFatPct,
    muscleKg: m.muscleKg,
    waterPct: m.waterPct,
    boneKg: m.boneKg,
    visceralFat: m.visceralFat,
    proteinPct: m.proteinPct ?? null,
    bmrKcal: m.bmrKcal ?? null,
    bodyAge: m.bodyAge ?? null,
    bodyScore: m.bodyScore ?? null,
    impedance: m.impedance ?? null,
    idealWeightKg: m.idealWeightKg ?? null,
    source: m.source,
  };
}

export function clientIp(req: Request): string {
  return req.ip ?? "unknown";
}

export interface RateLimit {
  limited: boolean;
  /** Attempts left in the current window. */
  remaining: number;
  retryAfterSeconds: number;
}

function toRateLimit(count: number, limit: number, expiresAt: Date): RateLimit {
  return {
    limited: count > limit,
    remaining: Math.max(limit - count, 0),
    retryAfterSeconds: Math.max(Math.ceil((expiresAt.getTime() - Date.now()) / 1000), 1),
  };
}

/** Fixed-window counter in MongoDB, so the limit holds across serverless instances. */
export async function hitRateLimit(c: Collections, key: string, limit: number, windowMs: number): Promise<RateLimit> {
  const now = new Date();
  const doc = await c.rateLimits.findOneAndUpdate(
    { _id: key, expiresAt: { $gt: now } },
    { $inc: { count: 1 } },
    { returnDocument: "after" },
  );
  if (doc) return toRateLimit(doc.count, limit, doc.expiresAt);
  const expiresAt = new Date(now.getTime() + windowMs);
  await c.rateLimits.updateOne({ _id: key }, { $set: { count: 1, expiresAt } }, { upsert: true });
  return toRateLimit(1, limit, expiresAt);
}

/** Reads a counter without counting this request (used where only failures count). */
export async function peekRateLimit(c: Collections, key: string, limit: number): Promise<RateLimit | null> {
  const doc = await c.rateLimits.findOne({ _id: key, expiresAt: { $gt: new Date() } });
  return doc ? toRateLimit(doc.count + 1, limit, doc.expiresAt) : null;
}

export function sendRateLimited(res: Response, limit: RateLimit) {
  res.setHeader("Retry-After", String(limit.retryAfterSeconds));
  return res.status(429).json({ error: "rate-limited", retryAfterSeconds: limit.retryAfterSeconds });
}

export const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);
