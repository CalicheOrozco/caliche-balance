import type { ObjectId } from "mongodb";
import { type Achievements, achievements, type BadgeId, levelsOf } from "../shared/achievements.ts";
import type { Collections, UserDoc } from "./db.ts";
import { toMeasurementDto } from "./http.ts";
import { messages, notifyUser, type PushSender } from "./push.ts";

/** Until the app reports the person's time zone, days are counted in UTC. */
export const DEFAULT_TIME_ZONE = "UTC";

/** Badges and challenges from the whole history, which can be longer than what the app loads. */
export async function achievementsFor(c: Collections, user: UserDoc, now = Date.now()): Promise<Achievements | null> {
  if (!user.profile) return null;
  const measurements = await c.measurements.find({ userId: user._id }).sort({ measuredAt: 1 }).toArray();
  return achievements({
    profile: user.profile,
    measurements: measurements.map(toMeasurementDto),
    goalHistory: (user.goalHistory ?? []).map((h) => ({ ...h, setAt: h.setAt.toISOString(), reachedAt: h.reachedAt.toISOString() })),
    timeZone: user.timeZone ?? DEFAULT_TIME_ZONE,
    now,
  });
}

/**
 * After new weigh-ins: tells the person which badges went up a level. The first time it runs for
 * an account it only records the levels, so a long history does not arrive as a burst of alerts.
 * The write only succeeds if the stored levels are still the ones read, so two syncs at once
 * cannot both notify. Never throws: it must not break a sync.
 */
export async function checkAchievements(c: Collections, push: PushSender | undefined, userId: ObjectId): Promise<{ id: BadgeId; level: number; count: number }[]> {
  try {
    const user = await c.users.findOne({ _id: userId });
    if (!user) return [];
    const a = await achievementsFor(c, user);
    if (!a) return [];
    const levels = levelsOf(a);
    const before = user.badgeLevels;
    const filter = before === undefined ? { _id: userId, badgeLevels: { $exists: false } } : { _id: userId, badgeLevels: before };
    const written = await c.users.updateOne(filter, { $set: { badgeLevels: levels } });
    if (before === undefined || written.modifiedCount !== 1) return [];
    const ups = a.badges.filter((b) => b.level > (before[b.id] ?? 0)).map((b) => ({ id: b.id, level: b.level, count: b.dates.length }));
    // A reached goal already has its own notification; the goal badge is not announced twice.
    const announce = ups.filter((u) => u.id !== "goal");
    if (announce.length > 0) await notifyUser(c, push, userId, "goals", (lang) => messages.badges(lang, announce));
    return ups;
  } catch (error) {
    console.error("checkAchievements failed", (error as Error).message);
    return [];
  }
}
