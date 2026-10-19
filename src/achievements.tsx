import { useMemo, useState } from "react";
import type { IconType } from "react-icons";
import {
  FiActivity,
  FiAward,
  FiBarChart2,
  FiCalendar,
  FiCheck,
  FiCheckCircle,
  FiCheckSquare,
  FiFlag,
  FiHeart,
  FiPieChart,
  FiRepeat,
  FiStar,
  FiTarget,
  FiTrendingDown,
  FiUser,
  FiZap,
} from "react-icons/fi";
import { Link } from "react-router";
import { type Achievements, achievements, type BadgeId, type ChallengeStatus } from "../shared/achievements.ts";
import type { GoalHistoryEntry, MeasurementDto, ProfileDto } from "../shared/schemas.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Card, useFormat } from "./ui.tsx";

type Tier = "bronze" | "silver" | "gold";

/** Fallback look for each badge until its image exists in public/badges/. */
const LOOK: Record<BadgeId, { Icon: IconType; tier: Tier }> = {
  "first-weigh-in": { Icon: FiFlag, tier: "bronze" },
  "streak-7": { Icon: FiZap, tier: "silver" },
  "streak-30": { Icon: FiZap, tier: "gold" },
  "habit-4": { Icon: FiCalendar, tier: "silver" },
  "habit-12": { Icon: FiCalendar, tier: "gold" },
  "weighins-100": { Icon: FiBarChart2, tier: "gold" },
  "challenge-weeks-4": { Icon: FiCheckSquare, tier: "silver" },
  "challenge-month": { Icon: FiStar, tier: "gold" },
  "loss-5": { Icon: FiTrendingDown, tier: "silver" },
  "loss-10": { Icon: FiTrendingDown, tier: "gold" },
  "fat-down-2": { Icon: FiPieChart, tier: "silver" },
  recomposition: { Icon: FiRepeat, tier: "gold" },
  "healthy-bmi": { Icon: FiUser, tier: "gold" },
  "healthy-fat": { Icon: FiHeart, tier: "gold" },
  "waist-first": { Icon: FiTarget, tier: "bronze" },
  "waist-healthy": { Icon: FiTarget, tier: "gold" },
  "score-60": { Icon: FiAward, tier: "silver" },
  "score-80": { Icon: FiAward, tier: "gold" },
  "goal-1": { Icon: FiCheckCircle, tier: "silver" },
  "goal-3": { Icon: FiActivity, tier: "gold" },
};

const TIER_RING: Record<Tier, string> = {
  bronze: "from-[#c98a4b] to-[#7a4a1f]",
  silver: "from-[#e5e7eb] to-[#8b95a3]",
  gold: "from-[#f6d365] to-[#c8961e]",
};

/** Images that failed to load once are not requested again on this visit. */
const missingImages = new Set<BadgeId>();

/** The badge image from public/badges/<id>.png, or a tiered medal with an icon while it does not exist. */
export function BadgeMedal({ id, earned, size = 72 }: { id: BadgeId; earned: boolean; size?: number }) {
  const [missing, setMissing] = useState(missingImages.has(id));
  const { Icon, tier } = LOOK[id];
  const locked = earned ? "" : "grayscale opacity-40";
  if (!missing) {
    return (
      <img
        src={`/badges/${id}.png`}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 ${locked}`}
        onError={() => {
          missingImages.add(id);
          setMissing(true);
        }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br p-[3px] ${TIER_RING[tier]} ${locked}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-surface text-brand">
        <Icon size={size * 0.42} />
      </span>
    </span>
  );
}

export function useAchievements(profile: ProfileDto, measurements: MeasurementDto[], goalHistory: GoalHistoryEntry[]): Achievements {
  return useMemo(
    () =>
      achievements({
        profile,
        measurements,
        goalHistory,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: Date.now(),
      }),
    [profile, measurements, goalHistory],
  );
}

/** Badges earned since this device last opened the badges page. */
export function useNewBadges(username: string, a: Achievements): { fresh: BadgeId[]; markSeen: () => void } {
  const key = `seen-badges:${username}`;
  const read = (): Set<string> => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  };
  const [seen, setSeen] = useState(read);
  const earned = a.badges.filter((b) => b.earnedAt !== null).map((b) => b.id);
  return {
    fresh: earned.filter((id) => !seen.has(id)),
    markSeen: () => {
      try {
        localStorage.setItem(key, JSON.stringify(earned));
      } catch {
        // Private mode: they show as new again next visit, which is harmless.
      }
      setSeen(new Set(earned));
    },
  };
}

export function ChallengeRow({ c }: { c: ChallengeStatus }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const value = c.id === "month-fat" ? f.number(c.value) : f.number(c.value, 0);
  const target = c.id === "month-fat" ? f.number(c.target) : f.number(c.target, 0);
  const hint = c.id === "week-full-3" ? t("challengeHint.week-full-3") : null;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <p className={`font-medium ${c.done ? "text-good" : "text-ink"}`}>
          {c.done && <FiCheck className="mr-1 inline align-[-2px]" aria-hidden />}
          {t(`challenge.${c.id}` as MessageKey)}
        </p>
        <p className="shrink-0 text-sm text-ink-2">{c.done ? t("challengeDone") : tf("badgeProgress", { value, target })}</p>
      </div>
      <div
        role="progressbar"
        aria-label={t(`challenge.${c.id}` as MessageKey)}
        aria-valuemin={0}
        aria-valuemax={c.target}
        aria-valuenow={c.value}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(Math.min(c.value / c.target, 1) * 100, 2)}%` }} />
      </div>
      {hint && !c.done && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </li>
  );
}

/** Streak, this week's challenges and new badges: the daily reason to step on the scale. */
export function StreakCard({ a, fresh, linkToBadges = true }: { a: Achievements; fresh: BadgeId[]; linkToBadges?: boolean }) {
  const { t, tf } = useI18n();
  const week = a.challenges.filter((c) => c.period === "week");
  const daysLeft = week[0]?.daysLeft ?? 0;
  return (
    <Card>
      <div className="flex items-center gap-4">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${a.streak.current > 0 ? "bg-brand/15 text-brand" : "bg-surface-2 text-muted"}`} aria-hidden>
          <FiZap size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-2">{t("streakTitle")}</p>
          <p className="text-2xl font-bold">{a.streak.current > 0 ? tf("streakDays", { n: a.streak.current }) : t("streakNone")}</p>
          {a.streak.current > 0 && (
            <p className={`text-sm font-medium ${a.streak.weighedToday ? "text-good" : "text-warn"}`}>
              {a.streak.weighedToday ? t("streakToday") : t("streakAlive")}
            </p>
          )}
          {a.streak.best > 0 && <p className="text-sm text-muted">{tf("streakBest", { n: a.streak.best })}</p>}
        </div>
      </div>
      {fresh.length > 0 && (
        <Link to="/logros" className="mt-4 flex items-center gap-3 rounded-2xl bg-brand/15 px-3 py-2.5 font-semibold text-ink">
          <BadgeMedal id={fresh[0]!} earned size={36} />
          {fresh.length === 1 ? tf("newBadge", { name: t(`badge.${fresh[0]}` as MessageKey) }) : tf("newBadges", { n: fresh.length })}
        </Link>
      )}
      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-sm font-semibold">{t("challengePeriod.week")}</p>
        <p className="text-xs text-muted">{daysLeft <= 1 ? t("challengeLastDay") : tf("challengeDaysLeft", { n: daysLeft })}</p>
      </div>
      <ul className="mt-2 space-y-3">
        {week.map((c) => (
          <ChallengeRow key={c.id} c={c} />
        ))}
      </ul>
      {linkToBadges && (
        <Link to="/logros" className="mt-4 flex min-h-11 items-center justify-center rounded-2xl bg-surface-2 px-4 py-2.5 font-medium text-ink">
          {t("seeAchievements")}
        </Link>
      )}
    </Card>
  );
}
