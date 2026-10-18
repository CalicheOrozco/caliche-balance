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

/** Fixed-window counter in MongoDB, so the limit holds across serverless instances. */
export async function hitRateLimit(c: Collections, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const doc = await c.rateLimits.findOneAndUpdate(
    { _id: key, expiresAt: { $gt: now } },
    { $inc: { count: 1 } },
    { returnDocument: "after" },
  );
  if (doc) return doc.count > limit;
  await c.rateLimits.updateOne(
    { _id: key },
    { $set: { count: 1, expiresAt: new Date(now.getTime() + windowMs) } },
    { upsert: true },
  );
  return false;
}

export const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);
