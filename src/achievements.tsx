import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import {
  FiActivity,
  FiAward,
  FiCalendar,
  FiCheck,
  FiCheckCircle,
  FiCheckSquare,
  FiClock,
  FiCloud,
  FiFlag,
  FiHeart,
  FiMap,
  FiMoon,
  FiNavigation,
  FiPieChart,
  FiRepeat,
  FiShield,
  FiStar,
  FiSun,
  FiTarget,
  FiTrendingDown,
  FiTrendingUp,
  FiUnlock,
  FiUser,
  FiWind,
  FiZap,
} from "react-icons/fi";
import { Link } from "react-router";
import {
  type Achievements,
  BADGE_NAMES,
  type BadgeId,
  type ChallengeStatus,
  MAX_FREEZES,
  type Streak,
  STREAK_UNLOCKS,
  type StreakUnlock,
  TIER_NAMES,
  TIERS,
} from "../shared/achievements.ts";
import { bodyFatOf } from "../shared/composition.ts";
import { rewardProgress, type StreakReward } from "../shared/schemas.ts";
import { useMe, useMeasurements } from "./api.ts";
import { FlameIcon } from "./icons.tsx";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Card, Progress, useFormat } from "./ui.tsx";

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
  "steps-10k": FiNavigation,
  "steps-15k": FiNavigation,
  "steps-20k": FiNavigation,
  "steps-week": FiCalendar,
  "steps-streak-7": FiZap,
  "distance-5k": FiMap,
  "distance-week": FiFlag,
  "flights-10": FiTrendingUp,
  "stand-3h": FiUser,
  "exercise-30": FiActivity,
  "exercise-60": FiActivity,
  "exercise-150": FiCalendar,
  "exercise-300": FiCalendar,
  "exercise-streak-7": FiZap,
  "exercise-streak-30": FiZap,
  "active-500": FiSun,
  "active-1000": FiSun,
  "active-week": FiTrendingDown,
  "sleep-7": FiMoon,
  "sleep-week": FiMoon,
  "sleep-streak-7": FiZap,
  "sleep-deep": FiCloud,
  "sleep-unbroken": FiShield,
  "sleep-regular": FiClock,
  "resting-hr-60": FiHeart,
  "resting-hr-down": FiHeart,
  "hrv-up": FiTrendingUp,
  "oxygen-week": FiWind,
  "full-day": FiStar,
  "full-week": FiAward,
};

/**
 * Each level's colors (locked, bronze, silver, gold, platinum, diamond): the ring and symbol, and
 * the soft fill inside, in light and dark. Written out in full so Tailwind finds every class.
 */
export const TIER_LOOK: { ring: string; text: string; soft: string }[] = [
  { ring: "border-[#9fb0a6] [[data-theme=dark]_&]:border-[#4b5c52]", text: "text-[#9fb0a6] [[data-theme=dark]_&]:text-[#4b5c52]", soft: "bg-[#edf2ef] [[data-theme=dark]_&]:bg-[#172019]" },
  { ring: "border-[#9a5b2a] [[data-theme=dark]_&]:border-[#d08b55]", text: "text-[#9a5b2a] [[data-theme=dark]_&]:text-[#d08b55]", soft: "bg-[#f6e7da] [[data-theme=dark]_&]:bg-[rgba(208,139,85,0.14)]" },
  { ring: "border-[#6b7a85] [[data-theme=dark]_&]:border-[#afc0cb]", text: "text-[#6b7a85] [[data-theme=dark]_&]:text-[#afc0cb]", soft: "bg-[#edf1f4] [[data-theme=dark]_&]:bg-[rgba(175,192,203,0.12)]" },
  { ring: "border-[#b07a08] [[data-theme=dark]_&]:border-[#eab308]", text: "text-[#b07a08] [[data-theme=dark]_&]:text-[#eab308]", soft: "bg-[#fbf1d9] [[data-theme=dark]_&]:bg-[rgba(234,179,8,0.14)]" },
  { ring: "border-[#2c8c8a] [[data-theme=dark]_&]:border-[#4fd1c5]", text: "text-[#2c8c8a] [[data-theme=dark]_&]:text-[#4fd1c5]", soft: "bg-[#ddf3f2] [[data-theme=dark]_&]:bg-[rgba(79,209,197,0.14)]" },
  { ring: "border-[#6d28d9] [[data-theme=dark]_&]:border-[#a78bfa]", text: "text-[#6d28d9] [[data-theme=dark]_&]:text-[#a78bfa]", soft: "bg-[#efe8fd] [[data-theme=dark]_&]:bg-[rgba(167,139,250,0.14)]" },
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
 * A medal in its level's colors: a ring around a soft fill with the symbol inside. The symbol is
 * the image in public/badges/<id>.png used as a stencil (its shape, painted in the level's color),
 * or an icon until that image exists.
 */
export function BadgeMedal({ id, level, size = 64 }: { id: BadgeId; level: number; size?: number }) {
  const image = useBadgeImage(id);
  const Icon = ICON[id];
  const look = TIER_LOOK[level]!;
  const symbol = size * 0.42;
  const url = `url(/badges/${id}.png)`;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full ${look.ring} ${look.soft} ${look.text}`}
      style={{ width: size, height: size, borderWidth: Math.max(3, Math.round(size / 16)) }}
      aria-hidden
    >
      {image ? (
        <span
          style={{
            width: symbol,
            height: symbol,
            backgroundColor: "currentColor",
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
        image === false && <Icon size={symbol} strokeWidth={2.2} />
      )}
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
  const { t } = useI18n();
  const f = useFormat();
  const value = c.id === "month-fat" ? f.number(c.value) : f.number(c.value, 0);
  const target = c.id === "month-fat" ? f.number(c.target) : f.number(c.target, 0);
  const hint = c.id === "week-full-3" ? t("challengeHint.week-full-3") : null;
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3 text-[15px] font-bold">
        <span className="inline-flex items-center gap-1.5">
          {c.done && <FiCheck size={16} strokeWidth={3} className="text-good-text" aria-hidden />}
          {t(`challenge.${c.id}` as MessageKey)}
        </span>
        <span className={`shrink-0 ${c.done ? "text-brand-text" : "text-ink-2"}`}>
          {value} / {target}
          {c.done && <span className="sr-only"> ({t("challengeDone")})</span>}
        </span>
      </div>
      <Progress fraction={c.value / c.target} height={8} label={t(`challenge.${c.id}` as MessageKey)} />
      {hint && !c.done && <p className="text-xs font-semibold text-muted">{hint}</p>}
    </li>
  );
}

/** The streak icon grows with the streak: green, gold from 30 days, violet from 100. */
function streakTone(days: number): string {
  if (days >= STREAK_UNLOCKS.diamond) return "bg-[#efe8fd] text-[#6d28d9] [[data-theme=dark]_&]:bg-[rgba(167,139,250,0.14)] [[data-theme=dark]_&]:text-[#a78bfa]";
  if (days >= STREAK_UNLOCKS.gold) return "bg-gold-soft text-gold";
  if (days > 0) return "bg-brand-soft text-brand";
  return "bg-surface-2 text-muted";
}

/** How the current streak stands against the record before it. */
function recordText(s: Streak, t: (k: MessageKey) => string, tf: (k: MessageKey, v: Record<string, string | number>) => string): string | null {
  if (s.current === 0 || s.bestBefore === 0) return null;
  if (s.current > s.bestBefore) return t("recordNew");
  if (s.current === s.bestBefore) return t("recordTie");
  return tf("recordAhead", { n: s.bestBefore - s.current + 1, best: s.bestBefore });
}

/** The latest weight and body fat (North American recalculation), for weight and body fat rewards. */
export function useBodyNow(): { weightKg: number | null; fatPct: number | null } {
  const measurements = useMeasurements().data ?? [];
  const profile = useMe().data?.profile;
  const full = measurements.find((m) => m.bodyFatPct !== null || m.impedance !== null);
  return { weightKg: measurements[0]?.weightKg ?? null, fatPct: full && profile ? (bodyFatOf(profile, full)?.value ?? null) : null };
}

/** A reward and how far along it is: days in a row, kilos lost or points of body fat lost. */
export function RewardProgress({ reward, streak, small = false }: { reward: StreakReward; streak: number; small?: boolean }) {
  const { tf } = useI18n();
  const f = useFormat();
  const body = useBodyNow();
  const unit = useMe().data?.profile?.unit ?? "kg";
  // kind and target are missing on a reward cached offline by an older version (a streak in `days`).
  const kind = reward.kind ?? "streak";
  const target = reward.target ?? (reward as unknown as { days: number }).days;
  const { current } = rewardProgress({ kind, target, start: reward.start ?? null }, { streak, ...body });
  const text =
    kind === "streak"
      ? tf("rewardProgress", { text: reward.text, current, days: target })
      : kind === "weight"
        ? tf("rewardProgressWeight", { text: reward.text, current: f.weight(current, unit), target: f.weight(target, unit) })
        : tf("rewardProgressFat", { text: reward.text, current: f.number(current), target: f.number(target) });
  return (
    <div className="flex flex-col gap-1.5">
      <p className={small ? "text-[13px] font-bold" : "text-[15px] font-extrabold"}>{reward.earnedAt ? tf("rewardWon", { text: reward.text }) : text}</p>
      {!reward.earnedAt && <Progress fraction={current / target} className="bg-gold" />}
    </div>
  );
}

/** The first streak reward still locked. */
export function nextUnlock(best: number): { key: StreakUnlock; days: number } | null {
  const pending = (Object.entries(STREAK_UNLOCKS) as [StreakUnlock, number][]).filter(([, days]) => best < days).sort((x, y) => x[1] - y[1]);
  return pending[0] ? { key: pending[0][0], days: pending[0][1] } : null;
}

/** A link to the badges page when badges went up a level since the last visit there. */
function FreshLevels({ fresh }: { fresh: { id: BadgeId; level: number }[] }) {
  const { tf } = useI18n();
  const names = useBadgeNames();
  const first = fresh[0];
  if (!first) return null;
  return (
    <Link to="/logros" className="flex items-center gap-3 rounded-2xl bg-brand-soft px-3 py-2.5 text-[15px] font-extrabold text-ink">
      <BadgeMedal id={first.id} level={first.level} size={40} />
      {fresh.length > 1
        ? tf("newLevels", { n: fresh.length })
        : first.level === 1
          ? tf("newBadge", { name: names.badge(first.id) })
          : tf("newLevel", { name: names.badge(first.id), tier: names.tier(first.level) })}
    </Link>
  );
}

/**
 * Home's streak card: the streak, freezes, the reward, what the next days unlock and this week's
 * challenges. The Awards page shows the same in the larger StreakHero.
 */
export function StreakCard({
  a,
  fresh,
  reward = null,
  linkToBadges = true,
}: {
  a: Achievements;
  fresh: { id: BadgeId; level: number }[];
  reward?: StreakReward | null;
  linkToBadges?: boolean;
}) {
  const { t, tf } = useI18n();
  const s = a.streak;
  const week = a.challenges.filter((c) => c.period === "week");
  const daysLeft = week[0]?.daysLeft ?? 0;
  const record = recordText(s, t, tf);
  const next = nextUnlock(s.best);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3.5">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] ${streakTone(s.current)}`} aria-hidden>
          <FlameIcon size={28} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-ink-2">{t("streakTitle")}</p>
          <p className="text-[28px] leading-7.5 font-extrabold">{s.current > 0 ? (s.current === 1 ? t("aw.dayOne") : tf("aw.days", { n: s.current })) : t("streakNone")}</p>
          {s.current > 0 && (
            <p className={`text-[13px] font-bold ${s.weighedToday ? "text-good-text" : "text-warn-text"}`}>{s.weighedToday ? t("aw.today") : t("aw.notToday")}</p>
          )}
          {record ? <p className="text-xs font-semibold text-ink-2">{record}</p> : s.best > 0 && <p className="text-xs font-semibold text-muted">{tf("streakBest", { n: s.best })}</p>}
        </div>
        {s.current > 0 && <FreezeTokens s={s} tone="card" />}
      </div>
      {reward && <RewardProgress reward={reward} streak={s.current} small />}
      {next && (
        <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
          <FiUnlock size={16} className="shrink-0 text-brand-text" aria-hidden />
          {tf("nextUnlock", { days: next.days, name: t(`unlock.${next.key}` as MessageKey) })}
        </p>
      )}
      <FreshLevels fresh={fresh} />
      {week.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-[15px] font-extrabold">{t("aw.weekChallenges")}</p>
            <p className="text-[13px] font-bold text-muted">{daysLeft <= 1 ? t("challengeLastDay") : tf("challengeDaysLeft", { n: daysLeft })}</p>
          </div>
          <ul>
            {week.map((c) => (
              <ChallengeRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      )}
      {linkToBadges && (
        <Link to="/logros" className="flex min-h-12 items-center justify-center rounded-2xl bg-surface-2 px-4 py-2.5 font-bold text-ink">
          {t("seeAchievements")}
        </Link>
      )}
    </Card>
  );
}

/** Freezes in hand as small shields, MAX_FREEZES slots. */
function FreezeTokens({ s, tone }: { s: Streak; tone: "hero" | "card" }) {
  const { tf } = useI18n();
  const on = tone === "hero" ? "bg-hero-a" : "bg-brand";
  const off = tone === "hero" ? "bg-hero-track" : "bg-track";
  return (
    <div className="flex shrink-0 gap-1" role="img" aria-label={tf("aw.freezesLabel", { n: s.freezes, max: MAX_FREEZES })}>
      {Array.from({ length: MAX_FREEZES }, (_, i) => (
        <span key={i} className={`h-8 w-7 rounded-[8px_8px_14px_14px] ${i < s.freezes ? on : off}`} />
      ))}
    </div>
  );
}

const WEEKS = 12;
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The last 12 weeks, a column per week from Monday to Sunday: days weighed (brighter inside the
 * current streak), days a freeze covered, days missed and the days still ahead this week.
 */
function WeighGrid({ s }: { s: Streak }) {
  const { tf, locale } = useI18n();
  const measurements = useMeasurements().data ?? [];
  const weighed = new Set(measurements.map((m) => isoOf(new Date(m.measuredAt))));
  const frozen = new Set(s.frozenDays);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayIso = isoOf(today);
  // The current streak runs back from today (or yesterday, when today is still ahead) over weighed or frozen days.
  const inStreak = new Set<string>();
  if (s.current > 0) {
    const d = new Date(today);
    if (!weighed.has(todayIso)) d.setDate(d.getDate() - 1);
    while (weighed.has(isoOf(d)) || frozen.has(isoOf(d))) {
      inStreak.add(isoOf(d));
      d.setDate(d.getDate() - 1);
    }
  }
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + w * 7 + d);
      return day;
    }),
  );
  let weighedCount = 0;
  let frozenCount = 0;
  const cell = (day: Date) => {
    const iso = isoOf(day);
    if (iso > todayIso) return "border-2 border-hero-track";
    if (weighed.has(iso)) {
      weighedCount++;
      return inStreak.has(iso) ? "bg-hero-a" : "bg-hero-a/45";
    }
    if (frozen.has(iso)) {
      frozenCount++;
      return "border-2 border-hero-a";
    }
    return "bg-hero-track";
  };
  const cells = weeks.map((week) => week.map(cell));
  // A month's name under the first week that starts in it.
  const months = weeks.map((week, i) => (i === 0 || week[0]!.getMonth() !== weeks[i - 1]![0]!.getMonth() ? week[0]!.toLocaleDateString(locale, { month: "short" }) : ""));
  return (
    <div className="flex flex-col gap-1.5">
      <div role="img" aria-label={tf("aw.gridLabel", { weighed: weighedCount, frozen: frozenCount })} className="grid grid-cols-12 gap-1">
        {cells.map((week, w) => (
          <div key={w} className="flex flex-col gap-1">
            {week.map((c, d) => (
              <span key={d} className={`h-5 rounded-[5px] ${c}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-1 text-[11px] font-bold text-hero-muted" aria-hidden>
        {months.map((m, i) => (
          <span key={i} className="overflow-visible whitespace-nowrap first-letter:uppercase">
            {m.replace(".", "")}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The Awards page's streak: days, best, freezes, the last 12 weeks and how freezes work. */
export function StreakHero({ s }: { s: Streak }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const record = recordText(s, t, tf);
  const lastFrozen = s.frozenDays[s.frozenDays.length - 1];
  return (
    <section className="flex flex-col gap-4 rounded-[28px] bg-hero p-5 text-hero-ink">
      <div className="flex items-center gap-3.5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-hero-track text-hero-a" aria-hidden>
          <FlameIcon size={30} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[36px] leading-10 font-extrabold tracking-[-0.03em]">
            {s.current === 1 ? t("aw.dayOne") : tf("aw.days", { n: s.current })}
          </span>
          <span className="text-[13px] font-bold text-hero-muted">
            {s.current > 0 ? (s.weighedToday ? t("aw.today") : t("aw.notToday")) : t("streakNone")}
            {s.best > 0 && ` · ${tf("aw.best", { n: s.best })}`}
          </span>
        </div>
        <FreezeTokens s={s} tone="hero" />
      </div>
      <WeighGrid s={s} />
      {record && <p className="text-[13px] font-extrabold">{record}</p>}
      {s.current > 0 && (
        <p className="text-[13px] font-extrabold">
          {s.freezes === 0 ? t("freezesNone") : s.freezes === 1 ? t("freezesOne") : tf("freezesMany", { n: s.freezes })} ·{" "}
          {s.nextFreezeIn === null ? t("freezeMax") : s.nextFreezeIn === 1 ? t("freezeNextOne") : tf("freezeNext", { n: s.nextFreezeIn })}
          {lastFrozen && <span className="font-semibold text-hero-muted"> {tf("freezeUsed", { date: f.date(`${lastFrozen}T12:00:00`) })}</span>}
        </p>
      )}
      <p className="text-[13px] font-semibold text-hero-muted">{t("freezesHint")}</p>
    </section>
  );
}
