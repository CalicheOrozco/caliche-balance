import type { ObjectId } from "mongodb";
import { bodyFatOf } from "../shared/composition.ts";
import { evaluateGoals, type GoalEvent } from "../shared/goals.ts";
import type { Collections } from "./db.ts";
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
    const write = async (filter: object, set: object) => (await c.users.updateOne({ _id: userId, ...filter }, { $set: set })).modifiedCount === 1;
    if (changes.weightReachedAt && g.weight) {
      if (await write({ "goals.weight.setAt": g.weight.setAt, "goals.weight.reachedAt": null }, { "goals.weight.reachedAt": changes.weightReachedAt })) {
        applied.push(...events.filter((e) => e.kind === "weight-reached"));
      }
    }
    if (changes.fatReachedAt && g.bodyFat) {
      if (await write({ "goals.bodyFat.setAt": g.bodyFat.setAt, "goals.bodyFat.reachedAt": null }, { "goals.bodyFat.reachedAt": changes.fatReachedAt })) {
        applied.push(...events.filter((e) => e.kind === "fat-reached"));
      }
    }
    if (changes.maintainOutside !== undefined && g.maintain) {
      if (await write({ "goals.maintain.setAt": g.maintain.setAt, "goals.maintain.outside": g.maintain.outside }, { "goals.maintain.outside": changes.maintainOutside })) {
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
