import type { ObjectId } from "mongodb";
import { type Achievements, achievements, type BadgeId, type HealthDayFacts, levelsOf, localDay } from "../shared/achievements.ts";

/** The Apple Health values the badges read. */
const HEALTH_FACT_KEYS = ["steps", "distanceKm", "flightsClimbed", "standMin", "exerciseMin", "activeKcal", "restingHr", "hrvMs", "bloodOxygenPct"] as const;
import type { Collections, UserDoc } from "./db.ts";
import { toMeasurementDto } from "./http.ts";
import { messages, notifyUser, type PushSender } from "./push.ts";

/** Until the app reports the person's time zone, days are counted in UTC. */
export const DEFAULT_TIME_ZONE = "UTC";

/** Badges and challenges from the whole history (weigh-ins and Apple Health days), which can be longer than what the app loads. */
export async function achievementsFor(c: Collections, user: UserDoc, now = Date.now()): Promise<Achievements | null> {
  if (!user.profile) return null;
  const measurements = await c.measurements.find({ userId: user._id }).sort({ measuredAt: 1 }).toArray();
  const healthDays = await c.healthDays
    .find(
      { userId: user._id },
      {
        projection: {
          date: 1,
          ...Object.fromEntries(HEALTH_FACT_KEYS.map((k) => [k, 1])),
          "sleep.asleepMin": 1,
          "sleep.deepMin": 1,
          "sleep.awakenings": 1,
          "sleep.start": 1,
        },
      },
    )
    .toArray();
  return achievements({
    profile: user.profile,
    measurements: measurements.map(toMeasurementDto),
    goalHistory: (user.goalHistory ?? []).map((h) => ({ ...h, setAt: h.setAt.toISOString(), reachedAt: h.reachedAt.toISOString() })),
    healthDays: healthDays.map((d) => ({
      date: d.date,
      ...(Object.fromEntries(HEALTH_FACT_KEYS.map((k) => [k, d[k] ?? null])) as Pick<HealthDayFacts, (typeof HEALTH_FACT_KEYS)[number]>),
      sleep: d.sleep ? { asleepMin: d.sleep.asleepMin, deepMin: d.sleep.deepMin ?? null, awakenings: d.sleep.awakenings ?? 0, start: d.sleep.start } : null,
    })),
    timeZone: user.timeZone ?? DEFAULT_TIME_ZONE,
    now,
  });
}

export type StreakNudge = "close" | "tie" | "record";

/** What to say about the record after today's weigh-in: 2 days away, tied, or beaten. */
export function streakNudge(current: number, bestBefore: number): StreakNudge | null {
  if (bestBefore < 3) return null; // short streaks are not records worth announcing
  if (current === bestBefore + 1) return "record";
  if (current === bestBefore) return "tie";
  if (current === bestBefore - 2) return "close";
  return null;
}

/**
 * After new weigh-ins or Apple Health days: badges that went up a level, the personal streak reward, and how the streak
 * compares with the record. Badge levels are only recorded the first time, so a long history does
 * not arrive as a burst of alerts. Each write only succeeds if the stored state is still the one
 * read, so two syncs at once cannot both notify. Never throws: it must not break a sync.
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
    const ups =
      before === undefined || written.modifiedCount !== 1
        ? []
        : // A badge new to the app is recorded silently the first time, like a first check.
          a.badges.filter((b) => b.id in before && b.level > before[b.id]!).map((b) => ({ id: b.id, level: b.level, count: b.dates.length }));
    // A reached goal already has its own notification; the goal badge is not announced twice.
    const announce = ups.filter((u) => u.id !== "goal");
    if (announce.length > 0) await notifyUser(c, push, userId, "goals", (lang) => messages.badges(lang, announce));

    const reward = user.streakReward;
    if (reward && !reward.earnedAt && a.streak.current >= reward.days) {
      const earned = await c.users.updateOne(
        { _id: userId, "streakReward.setAt": reward.setAt, "streakReward.earnedAt": null },
        { $set: { "streakReward.earnedAt": new Date() } },
      );
      if (earned.modifiedCount === 1) await notifyUser(c, push, userId, "streak", (lang) => messages.rewardEarned(lang, reward.text, reward.days));
    }

    const { current, bestBefore, weighedToday } = a.streak;
    if (weighedToday && current !== user.streakNudged) {
      const nudged = await c.users.updateOne({ _id: userId, streakNudged: user.streakNudged ?? { $exists: false } }, { $set: { streakNudged: current } });
      const kind = streakNudge(current, bestBefore);
      if (nudged.modifiedCount === 1 && kind) await notifyUser(c, push, userId, "streak", (lang) => messages.streakNudge(lang, kind, current, bestBefore));
    }
    return ups;
  } catch (error) {
    console.error("checkAchievements failed", (error as Error).message);
    return [];
  }
}

/** Local evening: late enough that a weigh-in is unlikely to come by itself, early enough to still do it. */
export const REMINDER_HOURS = { from: 17, to: 23 } as const;

/**
 * The evening reminder: for each person with a streak alive who has not weighed in today, once
 * per local day, only during their local evening. Safe to run more than once a day.
 */
export async function remindStreaks(c: Collections, push: PushSender | undefined, now = Date.now()): Promise<number> {
  if (!push) return 0;
  const subscribed = await c.pushSubscriptions.distinct("userId");
  let reminded = 0;
  for (const userId of subscribed) {
    try {
      const user = await c.users.findOne({ _id: userId });
      if (!user?.timeZone || user.notifications?.streak === false) continue;
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: user.timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
      if (hour < REMINDER_HOURS.from || hour >= REMINDER_HOURS.to) continue;
      const day = new Date(localDay(now, user.timeZone) * 86_400_000).toISOString().slice(0, 10);
      if (user.streakReminderDay === day) continue;
      const a = await achievementsFor(c, user, now);
      if (!a || a.streak.current === 0 || a.streak.weighedToday) continue;
      const claimed = await c.users.updateOne({ _id: userId, streakReminderDay: user.streakReminderDay ?? { $exists: false } }, { $set: { streakReminderDay: day } });
      if (claimed.modifiedCount !== 1) continue;
      if ((await notifyUser(c, push, userId, "streak", (lang) => messages.streakReminder(lang, a.streak.current, a.streak.freezes))) > 0) reminded++;
    } catch (error) {
      console.error("streak reminder failed", (error as Error).message);
    }
  }
  return reminded;
}
