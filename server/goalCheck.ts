import type { ObjectId, UpdateFilter } from "mongodb";
import { bodyFatOf } from "../shared/composition.ts";
import { evaluateGoals, type GoalEvent } from "../shared/goals.ts";
import type { Collections, UserDoc } from "./db.ts";
import { messages, notifyUser, type PushSender } from "./push.ts";

/**
 * After new weigh-ins arrive: records goals reached and changes of the maintenance range, and tells
 * the person. Each change is written only if the goal is still in the state it was read in, so two
 * syncs running at once cannot both notify. Never throws: a goal check must not break a sync.
 */
export async function checkGoals(c: Collections, push: PushSender | undefined, userId: ObjectId): Promise<GoalEvent[]> {
  try {
    const user = await c.users.findOne({ _id: userId });
    const g = user?.goals;
    if (!user?.profile || !g) return [];
    const latest = await c.measurements.findOne({ userId }, { sort: { measuredAt: -1 } });
    const withFat = await c.measurements.findOne(
      { userId, $or: [{ bodyFatPct: { $ne: null } }, { impedance: { $ne: null } }] },
      { sort: { measuredAt: -1 } },
    );
    const fat = withFat ? bodyFatOf(user.profile, withFat) : null;
    const { changes, events } = evaluateGoals(
      {
        weight: g.weight ? { ...g.weight, reachedAt: g.weight.reachedAt ?? null } : null,
        bodyFat: g.bodyFat ? { ...g.bodyFat, reachedAt: g.bodyFat.reachedAt ?? null } : null,
        maintain: g.maintain ?? null,
      },
      latest ? { kg: latest.weightKg, at: latest.measuredAt } : null,
      fat && withFat ? { pct: fat.value, at: withFat.measuredAt } : null,
    );

    const applied: GoalEvent[] = [];
    const write = async (filter: object, update: UpdateFilter<UserDoc>) => (await c.users.updateOne({ _id: userId, ...filter }, update)).modifiedCount === 1;
    // A reached goal also goes to the history, in the same write, so badges outlive the goal.
    if (changes.weightReachedAt && g.weight) {
      const entry = { kind: "weight" as const, target: g.weight.targetKg, setAt: g.weight.setAt, reachedAt: changes.weightReachedAt };
      if (
        await write(
          { "goals.weight.setAt": g.weight.setAt, "goals.weight.reachedAt": null },
          { $set: { "goals.weight.reachedAt": changes.weightReachedAt }, $push: { goalHistory: entry } },
        )
      ) {
        applied.push(...events.filter((e) => e.kind === "weight-reached"));
      }
    }
    if (changes.fatReachedAt && g.bodyFat) {
      const entry = { kind: "bodyFat" as const, target: g.bodyFat.targetPct, setAt: g.bodyFat.setAt, reachedAt: changes.fatReachedAt };
      if (
        await write(
          { "goals.bodyFat.setAt": g.bodyFat.setAt, "goals.bodyFat.reachedAt": null },
          { $set: { "goals.bodyFat.reachedAt": changes.fatReachedAt }, $push: { goalHistory: entry } },
        )
      ) {
        applied.push(...events.filter((e) => e.kind === "fat-reached"));
      }
    }
    if (changes.maintainOutside !== undefined && g.maintain) {
      if (
        await write(
          { "goals.maintain.setAt": g.maintain.setAt, "goals.maintain.outside": g.maintain.outside },
          { $set: { "goals.maintain.outside": changes.maintainOutside } },
        )
      ) {
        applied.push(...events.filter((e) => e.kind === "maintain-left"));
      }
    }
    for (const event of applied) await notifyUser(c, push, userId, "goals", (lang, unit) => messages.goal(lang, unit, event));
    return applied;
  } catch (error) {
    console.error("checkGoals failed", (error as Error).message);
    return [];
  }
}
