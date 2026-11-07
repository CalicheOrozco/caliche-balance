import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useState } from "react";
import { FiArrowDown, FiArrowUp, FiAward, FiCheck, FiChevronDown, FiChevronRight, FiGift, FiGrid, FiSliders, FiTarget } from "react-icons/fi";
import { Link } from "react-router";
import { type Achievements, type ChallengeStatus, STREAK_UNLOCKS, type StreakUnlock, TARGETS } from "../../shared/achievements.ts";
import { bodyFatOf } from "../../shared/composition.ts";
import type { HealthDayDto } from "../../shared/health.ts";
import { ageAt, assess, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { scoreOf } from "../../shared/score.ts";
import { sleepScoreOf } from "../../shared/sleepScore.ts";
import { periodReport, trendNow, weightTrend } from "../../shared/trend.ts";
import {
  daysToReach,
  dailyTrend,
  estimateEta,
  goalProgress,
  maintainBands,
  maintainRange,
  maintainSide,
  nextBodyFatGoal,
  nextWeightGoal,
} from "../../shared/goals.ts";
import { fromKilograms, type GoalsDto, type StreakReward, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { BadgeMedal, RewardProgress, useBadgeNames, useNewLevels } from "../achievements.tsx";
import { api, useAchievementsQuery } from "../api.ts";
import { FlameIcon, BulbIcon } from "../icons.tsx";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { ReportCard } from "../reports.tsx";
import {
  Avatar,
  Button,
  Callout,
  Card,
  DeltaPill,
  IconLink,
  Modal,
  PageHeader,
  Progress,
  RangeBar,
  Rings,
  SectionHeader,
  StatusBadge,
  Toggle,
  signed,
  useFormat,
} from "../ui.tsx";

const DAY = 24 * 60 * 60 * 1000;
/** Active calories that count as a closed move ring: the app's own daily badge target. */
const MOVE_KCAL = TARGETS.activeDayKcal[0];
/** How far ahead the weight chart projects the recent pace. */
const PROJECTION_DAYS = 21;

/** The local calendar day of a time, as YYYY-MM-DD (the same form Apple Health days use). */
function dayKey(time: Date | number | string): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** "7 h 18 min". */
function hoursText(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, "0")} min`;
}

const isFull = (m: MeasurementDto) => m.bodyFatPct !== null || m.impedance !== null;

/** A message with {placeholders} filled by elements, so numbers inside a sentence can be bold. */
function rich(text: string, vars: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{name && name in vars ? vars[name] : part}</Fragment>;
  });
}

/**
 * Apple Health days, under the same cache key the Activity screen uses so both share one request.
 * Kept here rather than imported so Today only depends on the API and shared logic.
 */
function useHealthDays(enabled: boolean) {
  return useQuery({ queryKey: ["apple-health", "days"], queryFn: () => api.healthDays(90), enabled });
}

/** What Apple Health says about today: last night's sleep (with its score) and today's active calories. */
function useToday(connected: boolean) {
  const days = useHealthDays(connected).data ?? [];
  const today = dayKey(Date.now());
  const index = days.findIndex((d) => d.date === today);
  const day: HealthDayDto | undefined = days[index];
  // A night belongs to the day you woke up, so today's entry holds last night.
  const night = day?.sleep ?? null;
  const before = days.slice(0, Math.max(index, 0)).flatMap((d) => (d.sleep ? [d.sleep] : []));
  const sleepScore = night ? sleepScoreOf(night, before, Intl.DateTimeFormat().resolvedOptions().timeZone) : null;
  return { night, sleepScore, activeKcal: day?.activeKcal ?? null };
}

/** The first streak reward still locked. */
function nextUnlock(best: number): { key: StreakUnlock; days: number } | null {
  const pending = (Object.entries(STREAK_UNLOCKS) as [StreakUnlock, number][]).filter(([, days]) => best < days).sort((x, y) => x[1] - y[1]);
  return pending[0] ? { key: pending[0][0], days: pending[0][1] } : null;
}

// ---- Last 7 days -----------------------------------------------------------------------------

function DayStrip({ measurements }: { measurements: MeasurementDto[] }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i));
  return (
    <ol aria-label={t("home.days")} className="grid grid-cols-7 gap-1.5">
      {days.map((date, i) => {
        const today = i === 6;
        // Newest first, so this is the day's latest weigh-in.
        const reading = measurements.find((m) => dayKey(m.measuredAt) === dayKey(date));
        const label = tf(reading ? "home.dayWeighed" : "home.dayNotWeighed", { day: f.longDay(date) });
        const className = `flex h-16 flex-col items-center justify-center gap-0.5 rounded-[18px] border ${today ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface text-ink"}`;
        const content = (
          <>
            <span className="text-[11px] font-bold opacity-80" aria-hidden>
              {capitalize(date.toLocaleDateString(locale, { weekday: "narrow" }))}
            </span>
            <span className="text-[17px] font-extrabold" aria-hidden>
              {date.getDate()}
            </span>
            <span className={`h-1.25 w-1.25 rounded-full ${reading ? (today ? "bg-brand-ink" : "bg-brand") : ""}`} aria-hidden />
          </>
        );
        return (
          <li key={i}>
            {reading ? (
              <Link to={`/medicion/${reading.id}`} aria-label={label} aria-current={today ? "date" : undefined} className={`${className} transition active:scale-95`}>
                {content}
              </Link>
            ) : (
              <div role="img" aria-label={label} aria-current={today ? "date" : undefined} className={className}>
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---- Today's balance -------------------------------------------------------------------------

function BalanceCard({
  profile,
  measurements,
  connected,
  achievements,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  connected: boolean;
  achievements: Achievements | undefined;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const today = useToday(connected);
  const latest = measurements[0]!;
  // Weigh-ins without bare feet only have weight; the score comes from the newest full one.
  const body = scoreOf(profile, measurements.find(isFull) ?? latest).score;

  const parts: { key: MessageKey; score: number; ring: string; dot: string }[] = [];
  if (today.activeKcal !== null) {
    parts.push({ key: "home.partMove", score: Math.min(Math.round((today.activeKcal / MOVE_KCAL) * 100), 100), ring: "stroke-hero-a", dot: "bg-hero-a" });
  }
  if (today.sleepScore) parts.push({ key: "home.partSleep", score: today.sleepScore.score, ring: "stroke-hero-b", dot: "bg-hero-b" });
  parts.push({ key: "home.partBody", score: body, ring: "stroke-hero-c", dot: "bg-hero-c" });
  const score = Math.round(parts.reduce((sum, p) => sum + p.score, 0) / parts.length);
  const verdict: MessageKey = score >= 85 ? "home.balanceGreat" : score >= 70 ? "home.balanceGood" : score >= 50 ? "home.balanceOk" : "home.balanceLow";

  // One sentence per thing we actually know about today.
  const tips: string[] = [];
  if (today.night) tips.push(tf("home.tipSlept", { sleep: hoursText(today.night.asleepMin) }));
  const best = achievements?.streak.best ?? 0;
  const trend = best >= STREAK_UNLOCKS.trend ? trendNow(weightTrend(measurements)) : null;
  if (trend?.perWeekKg != null) {
    const delta = fromKilograms(Math.abs(trend.perWeekKg), profile.unit);
    tips.push(
      delta < 0.05
        ? t("home.tipTrendFlat")
        : tf(trend.perWeekKg < 0 ? "home.tipTrendDown" : "home.tipTrendUp", { delta: `${f.number(delta)} ${profile.unit}` }),
    );
  }
  if (today.activeKcal !== null) {
    tips.push(
      today.activeKcal >= MOVE_KCAL
        ? tf("home.tipKcalDone", { target: f.number(MOVE_KCAL, 0) })
        : tf("home.tipKcalLeft", { kcal: f.number(MOVE_KCAL - today.activeKcal, 0), target: f.number(MOVE_KCAL, 0) }),
    );
  }
  if (tips.length === 0) tips.push(dayKey(latest.measuredAt) === dayKey(Date.now()) ? t("home.tipWeighed") : t("home.tipWeighIn"));
  if (!connected) tips.push(t("home.balanceConnect"));

  return (
    <section className="flex flex-col gap-4 rounded-[28px] bg-hero p-5 text-hero-ink">
      <div className="flex items-center gap-4.5">
        <Rings
          rings={parts.map((p) => ({ fraction: p.score / 100, className: p.ring }))}
          size={132}
          stroke={9}
          trackClass="stroke-hero-track"
          label={tf("home.balanceAria", { score, parts: parts.map((p) => `${t(p.key)} ${p.score}`).join(", ") })}
        >
          <span className="text-[26px] leading-7 font-extrabold" aria-hidden>
            {score}
          </span>
        </Rings>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex flex-col">
            <span className="text-[13px] font-bold text-hero-muted">{t("home.balanceTitle")}</span>
            <span className="text-xl leading-6 font-extrabold">{t(verdict)}</span>
          </div>
          {parts.map((p) => (
            <div key={p.key} className="flex items-center gap-2 text-[13px] font-bold" aria-hidden>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.dot}`} />
              <span className="flex-1">{t(p.key)}</span>
              <span>{p.score}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-start gap-2.5 rounded-[18px] bg-hero-track p-3.5">
        <BulbIcon size={18} className="mt-px shrink-0" />
        <p className="text-sm leading-5 font-semibold">{tips.join(" ")}</p>
      </div>
    </section>
  );
}

// ---- Weight ----------------------------------------------------------------------------------

/** Round grid steps so the labels read 96, 97, 98 rather than 96.3, 97.1. */
function gridStep(range: number): number {
  return range > 15 ? 5 : range > 6 ? 2 : range > 2.5 ? 1 : 0.5;
}

/**
 * The last 30 days: each weigh-in as a dot, the smoothed trend as a line (once the streak unlocks
 * it; until then the weigh-ins themselves are joined) and, when the pace is known, a dashed line
 * three weeks ahead.
 */
function WeightChart({ measurements, unit, trendUnlocked }: { measurements: MeasurementDto[]; unit: ProfileDto["unit"]; trendUnlocked: boolean }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const now = Date.now();
  const start = now - 30 * DAY;
  const toUnit = (kg: number) => fromKilograms(kg, unit);
  // The trend runs over the whole history so the first days of the window are already smoothed.
  const all = weightTrend(measurements);
  const shown = all.filter((p) => p.time >= start);
  if (shown.length < 2) return null;
  const raw = shown.map((p) => ({ time: p.time, value: toUnit(p.weightKg) }));
  const line = trendUnlocked ? shown.map((p) => ({ time: p.time, value: toUnit(p.trendKg) })) : raw;
  const perDay = dailyTrend(raw, now);
  const last = line[line.length - 1]!;
  const projected = perDay === null ? null : last.value + perDay * PROJECTION_DAYS;
  const end = projected === null ? now : now + PROJECTION_DAYS * DAY;

  const W = 318;
  const H = 140;
  const values = [...raw.map((p) => p.value), ...line.map((p) => p.value), ...(projected === null ? [] : [projected])];
  const step = gridStep(Math.max(...values) - Math.min(...values));
  const lo = Math.floor(Math.min(...values) / step) * step - step / 2;
  const hi = Math.ceil(Math.max(...values) / step) * step + step / 2;
  const x = (time: number) => Math.round(((time - start) / (end - start)) * W * 10) / 10;
  const y = (v: number) => Math.round((10 + ((hi - v) / (hi - lo)) * (H - 20)) * 10) / 10;
  const path = line.map((p, i) => `${i ? "L" : "M"}${x(p.time)} ${y(p.value)}`).join(" ");
  const area = `${path} L${x(last.time)} ${H} L${x(line[0]!.time)} ${H} Z`;
  const grid: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid.push(Math.round(v * 10) / 10);
  const split = x(now);
  const day = (time: number) => new Date(time).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const ticks = [
    { time: start, label: day(start) },
    { time: start + 15 * DAY, label: day(start + 15 * DAY) },
    { time: now, label: t("home.chartToday") },
    ...(projected === null ? [] : [{ time: end, label: day(end) }]),
  ];
  const aria =
    projected === null
      ? tf("home.chartAria", { from: `${f.number(raw[0]!.value)} ${unit}`, to: `${f.number(raw[raw.length - 1]!.value)} ${unit}` })
      : tf("home.chartAriaProjection", {
          from: `${f.number(raw[0]!.value)} ${unit}`,
          to: `${f.number(raw[raw.length - 1]!.value)} ${unit}`,
          projected: `${f.number(projected)} ${unit}`,
        });

  return (
    <div className="mt-3.5">
      <svg viewBox="0 0 348 150" width="100%" role="img" aria-label={aria} className="block overflow-visible">
        {projected !== null && <rect x={split + 4} y={0} width={W - split - 4} height={H} rx={10} className="fill-surface-2" />}
        {grid.map((v) => (
          <g key={v}>
            <line x1={0} x2={W} y1={y(v)} y2={y(v)} strokeWidth={1} strokeDasharray="3 5" className="stroke-line" />
            <text x={348} y={y(v) + 4} textAnchor="end" fontSize={11} fontWeight={600} className="fill-muted">
              {f.number(v, step < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        <path d={area} className="fill-(--chart-fill)" />
        {raw.map((p) => (
          <circle key={p.time} cx={x(p.time)} cy={y(p.value)} r={2.3} className="fill-muted opacity-50" />
        ))}
        <path d={path} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="stroke-brand" />
        {projected !== null && (
          <>
            <path d={`M${x(last.time)} ${y(last.value)} L${W} ${y(projected)}`} fill="none" strokeWidth={2.5} strokeDasharray="2 6" strokeLinecap="round" className="stroke-brand" />
            <text x={(split + W) / 2 + 2} y={20} textAnchor="middle" fontSize={11} fontWeight={800} className="fill-ink-2">
              {t("home.chartNext")}
            </text>
          </>
        )}
        <circle cx={x(last.time)} cy={y(last.value)} r={9} className="fill-brand-soft" />
        <circle cx={x(last.time)} cy={y(last.value)} r={5} strokeWidth={2} className="fill-brand stroke-surface" />
      </svg>
      <div className="relative mt-0.5 h-4 w-[91.4%] text-[11px] font-semibold text-muted" aria-hidden>
        {ticks.map((tick, i) => (
          <span
            key={i}
            className={`absolute whitespace-nowrap ${i === 0 ? "" : i === ticks.length - 1 && tick.time === end ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${(x(tick.time) / W) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function WeightCard({ profile, measurements, goals, trendUnlocked }: { profile: ProfileDto; measurements: MeasurementDto[]; goals: GoalsDto; trendUnlocked: boolean }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const unit = profile.unit;
  const latest = measurements[0]!;
  const previous = measurements[1];
  const now = Date.now();
  const latestDay = dayKey(latest.measuredAt);
  const when =
    latestDay === dayKey(now)
      ? tf("home.today", { time: f.time(latest.measuredAt) })
      : latestDay === dayKey(now - DAY)
        ? tf("home.yesterday", { time: f.time(latest.measuredAt) })
        : f.dateTime(latest.measuredAt);

  const change = previous ? fromKilograms(latest.weightKg - previous.weightKg, unit) : null;
  // "Good" is whatever moves toward the goal; with no goal, losing is the usual aim.
  const wantsUp =
    goals.weight !== null
      ? goals.weight.targetKg > (goals.weight.startKg ?? latest.weightKg)
      : goals.maintain !== null
        ? latest.weightKg < goals.maintain.centerKg
        : false;
  const changeGood = change === null || Math.abs(change) < 0.05 || (wantsUp ? change > 0 : change < 0);

  // Real weight and how it moved over 30 days (the weigh-ins themselves until the streak unlocks it).
  const points = weightTrend(measurements);
  const value = (p: (typeof points)[number]) => (trendUnlocked ? p.trendKg : p.weightKg);
  const newest = points[points.length - 1]!;
  const monthAgo = points.find((p) => p.time >= now - 30 * DAY);
  const change30 = monthAgo && newest.time - monthAgo.time >= 7 * DAY ? fromKilograms(value(newest) - value(monthAgo), unit) : null;

  // When the weight goal arrives at the recent pace.
  let eta: { target: string; date: string } | null = null;
  if (goals.weight) {
    const kgPoints = measurements.map((m) => ({ time: Date.parse(m.measuredAt), value: m.weightKg }));
    const progress = goalProgress(goals.weight.startKg, latest.weightKg, goals.weight.targetKg);
    const perDay = dailyTrend(kgPoints, now);
    if (estimateEta(progress, perDay).kind === "weeks" && perDay !== null) {
      const at = now + (progress.remaining / Math.abs(perDay)) * DAY;
      eta = { target: f.weight(goals.weight.targetKg, unit), date: new Date(at).toLocaleDateString(locale, { day: "numeric", month: "long" }) };
    }
  }

  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[15px] font-bold text-ink-2">{tf("home.weightAt", { when })}</p>
        <Link to={`/medicion/${latest.id}`} className="py-2.5 text-sm font-bold text-brand-text">
          {t("home.detail")}
        </Link>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[56px] leading-15 font-extrabold tracking-[-0.04em]">{f.number(fromKilograms(latest.weightKg, unit))}</span>
        <span className="text-xl font-bold text-muted">{unit}</span>
        <span className="flex-1" />
        {change !== null && (
          <span className="self-center">
            <DeltaPill value={change} good={changeGood}>
              <span className="sr-only">{signed(change, (n) => `${f.number(n)} ${unit}`)}</span>
              <span aria-hidden>{f.number(Math.abs(change))}</span>
            </DeltaPill>
          </span>
        )}
      </div>
      {trendUnlocked ? (
        <p className="text-sm text-ink-2">
          {t("trendTitle")} <strong className="text-ink">{f.weight(newest.trendKg, unit)}</strong>
          {change30 !== null && <> · {tf("home.change30", { delta: signed(change30, (n) => `${f.number(n)} ${unit}`) })}</>}
        </p>
      ) : (
        <>
          {change30 !== null && <p className="text-sm text-ink-2">{tf("home.change30", { delta: signed(change30, (n) => `${f.number(n)} ${unit}`) })}</p>}
          <TrendLocked />
        </>
      )}
      <WeightChart measurements={measurements} unit={unit} trendUnlocked={trendUnlocked} />
      {eta && (
        <div className="mt-3">
          <Callout icon={FiTarget} tone="brand">
            {rich(t("home.eta"), { target: <strong>{eta.target}</strong>, date: <strong>{eta.date}</strong> })}
          </Callout>
        </div>
      )}
    </Card>
  );
}

/** How to unlock real weight, once the server says how long the best streak is. */
function TrendLocked() {
  const { tf } = useI18n();
  const best = useAchievementsQuery().data?.streak.best;
  if (best === undefined) return null;
  return <p className="text-xs font-semibold text-muted">{tf("trendLocked", { n: STREAK_UNLOCKS.trend, best })}</p>;
}

// ---- For today -------------------------------------------------------------------------------

interface Task {
  key: string;
  title: string;
  sub: string;
  done: boolean;
  tag: string | null;
  to: string;
}

function ForToday({
  measurements,
  unit,
  connected,
  achievements,
}: {
  measurements: MeasurementDto[];
  unit: ProfileDto["unit"];
  connected: boolean;
  achievements: Achievements | undefined;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const today = useToday(connected);
  const latest = measurements[0]!;
  const weighed = dayKey(latest.measuredAt) === dayKey(Date.now());
  const streak = achievements?.streak.current ?? 0;
  const pct = (n: number) => `${Math.min(Math.round(n * 100), 99)} %`;

  const tasks: Task[] = [
    {
      key: "weigh",
      title: t("home.taskWeigh"),
      sub: weighed
        ? tf(isFull(latest) ? "home.taskWeighFull" : "home.taskWeighDone", { weight: f.weight(latest.weightKg, unit), time: f.time(latest.measuredAt) })
        : streak > 0
          ? tf("home.taskWeighStreak", { n: streak })
          : t("home.taskWeighStart"),
      done: weighed,
      tag: weighed ? t("home.done") : null,
      to: weighed ? `/medicion/${latest.id}` : "/agregar",
    },
  ];
  if (today.night) {
    const done = today.night.asleepMin >= TARGETS.sleepMin;
    tasks.push({
      key: "sleep",
      title: t("home.taskSleep"),
      sub: tf("home.taskSleepSub", { time: hoursText(today.night.asleepMin) }),
      done,
      tag: done ? t("home.done") : pct(today.night.asleepMin / TARGETS.sleepMin),
      to: "/actividad",
    });
  }
  if (today.activeKcal !== null) {
    const done = today.activeKcal >= MOVE_KCAL;
    tasks.push({
      key: "move",
      title: tf("home.taskMove", { target: f.number(MOVE_KCAL, 0) }),
      sub: tf("home.taskMoveSub", { value: f.number(today.activeKcal, 0), target: f.number(MOVE_KCAL, 0) }),
      done,
      tag: done ? t("home.done") : pct(today.activeKcal / MOVE_KCAL),
      to: "/actividad",
    });
  }
  // The first challenge still open, so there is always one small thing beyond the daily habit.
  const challenge: ChallengeStatus | undefined = achievements?.challenges.find((c) => !c.done);
  if (challenge) {
    const digits = challenge.id === "month-fat" ? 1 : 0;
    tasks.push({
      key: challenge.id,
      title: t(`challenge.${challenge.id}` as MessageKey),
      sub: tf(challenge.period === "week" ? "home.challengeWeek" : "home.challengeMonth", {
        value: f.number(challenge.value, digits),
        target: f.number(challenge.target, digits),
      }),
      done: false,
      tag: t("home.challengeTag"),
      to: challenge.id === "month-waist" ? "/agregar" : "/logros",
    });
  }
  const doneCount = tasks.filter((x) => x.done).length;

  return (
    <>
      <SectionHeader title={t("home.forToday")} aside={tf("home.doneOf", { done: doneCount, total: tasks.length })} />
      <Card padded={false}>
        <ul>
          {tasks.map((task) => (
            <li key={task.key} className="border-t border-line first:border-t-0">
              <Link to={task.to} className="flex min-h-17 items-center gap-3 px-4 py-2.5 text-ink">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${task.done ? "border-brand bg-brand text-brand-ink" : "border-line"}`}
                  aria-hidden
                >
                  {task.done && <FiCheck size={14} strokeWidth={3} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={`text-[15px] font-bold ${task.done ? "text-ink-2" : "text-ink"}`}>
                    {task.title}
                    {task.done && <span className="sr-only"> ({t("home.done")})</span>}
                  </span>
                  <span className="text-xs font-semibold text-muted">{task.sub}</span>
                </span>
                {task.tag && (
                  <span className={`shrink-0 text-xs font-extrabold ${task.done ? "text-good-text" : "text-ink-2"}`} aria-hidden={task.done}>
                    {task.tag}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

// ---- Streak and goal -------------------------------------------------------------------------

function StreakMini({ achievements }: { achievements: Achievements }) {
  const { t, tf } = useI18n();
  const s = achievements.streak;
  const next = nextUnlock(s.best);
  return (
    <Link to="/logros" className="flex flex-col gap-2 rounded-3xl border border-line bg-surface p-4 text-ink shadow-card transition active:scale-[0.98]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-brand-soft text-brand">
          <FlameIcon size={22} />
        </span>
        <span className="text-right text-[11px] font-extrabold text-muted">
          {s.freezes === 0 ? t("home.freezesNone") : s.freezes === 1 ? t("home.freezesOne") : tf("home.freezesMany", { n: s.freezes })}
        </span>
      </div>
      <span className="text-[28px] leading-7.5 font-extrabold">{s.current === 1 ? t("home.dayShort") : tf("home.daysShort", { n: s.current })}</span>
      <Progress fraction={next ? s.best / next.days : 1} className="bg-gold" />
      <span className="text-xs font-semibold text-ink-2">
        {next ? tf("home.nextUnlock", { n: next.days - s.best, name: t(`unlock.${next.key}` as MessageKey).toLocaleLowerCase() }) : t("home.allUnlocked")}
      </span>
    </Link>
  );
}

function GoalMini({ goals, measurements, profile }: { goals: GoalsDto; measurements: MeasurementDto[]; profile: ProfileDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const unit = profile.unit;
  const latest = measurements[0]!;
  const box = "flex flex-col gap-2 rounded-3xl border border-line bg-surface p-4 text-ink shadow-card transition active:scale-[0.98]";

  let tag: string;
  let big: string;
  let fraction: number;
  let foot: string;
  if (goals.weight) {
    const p = goalProgress(goals.weight.startKg, latest.weightKg, goals.weight.targetKg);
    tag = tf("home.goalTag", { value: f.weight(goals.weight.targetKg, unit) });
    fraction = p.fraction;
    big = `${Math.round(p.fraction * 100)} %`;
    foot = p.reached || goals.weight.reachedAt ? t("goalReached") : tf("home.goalLeft", { value: f.weight(p.remaining, unit) });
  } else if (goals.maintain) {
    const inside = maintainSide(goals.maintain, latest.weightKg) === null;
    tag = t("home.maintainTag");
    fraction = inside ? 1 : 0;
    big = f.weight(goals.maintain.centerKg, unit);
    foot = inside ? t("home.maintainIn") : t("home.maintainOut");
  } else {
    const comp = measurements.find(isFull);
    const fat = comp ? bodyFatOf(profile, comp) : null;
    if (goals.bodyFat && fat) {
      const p = goalProgress(goals.bodyFat.startPct, fat.value, goals.bodyFat.targetPct);
      tag = tf("home.goalTag", { value: `${f.number(goals.bodyFat.targetPct)} %` });
      fraction = p.fraction;
      big = `${Math.round(p.fraction * 100)} %`;
      foot = p.reached || goals.bodyFat.reachedAt ? t("goalReached") : tf("home.goalLeft", { value: `${f.number(p.remaining)} %` });
    } else {
      return (
        <Link to="/ajustes#metas" className={box}>
          <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-surface-2 text-brand-text">
            <FiTarget size={22} aria-hidden />
          </span>
          <span className="text-lg leading-6 font-extrabold">{t("home.setGoalShort")}</span>
          <span className="text-xs font-semibold text-ink-2">{t("goalNone")}</span>
        </Link>
      );
    }
  }
  return (
    <Link to="/ajustes#metas" className={box}>
      <div className="flex items-center justify-between gap-2">
        <Rings rings={[{ fraction, className: "stroke-brand" }]} size={40} stroke={5} />
        <span className="text-right text-[11px] font-extrabold text-muted">{tag}</span>
      </div>
      <span className="truncate text-[28px] leading-7.5 font-extrabold">{big}</span>
      <Progress fraction={fraction} />
      <span className="text-xs font-semibold text-ink-2">{foot}</span>
    </Link>
  );
}

/** Badges that went up since this device last opened Awards, and the streak reward if there is one. */
function NewsCard({ username, achievements, reward }: { username: string; achievements: Achievements; reward: StreakReward | null }) {
  const { tf } = useI18n();
  const names = useBadgeNames();
  const { fresh } = useNewLevels(username, achievements);
  const first = fresh[0];
  if (!first && !reward) return null;
  return (
    <Card padded={false}>
      {first && (
        <Link to="/logros" className="flex min-h-16 items-center gap-3 px-4 py-3 font-bold text-ink">
          <BadgeMedal id={first.id} level={first.level} size={40} />
          <span className="flex-1">
            {fresh.length > 1
              ? tf("newLevels", { n: fresh.length })
              : first.level === 1
                ? tf("newBadge", { name: names.badge(first.id) })
                : tf("newLevel", { name: names.badge(first.id), tier: names.tier(first.level) })}
          </span>
          <FiChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
        </Link>
      )}
      {reward && (
        <Link to="/logros" className="flex items-center gap-3 border-t border-line px-4 py-3.5 text-ink first:border-t-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gold-soft text-gold">
            <FiGift size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <RewardProgress reward={reward} streak={achievements.streak.current} small />
          </div>
        </Link>
      )}
    </Card>
  );
}

// ---- Weekly summary --------------------------------------------------------------------------

function WeeklyRow({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const now = new Date();
  const { current, previous } = periodReport(profile, measurements, 7, now.getTime());
  const unit = profile.unit;
  const summary: string[] = [];
  if (current.weightKg !== null && previous.weightKg !== null) {
    summary.push(signed(fromKilograms(current.weightKg - previous.weightKg, unit), (n) => `${f.number(n)} ${unit}`));
  }
  if (current.bodyFatPct !== null && previous.bodyFatPct !== null) {
    summary.push(tf("home.weeklyFat", { delta: signed(current.bodyFatPct - previous.bodyFatPct, (n) => f.number(n)) }));
  }
  summary.push(tf("home.weeklyCount", { n: Math.min(current.count, 7) }));
  return (
    <Card padded={false}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? t("home.weeklyLess") : t("home.weeklyMore")}
        className="flex w-full items-center gap-3.5 p-4 text-left text-ink"
      >
        <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-surface-2" aria-hidden>
          <span className="text-[10px] font-extrabold text-brand-text uppercase">{now.toLocaleDateString(locale, { month: "short" }).replace(".", "")}</span>
          <span className="text-[17px] leading-4.5 font-extrabold">{now.getDate()}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-extrabold">{t("home.weeklyReady")}</span>
          <span className="text-[13px] font-semibold text-muted">{summary.join(" · ")}</span>
        </span>
        <FiChevronDown size={18} strokeWidth={2.4} className={`shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line px-4 pt-2 pb-4">
          <p className="mb-2 text-[13px] font-semibold text-ink-2">{t("weeklyIntro")}</p>
          <ReportCard profile={profile} measurements={measurements} days={7} unlock="weekly" title={t("weeklyTitle")} intro={t("weeklyIntro")} bare />
        </div>
      )}
    </Card>
  );
}

// ---- Goal details (next steps after reaching one, maintenance) --------------------------------

/** "less than a day", "9 days" or "14 weeks": how long a goal took. */
function useTook() {
  const { tf, t } = useI18n();
  return (setAt: string, reachedAt: string) => {
    const days = daysToReach(new Date(setAt), new Date(reachedAt));
    return days === 0 ? t("tookLessThanDay") : days < 14 ? tf("tookDays", { n: days }) : tf("tookWeeks", { n: Math.round(days / 7) });
  };
}

/** One goal: progress bar, distance left, starting point and the estimate at the recent pace. */
function GoalRow({
  label,
  start,
  current,
  target,
  setAt,
  reachedAt,
  points,
  format,
  children,
}: {
  label: string;
  start: number | null;
  current: number;
  target: number;
  setAt: string;
  reachedAt: string | null;
  points: { time: number; value: number }[];
  format: (n: number) => string;
  /** What comes next once the goal is reached. */
  children?: ReactNode;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const took = useTook();
  const progress = goalProgress(start, current, target);
  const eta = estimateEta(progress, dailyTrend(points));
  // != also covers goals cached offline by a version that did not have reachedAt yet.
  const reached = progress.reached || reachedAt != null;
  const etaText =
    eta.kind === "weeks"
      ? tf("goalEtaWeeks", { n: eta.weeks })
      : eta.kind === "wrong-way"
        ? t("goalEtaWrongWay")
        : eta.kind === "unknown"
          ? t("goalEtaUnknown")
          : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px] font-bold">
        <span className="text-ink-2">{label}</span>
        <span>
          {format(current)} <span className="text-muted">/ {format(target)}</span>
        </span>
      </div>
      <Progress fraction={progress.fraction} height={8} label={label} />
      {reached && reachedAt ? (
        <p className="mt-1 flex items-center gap-2 font-extrabold text-good-text">
          <FiAward size={18} aria-hidden /> {tf("goalReachedOn", { date: f.date(reachedAt), took: took(setAt, reachedAt) })}
        </p>
      ) : (
        <p className="mt-1 font-extrabold">
          {progress.reached ? t("goalReached") : tf("goalRemaining", { value: format(progress.remaining) })}
          <span className="ml-2 text-sm font-bold text-muted">{Math.round(progress.fraction * 100)} %</span>
        </p>
      )}
      {start !== null && <p className="text-xs font-semibold text-muted">{tf("goalFrom", { start: format(start), date: f.date(setAt) })}</p>}
      {!reached && etaText && <p className="text-[13px] font-semibold text-ink-2">{etaText}</p>}
      {reached && children}
    </div>
  );
}

/** A suggested next step after a goal: a button with a one-line reason. */
function NextStep({ label, hint, onClick, disabled }: { label: string; hint: string; onClick: () => void; disabled: boolean }) {
  return (
    <div>
      <Button variant="secondary" className="w-full" onClick={onClick} disabled={disabled}>
        {label}
      </Button>
      <p className="mt-1 px-1 text-xs font-semibold text-muted">{hint}</p>
    </div>
  );
}

function MaintainRow({ maintain, currentKg, unit }: { maintain: NonNullable<GoalsDto["maintain"]>; currentKg: number; unit: ProfileDto["unit"] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const side = maintainSide(maintain, currentKg);
  const bands = maintainBands(maintain, (kg) => fromKilograms(kg, unit));
  const band = bands.find((b) => b.key === (side === "above" ? "maintain-above" : side === "below" ? "maintain-below" : "maintain-in"))!;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-extrabold">{t("maintainTitle")}</p>
          <p className="text-[13px] font-semibold text-ink-2">
            {tf("maintainRange", { min: f.weight(maintain.minKg, unit), max: f.weight(maintain.maxKg, unit), center: f.weight(maintain.centerKg, unit) })}
          </p>
        </div>
        <StatusBadge band={band} />
      </div>
      <RangeBar classification={{ value: fromKilograms(currentKg, unit), bands }} format={(n) => f.number(n)} />
      <p className="mt-3 font-bold">
        {tf("maintainNow", { weight: f.weight(currentKg, unit) })}{" "}
        {side === "above" && tf("maintainAbove", { amount: f.weight(currentKg - maintain.maxKg, unit) })}
        {side === "below" && tf("maintainBelow", { amount: f.weight(maintain.minKg - currentKg, unit) })}
      </p>
      <p className="mt-1 text-xs font-semibold text-muted">{t("maintainSource")}</p>
    </div>
  );
}

function GoalsCard({ goals, measurements, profile }: { goals: GoalsDto; measurements: MeasurementDto[]; profile: ProfileDto }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const unit = profile.unit;
  const latest = measurements[0]!;
  // Body fat everywhere is the North American recalculation when the reading allows it.
  const fats = measurements.flatMap((m) => {
    const fat = bodyFatOf(profile, m);
    return fat ? [{ time: new Date(m.measuredAt).getTime(), value: fat.value }] : [];
  });
  const save = useMutation({
    mutationFn: api.saveGoals,
    onSuccess: (saved) => queryClient.setQueryData(["me"], saved),
  });
  // Changing one goal keeps the other as it is.
  const fatInput = goals.bodyFat?.targetPct ?? null;
  const weightInput = goals.weight ? { value: goals.weight.targetKg, unit: "kg" as const } : null;

  const healthy = healthyWeightRange(profile.heightCm);
  const nextWeight = nextWeightGoal(latest.weightKg, healthy.max);
  const center = Math.round(latest.weightKg * 10) / 10;
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(latest.measuredAt));
  const fatMax = bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!.max!;
  const nextFat = fats[0] ? nextBodyFatGoal(fats[0].value, fatMax) : null;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-extrabold">{t("goalsTitle")}</h2>
        <Link to="/ajustes#metas" className="py-2 text-sm font-bold text-brand-text">
          {t("editGoals")}
        </Link>
      </div>
      {goals.weight && (
        <GoalRow
          label={t("weight")}
          start={goals.weight.startKg === null ? null : fromKilograms(goals.weight.startKg, unit)}
          current={fromKilograms(latest.weightKg, unit)}
          target={fromKilograms(goals.weight.targetKg, unit)}
          setAt={goals.weight.setAt}
          reachedAt={goals.weight.reachedAt}
          points={measurements.map((m) => ({ time: new Date(m.measuredAt).getTime(), value: fromKilograms(m.weightKg, unit) }))}
          format={(n) => `${f.number(n)} ${unit}`}
        >
          <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
            <p className="text-sm font-extrabold">{t("goalNextTitle")}</p>
            {nextWeight !== null && (
              <NextStep
                label={tf("goalNextWeight", { value: f.weight(nextWeight, unit) })}
                hint={nextWeight <= Math.round(healthy.max * 10) / 10 ? t("goalNextWeightHealthy") : t("goalNextWeightHint")}
                disabled={save.isPending}
                onClick={() => save.mutate({ weight: { value: nextWeight, unit: "kg" }, bodyFatPct: fatInput, maintain: null })}
              />
            )}
            <NextStep
              label={tf("goalMaintainButton", { value: f.weight(center, unit) })}
              hint={tf("goalMaintainHint", { min: f.weight(maintainRange(center).minKg, unit), max: f.weight(maintainRange(center).maxKg, unit) })}
              disabled={save.isPending}
              onClick={() => save.mutate({ weight: null, bodyFatPct: fatInput, maintain: { value: center, unit: "kg" } })}
            />
          </div>
        </GoalRow>
      )}
      {goals.maintain && <MaintainRow maintain={goals.maintain} currentKg={latest.weightKg} unit={unit} />}
      {goals.bodyFat && fats[0] && (
        <GoalRow
          label={t("bodyFat")}
          start={goals.bodyFat.startPct}
          current={fats[0].value}
          target={goals.bodyFat.targetPct}
          setAt={goals.bodyFat.setAt}
          reachedAt={goals.bodyFat.reachedAt}
          points={fats}
          format={(n) => `${f.number(n)} %`}
        >
          {nextFat !== null && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
              <p className="text-sm font-extrabold">{t("goalNextTitle")}</p>
              <NextStep
                label={tf("goalNextFat", { value: f.number(nextFat, 0) })}
                hint={t("goalNextFatHint")}
                disabled={save.isPending}
                onClick={() => save.mutate({ weight: weightInput, bodyFatPct: nextFat })}
              />
            </div>
          )}
        </GoalRow>
      )}
      {save.error && <p className="text-sm font-semibold text-bad-text">{te(save.error)}</p>}
    </Card>
  );
}

// ---- The page --------------------------------------------------------------------------------

/** The cards of Today that can be hidden or moved, in their original order. */
const SECTIONS = ["days", "balance", "weight", "today", "minis", "news", "weekly", "goals"] as const;
type Section = (typeof SECTIONS)[number];
type Layout = { order: Section[]; hidden: Section[] };
const LAYOUT_KEY = "home-layout";
const DEFAULT_LAYOUT: Layout = { order: [...SECTIONS], hidden: [] };

/**
 * How the person arranged Today, remembered on this device (a per-device preference, like the
 * theme). Cards added in a later version join at the end, and unknown ones are dropped.
 */
function readLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    if (!saved) return DEFAULT_LAYOUT;
    const known = (list: unknown) => (Array.isArray(list) ? list.filter((s): s is Section => SECTIONS.includes(s as Section)) : []);
    const order = known(saved.order);
    return { order: [...order, ...SECTIONS.filter((s) => !order.includes(s))], hidden: known(saved.hidden) };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function useLayout(): [Layout, (layout: Layout) => void] {
  const [layout, setState] = useState<Layout>(readLayout);
  const set = (next: Layout) => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the change still applies for this visit.
    }
    setState(next);
  };
  return [layout, set];
}

/** "Editar Hoy": show or hide each card and move it up or down. */
function LayoutEditor({ layout, onChange, onClose }: { layout: Layout; onChange: (layout: Layout) => void; onClose: () => void }) {
  const { t, tf } = useI18n();
  const move = (index: number, by: -1 | 1) => {
    const order = [...layout.order];
    [order[index], order[index + by]] = [order[index + by]!, order[index]!];
    onChange({ ...layout, order });
  };
  return (
    <Modal title={t("home.edit")} onClose={onClose}>
      <p className="text-sm font-semibold text-ink-2">{t("home.editIntro")}</p>
      <ul className="mt-3 overflow-hidden rounded-[22px] border border-line">
        {layout.order.map((s, i) => {
          const name = t(`home.section.${s}` as MessageKey);
          const shown = !layout.hidden.includes(s);
          return (
            <li key={s} className="flex min-h-14 items-center gap-1 border-t border-line py-1.5 pr-3 pl-1 first:border-t-0">
              <button
                type="button"
                aria-label={tf("home.editUp", { name })}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="flex h-11 w-9 items-center justify-center text-ink-2 disabled:opacity-30"
              >
                <FiArrowUp size={18} aria-hidden />
              </button>
              <button
                type="button"
                aria-label={tf("home.editDown", { name })}
                disabled={i === layout.order.length - 1}
                onClick={() => move(i, 1)}
                className="flex h-11 w-9 items-center justify-center text-ink-2 disabled:opacity-30"
              >
                <FiArrowDown size={18} aria-hidden />
              </button>
              <span className={`min-w-0 flex-1 text-[15px] font-bold ${shown ? "text-ink" : "text-muted"}`}>{name}</span>
              <Toggle
                label={name}
                checked={shown}
                onChange={(on) => onChange({ ...layout, hidden: on ? layout.hidden.filter((h) => h !== s) : [...layout.hidden, s] })}
              />
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={onClose}>
          {t("home.editDone")}
        </Button>
        <Button variant="secondary" onClick={() => onChange(DEFAULT_LAYOUT)}>
          {t("home.editReset")}
        </Button>
      </div>
    </Modal>
  );
}

export function HomePage({
  profile,
  measurements,
  username,
  goals,
  streakReward,
  appleHealthConnected,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  username: string;
  goals: GoalsDto;
  streakReward: StreakReward | null;
  appleHealthConnected: boolean;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const achievements = useAchievementsQuery().data;
  const [layout, setLayout] = useLayout();
  const [editing, setEditing] = useState(false);
  const latest = measurements[0];
  const name = profile.displayName ?? username;

  const header = (
    <PageHeader eyebrow={capitalize(f.longDay(new Date()))} title={`${t("hello")}, ${name}`}>
      <IconLink to="/ajustes" label={t("nav.settings")}>
        <FiSliders size={20} aria-hidden />
      </IconLink>
      <Avatar to="/yo" />
    </PageHeader>
  );

  if (!latest) {
    return (
      <div className="flex flex-col gap-3.5">
        {header}
        <Card className="text-center">
          <h2 className="text-lg font-extrabold">{t("noMeasurements")}</h2>
          <p className="mt-2 text-[15px] font-medium text-ink-2">{t("noMeasurementsBody")}</p>
          <div className="mt-5 flex flex-col gap-3">
            <Link to="/ajustes" className="flex min-h-14 items-center justify-center rounded-[18px] bg-brand px-4 text-[17px] font-extrabold text-brand-ink">
              {t("connectScale")}
            </Link>
            <Link to="/agregar" className="flex min-h-13 items-center justify-center rounded-[18px] bg-surface-2 px-4 font-bold">
              {t("addManually")}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Recalculated from impedance with North American equations; Xiaomi's value only as a fallback.
  const comp = measurements.find(isFull) ?? null;
  const fat = comp ? bodyFatOf(profile, comp) : null;
  const result = assess(
    { sex: profile.sex, birthDate: new Date(`${profile.birthDate}T00:00:00Z`), heightCm: profile.heightCm },
    { measuredAt: new Date(latest.measuredAt), weightKg: latest.weightKg, bodyFatPct: fat?.value ?? null },
  );
  const best = achievements?.streak.best ?? null;
  const hasGoal = goals.weight !== null || goals.maintain !== null || goals.bodyFat !== null;

  const cards: Record<Section, ReactNode> = {
    days: <DayStrip measurements={measurements} />,
    balance: <BalanceCard profile={profile} measurements={measurements} connected={appleHealthConnected} achievements={achievements} />,
    weight: <WeightCard profile={profile} measurements={measurements} goals={goals} trendUnlocked={best !== null && best >= STREAK_UNLOCKS.trend} />,
    today: <ForToday measurements={measurements} unit={profile.unit} connected={appleHealthConnected} achievements={achievements} />,
    minis: (
      <div className="grid grid-cols-2 gap-3">
        {achievements && <StreakMini achievements={achievements} />}
        <GoalMini goals={goals} measurements={measurements} profile={profile} />
      </div>
    ),
    news: achievements ? <NewsCard username={username} achievements={achievements} reward={streakReward} /> : null,
    weekly: best !== null && best >= STREAK_UNLOCKS.weekly ? <WeeklyRow profile={profile} measurements={measurements} /> : null,
    goals: hasGoal ? <GoalsCard goals={goals} measurements={measurements} profile={profile} /> : null,
  };

  return (
    <div className="flex flex-col gap-3.5">
      {header}

      {/* Health notes about the reading always stay on top: they can change how to read the rest. */}
      {result.notes.map((note) => (
        <p key={note} className="rounded-2xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn-text">
          {t(`note.${note}` as MessageKey)}
        </p>
      ))}

      {layout.order
        .filter((s) => !layout.hidden.includes(s))
        .map((s) => (
          <Fragment key={s}>{cards[s]}</Fragment>
        ))}

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1.5 inline-flex min-h-11 items-center gap-2 self-center rounded-full border border-line px-4.5 text-sm font-bold text-ink-2 transition active:scale-95"
      >
        <FiGrid size={16} aria-hidden />
        {t("home.edit")}
      </button>
      {editing && <LayoutEditor layout={layout} onChange={setLayout} onClose={() => setEditing(false)} />}
    </div>
  );
}
