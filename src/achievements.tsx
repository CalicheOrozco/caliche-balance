import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import {
  FiActivity,
  FiAward,
  FiCalendar,
  FiCheck,
  FiCheckCircle,
  FiCheckSquare,
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
import { type Achievements, BADGE_NAMES, type BadgeId, type ChallengeStatus, TIER_NAMES, TIERS } from "../shared/achievements.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Card, useFormat } from "./ui.tsx";

/** Icon shown inside the medal until the badge's image exists in public/badges/. */
const ICON: Record<BadgeId, IconType> = {
  "weigh-days": FiCheck,
  "streak-7": FiZap,
  "streak-30": FiZap,
  "habit-week": FiCalendar,
  "challenge-week": FiCheckSquare,
  "challenge-full": FiActivity,
  "challenge-month": FiStar,
  "loss-5": FiTrendingDown,
  "fat-down-2": FiPieChart,
  recomposition: FiRepeat,
  "healthy-bmi": FiUser,
  "healthy-fat": FiHeart,
  "waist-month": FiTarget,
  "waist-healthy": FiTarget,
  "score-60": FiAward,
  "score-80": FiAward,
  goal: FiCheckCircle,
};

/**
 * Each level's look: the outer frame, the center background and the symbol color. The whole medal
 * changes with the level, not just its rim. Level 0 is locked.
 */
const LEVEL_LOOK: { frame: string; center: string; symbol: string; glow?: string }[] = [
  { frame: "bg-[#6b7280]", center: "radial-gradient(circle at 35% 30%, #3a3f46, #23272c)", symbol: "#9ca3af" },
  { frame: "bg-gradient-to-br from-[#e0a46a] to-[#7a4a1f]", center: "radial-gradient(circle at 35% 30%, #a8692f, #4f2d12)", symbol: "#ffe1c2" },
  { frame: "bg-gradient-to-br from-[#f7f8fa] to-[#8b95a3]", center: "radial-gradient(circle at 35% 30%, #a3adbb, #454d59)", symbol: "#ffffff" },
  { frame: "bg-gradient-to-br from-[#fbe38e] to-[#c8961e]", center: "radial-gradient(circle at 35% 30%, #e6b325, #6f4a06)", symbol: "#fff6d6" },
  {
    frame: "bg-gradient-to-br from-[#f4fbfe] via-[#b9d3de] to-[#5f7f8f]",
    center: "radial-gradient(circle at 35% 30%, #8fb4c4, #24404c)",
    symbol: "#effbff",
  },
  {
    frame: "bg-[conic-gradient(from_200deg,#67e8f9,#c4b5fd,#f0abfc,#67e8f9,#a5f3fc,#67e8f9)] shadow-[0_0_14px_rgba(103,232,249,0.55)]",
    center: "radial-gradient(circle at 35% 30%, #22d3ee, #6d28d9 70%, #2e0657)",
    symbol: "#ffffff",
    glow: "drop-shadow(0 0 4px rgba(165, 243, 252, 0.9))",
  },
];

/** Whether public/badges/<id>.png exists, checked once per visit; undefined while checking. */
const imageExists = new Map<BadgeId, boolean>();

function useBadgeImage(id: BadgeId): boolean | undefined {
  const [exists, setExists] = useState(imageExists.get(id));
  useEffect(() => {
    if (exists !== undefined) return;
    const img = new Image();
    img.onload = () => {
      imageExists.set(id, true);
      setExists(true);
    };
    img.onerror = () => {
      imageExists.set(id, false);
      setExists(false);
    };
    img.src = `/badges/${id}.png`;
  }, [id, exists]);
  return exists;
}

export function useBadgeNames() {
  const { lang } = useI18n();
  return {
    badge: (id: BadgeId) => BADGE_NAMES[lang][id],
    tier: (level: number) => (level > 0 ? TIER_NAMES[lang][TIERS[level - 1]!] : ""),
  };
}

/**
 * A medal in its level's colors. The symbol is the image in public/badges/<id>.png used as a
 * stencil (its shape, painted in the level's color), or an icon until that image exists.
 */
export function BadgeMedal({ id, level, size = 72 }: { id: BadgeId; level: number; size?: number }) {
  const image = useBadgeImage(id);
  const Icon = ICON[id];
  const look = LEVEL_LOOK[level]!;
  const ring = Math.max(3, Math.round(size / 18));
  const symbol = size * 0.5;
  const url = `url(/badges/${id}.png)`;
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-full ${look.frame} ${level === 0 ? "opacity-60" : ""}`}
      style={{ width: size, height: size, padding: ring }}
      aria-hidden
    >
      <span
        className="flex h-full w-full items-center justify-center rounded-full shadow-[inset_0_2px_6px_rgba(255,255,255,0.25),inset_0_-3px_6px_rgba(0,0,0,0.35)]"
        style={{ background: look.center, color: look.symbol, filter: look.glow }}
      >
        {image ? (
          <span
            style={{
              width: symbol,
              height: symbol,
              backgroundColor: look.symbol,
              maskImage: url,
              WebkitMaskImage: url,
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskPosition: "center",
            }}
          />
        ) : (
          image === false && <Icon size={size * 0.42} />
        )}
      </span>
    </span>
  );
}

/** Badges whose level went up since this device last opened the badges page. */
export function useNewLevels(username: string, a: Achievements | undefined): { fresh: { id: BadgeId; level: number }[]; markSeen: () => void } {
  const key = `seen-badge-levels:${username}`;
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });
  const levels = Object.fromEntries((a?.badges ?? []).map((b) => [b.id, b.level]));
  return {
    fresh: (a?.badges ?? []).filter((b) => b.level > (seen[b.id] ?? 0)).map((b) => ({ id: b.id, level: b.level })),
    markSeen: () => {
      try {
        localStorage.setItem(key, JSON.stringify(levels));
      } catch {
        // Private mode: they show as new again next visit, which is harmless.
      }
      setSeen(levels);
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

/** Streak, this week's challenges and badges that went up: the daily reason to step on the scale. */
export function StreakCard({ a, fresh, linkToBadges = true }: { a: Achievements; fresh: { id: BadgeId; level: number }[]; linkToBadges?: boolean }) {
  const { t, tf } = useI18n();
  const names = useBadgeNames();
  const week = a.challenges.filter((c) => c.period === "week");
  const daysLeft = week[0]?.daysLeft ?? 0;
  const first = fresh[0];
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
      {first && (
        <Link to="/logros" className="mt-4 flex items-center gap-3 rounded-2xl bg-brand/15 px-3 py-2.5 font-semibold text-ink">
          <BadgeMedal id={first.id} level={first.level} size={40} />
          {fresh.length > 1
            ? tf("newLevels", { n: fresh.length })
            : first.level === 1
              ? tf("newBadge", { name: names.badge(first.id) })
              : tf("newLevel", { name: names.badge(first.id), tier: names.tier(first.level) })}
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
