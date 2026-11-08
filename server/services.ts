import { ObjectId } from "mongodb";
import { bodyFatOf } from "../shared/composition.ts";
import { maintainRange } from "../shared/goals.ts";
import type { LabStudyInput } from "../shared/labs.ts";
import { type GoalsInput, goalsInputSchema, measurementInputSchema, type MeasurementInput, toKilograms, waistToCm } from "../shared/schemas.ts";
import type { HealthDayInput } from "../shared/health.ts";
import { checkAchievements } from "./achievementCheck.ts";
import { hashSecret, newSecret } from "./auth.ts";
import type { Collections, HealthDayDoc, LabStudyDoc, MeasurementDoc, UserDoc } from "./db.ts";
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

/**
 * Saves a lab study; the same study (day and lab) saved again replaces the first copy. With
 * `merge`, the results join that study instead, each one replacing only the same test, so a part
 * done the same day (an electrocardiogram) can come later without losing the rest.
 */
export async function saveLabStudy(c: Collections, userId: ObjectId, input: LabStudyInput, options: { merge?: boolean } = {}): Promise<LabStudyDoc> {
  let results = input.results;
  if (options.merge) {
    const existing = await c.labStudies.findOne({ userId, takenAt: input.takenAt, lab: input.lab });
    const added = new Set(results.map((r) => r.key));
    results = [...(existing?.results ?? []).filter((r) => !added.has(r.key)), ...results];
  }
  const saved = await c.labStudies.findOneAndUpdate(
    { userId, takenAt: input.takenAt, lab: input.lab },
    { $set: { results }, $setOnInsert: { _id: new ObjectId(), userId, takenAt: input.takenAt, lab: input.lab, createdAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
  return saved!;
}

/**
 * Saves days of Apple Health data, from the Shortcut or from Claude. Only what was sent is written,
 * so separate sends can each bring their own part of a day; a day sent twice keeps the newer value.
 * Returns the days as they are now and how many values each one got. Badges are checked after.
 */
export async function saveHealthDays(
  c: Collections,
  push: PushSender | undefined,
  userId: ObjectId,
  days: (HealthDayInput & { date: string })[],
): Promise<{ docs: HealthDayDoc[]; counts: { date: string; count: number }[] }> {
  const now = new Date();
  // One write per day, merging every part of it that came in this send.
  const byDate = new Map<string, { set: Record<string, unknown>; count: number }>();
  for (const day of days) {
    const entry = byDate.get(day.date) ?? { set: { updatedAt: now }, count: 0 };
    Object.assign(entry.set, day.values);
    if (day.sleep !== undefined) entry.set.sleep = day.sleep;
    for (const [symptom, value] of Object.entries(day.symptoms)) entry.set[`symptoms.${symptom}`] = value;
    entry.count += Object.values(day.values).filter((v) => v !== null).length + (day.sleep ? 1 : 0) + Object.keys(day.symptoms).length;
    byDate.set(day.date, entry);
  }
  if (byDate.size > 0) {
    await c.healthDays.bulkWrite(
      [...byDate].map(([date, { set }]) => ({
        updateOne: { filter: { userId, date }, update: { $set: set, $setOnInsert: { _id: new ObjectId(), userId, date } }, upsert: true },
      })),
      { ordered: false },
    );
  }
  const docs = await c.healthDays.find({ userId, date: { $in: [...byDate.keys()] } }).sort({ date: 1 }).toArray();
  // New days can move activity badges up; never throws.
  await checkAchievements(c, push, userId);
  return { docs, counts: [...byDate].map(([date, { count }]) => ({ date, count })) };
}

/**
 * Days brought in by Claude count as Apple Health being connected, so Activity shows them. An
 * account that never made a Shortcut key gets one nobody knows; making a key in Settings replaces it.
 */
export async function markHealthImported(c: Collections, user: UserDoc): Promise<void> {
  const now = new Date();
  if (user.appleHealth) {
    await c.users.updateOne({ _id: user._id }, { $set: { "appleHealth.lastSyncAt": now } });
  } else {
    await c.users.updateOne({ _id: user._id }, { $set: { appleHealth: { keyHash: hashSecret(newSecret()), since: now, lastSyncAt: now } } });
  }
}
