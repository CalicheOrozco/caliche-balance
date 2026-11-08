import { ObjectId } from "mongodb";
import { bodyFatOf } from "../shared/composition.ts";
import { maintainRange } from "../shared/goals.ts";
import type { LabStudyInput } from "../shared/labs.ts";
import { type GoalsInput, goalsInputSchema, measurementInputSchema, type MeasurementInput, toKilograms, waistToCm } from "../shared/schemas.ts";
import { checkAchievements } from "./achievementCheck.ts";
import type { Collections, LabStudyDoc, MeasurementDoc, UserDoc } from "./db.ts";
import { checkGoals } from "./goalCheck.ts";
import type { PushSender } from "./push.ts";

/*
 * What the app does when data is saved, shared by the HTTP API (server/app.ts) and the MCP
 * server (server/mcp), so a weigh-in or a goal saved from Claude behaves exactly like one saved
 * in the app: the same validation, the same goal and badge checks.
 */

/** Saves a weigh-in typed by hand (an existing one at the same instant is replaced) and checks goals and badges. */
export async function createMeasurement(c: Collections, push: PushSender | undefined, userId: ObjectId, raw: MeasurementInput): Promise<MeasurementDoc> {
  const input = measurementInputSchema.parse(raw);
  const measuredAt = input.measuredAt ? new Date(input.measuredAt) : new Date();
  const values = {
    weightKg: toKilograms(input.weight, input.weightUnit),
    bodyFatPct: input.bodyFatPct ?? null,
    muscleKg: input.muscleKg ?? null,
    waterPct: input.waterPct ?? null,
    boneKg: input.boneKg ?? null,
    visceralFat: input.visceralFat ?? null,
    waistCm: input.waist == null ? null : Math.round(waistToCm(input.waist, input.waistUnit) * 10) / 10,
    source: "manual" as const,
  };
  const saved = await c.measurements.findOneAndUpdate(
    { userId, measuredAt },
    { $set: values, $setOnInsert: { _id: new ObjectId(), userId, measuredAt, createdAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
  // Goals first: a goal reached in this weigh-in also counts for the goal badge.
  await checkGoals(c, push, userId);
  await checkAchievements(c, push, userId);
  return saved!;
}

/** Adds, changes or removes (null) the waist of one of the person's weigh-ins; null when it is not theirs. */
export async function setWaist(c: Collections, userId: ObjectId, id: ObjectId, waistCm: number | null): Promise<MeasurementDoc | null> {
  // Zepp re-syncs only touch Zepp's own fields, so a waist added here stays.
  return c.measurements.findOneAndUpdate({ _id: id, userId }, { $set: { waistCm } }, { returnDocument: "after" });
}

/** Adds, changes or removes (null or empty) the note of one of the person's weigh-ins; null when it is not theirs. */
export async function setNote(c: Collections, userId: ObjectId, id: ObjectId, note: string | null): Promise<MeasurementDoc | null> {
  return c.measurements.findOneAndUpdate({ _id: id, userId }, { $set: { note: note ? note : null } }, { returnDocument: "after" });
}

/** Sets the weight, body fat and maintain goals, keeping the starting point of a target that did not change. */
export async function saveGoals(c: Collections, user: UserDoc, raw: GoalsInput): Promise<NonNullable<UserDoc["goals"]>> {
  const input = goalsInputSchema.parse(raw);
  const previous = user.goals;
  // The starting point is the latest reading when the goal is set; an unchanged target keeps it.
  const latest = await c.measurements.findOne({ userId: user._id }, { sort: { measuredAt: -1 } });
  const latestFat = await c.measurements.findOne({ userId: user._id, bodyFatPct: { $ne: null } }, { sort: { measuredAt: -1 } });
  // Same body fat the app shows: recalculated from impedance when the reading has it.
  const startFat = latestFat && user.profile ? (bodyFatOf(user.profile, latestFat)?.value ?? null) : (latestFat?.bodyFatPct ?? null);
  const targetKg = input.weight ? Math.round(toKilograms(input.weight.value, input.weight.unit) * 100) / 100 : null;
  const centerKg = input.maintain ? Math.round(toKilograms(input.maintain.value, input.maintain.unit) * 100) / 100 : null;
  const goals: NonNullable<UserDoc["goals"]> = {
    weight:
      targetKg === null
        ? null
        : previous?.weight && Math.abs(previous.weight.targetKg - targetKg) < 0.01
          ? previous.weight
          : { targetKg, startKg: latest?.weightKg ?? null, setAt: new Date(), reachedAt: null },
    bodyFat:
      input.bodyFatPct === null
        ? null
        : previous?.bodyFat && previous.bodyFat.targetPct === input.bodyFatPct
          ? previous.bodyFat
          : { targetPct: input.bodyFatPct, startPct: startFat, setAt: new Date(), reachedAt: null },
    // Left out keeps the current one, unless a weight target replaces it (they are alternatives).
    maintain:
      input.maintain === undefined
        ? targetKg === null
          ? (previous?.maintain ?? null)
          : null
        : centerKg === null
          ? null
          : previous?.maintain && Math.abs(previous.maintain.centerKg - centerKg) < 0.01
            ? previous.maintain
            : { centerKg, ...maintainRange(centerKg), setAt: new Date(), outside: null },
  };
  await c.users.updateOne({ _id: user._id }, { $set: { goals } });
  return goals;
}

/** Saves a lab study; the same study (day and lab) saved again replaces the first copy. */
export async function saveLabStudy(c: Collections, userId: ObjectId, input: LabStudyInput): Promise<LabStudyDoc> {
  const saved = await c.labStudies.findOneAndUpdate(
    { userId, takenAt: input.takenAt, lab: input.lab },
    { $set: { results: input.results }, $setOnInsert: { _id: new ObjectId(), userId, takenAt: input.takenAt, lab: input.lab, createdAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
  return saved!;
}
