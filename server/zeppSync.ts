import { type AnyBulkWriteOperation, MongoBulkWriteError, ObjectId } from "mongodb";
import type { Collections, MeasurementDoc, ZeppConnectionDoc } from "./db.ts";
import { checkGoals } from "./goalCheck.ts";
import { messages, notifyUser, type PushSender } from "./push.ts";
import { type ZeppClient, ZeppError, type ZeppRecord, decryptToken } from "./zepp.ts";

export interface SyncResult {
  imported: number;
  status: ZeppConnectionDoc["status"];
}

const orNull = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? null : n);

/** Maps Zepp's field names to ours; weight-only readings leave the body values null. */
function values(record: ZeppRecord) {
  const s = record.summary;
  return {
    weightKg: s.weight,
    bodyFatPct: orNull(s.fatRate),
    muscleKg: orNull(s.muscleRate),
    waterPct: orNull(s.bodyWaterRate),
    boneKg: orNull(s.boneMass),
    visceralFat: orNull(s.visceralFat),
    proteinPct: orNull(s.proteinRatio),
    bmrKcal: orNull(s.metabolism),
    bodyAge: orNull(s.muscleAge),
    bodyScore: orNull(s.bodyScore),
    impedance: orNull(s.impedance),
    idealWeightKg: orNull(s.standBodyWeight),
  };
}

export function zeppKey(zeppUserId: string, memberId: string, generatedTime: number): string {
  return `${zeppUserId}:${memberId}:${generatedTime}`;
}

/**
 * Imports new readings for every member of one household connection. Each reading is keyed by
 * Zepp's identity, so re-syncing updates values but never moves a reading someone reassigned.
 */
/** Only readings this recent are announced; older ones arriving late are history, not news. */
const ANNOUNCE_WITHIN_MS = 48 * 60 * 60 * 1000;

export async function syncConnection(
  c: Collections,
  zepp: ZeppClient,
  connection: ZeppConnectionDoc,
  push?: PushSender,
): Promise<SyncResult> {
  let imported = 0;
  try {
    const token = decryptToken(connection.tokenEncrypted);
    const members = await zepp.members(token, connection.zeppUserId);

    for (const m of members) {
      await c.zeppMembers.updateOne(
        { connectionId: connection._id, memberId: m.memberId },
        {
          $set: { nickname: m.nickname?.trim() || null },
          $setOnInsert: {
            _id: new ObjectId(),
            linkedUserId: null,
            inviteCodeHash: null,
            inviteExpiresAt: null,
            syncedUntil: 0,
          },
        },
        { upsert: true },
      );
    }
    // The Zepp account holder is the person who connected it.
    await c.zeppMembers
      .updateOne({ connectionId: connection._id, memberId: "-1", linkedUserId: null }, { $set: { linkedUserId: connection.ownerUserId } })
      .catch(() => undefined); // Already linked to another household: leave it unlinked.

    const memberDocs = await c.zeppMembers.find({ connectionId: connection._id }).toArray();
    for (const member of memberDocs) {
      const records = await zepp.records(token, connection.zeppUserId, member.memberId, member.syncedUntil);
      if (records.length === 0) continue;

      const ops: AnyBulkWriteOperation<MeasurementDoc>[] = records.map((record) => {
        const measuredAt = new Date(record.generatedTime * 1000);
        return {
          updateOne: {
            filter: { "zepp.key": zeppKey(connection.zeppUserId, member.memberId, record.generatedTime) },
            update: {
              $set: values(record),
              $setOnInsert: {
                _id: new ObjectId(),
                userId: member.linkedUserId,
                measuredAt,
                source: "zepp" as const,
                zepp: {
                  connectionId: connection._id,
                  memberId: member.memberId,
                  key: zeppKey(connection.zeppUserId, member.memberId, record.generatedTime),
                },
                createdAt: new Date(),
              },
            },
            upsert: true,
          },
        };
      });
      let insertedIndexes: number[] = [];
      try {
        const result = await c.measurements.bulkWrite(ops, { ordered: false });
        imported += result.upsertedCount;
        insertedIndexes = Object.keys(result.upsertedIds).map(Number);
      } catch (error) {
        // A reading at the exact second of an existing one for the same person is skipped.
        if (!(error instanceof MongoBulkWriteError)) throw error;
        imported += error.result.upsertedCount;
        insertedIndexes = Object.keys(error.result.upsertedIds).map(Number);
      }

      // Announce the newest new reading, except on the first import (that is history, not news).
      const fresh = insertedIndexes
        .map((i) => records[i]!)
        .filter((r) => Date.now() - r.generatedTime * 1000 <= ANNOUNCE_WITHIN_MS)
        .sort((a, b) => b.generatedTime - a.generatedTime)[0];
      if (push && fresh && member.linkedUserId && member.syncedUntil > 0) {
        const measuredAt = new Date(fresh.generatedTime * 1000);
        const previous = await c.measurements.findOne(
          { userId: member.linkedUserId, measuredAt: { $lt: measuredAt } },
          { sort: { measuredAt: -1 } },
        );
        const weightKg = fresh.summary.weight;
        await notifyUser(c, push, member.linkedUserId, "newWeighIn", (lang, unit) =>
          messages.newWeighIn(lang, unit, weightKg, previous ? weightKg - previous.weightKg : null),
        );
      }

      if (insertedIndexes.length > 0 && member.linkedUserId) await checkGoals(c, push, member.linkedUserId);

      const newest = Math.max(...records.map((r) => r.generatedTime));
      await c.zeppMembers.updateOne({ _id: member._id }, { $max: { syncedUntil: newest } });
    }

    await c.zeppConnections.updateOne({ _id: connection._id }, { $set: { status: "ok", lastError: null, lastSyncAt: new Date() } });
    return { imported, status: "ok" };
  } catch (error) {
    const status = error instanceof ZeppError && error.code === "invalid-token" ? "invalid-token" : "error";
    // Tell the owner once, when the token stops working, not on every failed sync.
    if (status === "invalid-token" && connection.status !== "invalid-token") {
      await notifyUser(c, push, connection.ownerUserId, "zepp", messages.zeppExpired);
    }
    await c.zeppConnections.updateOne(
      { _id: connection._id },
      { $set: { status, lastError: (error as Error).message.slice(0, 300), lastSyncAt: new Date() } },
    );
    return { imported, status };
  }
}
