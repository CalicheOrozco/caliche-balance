import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { FiCheck, FiChevronDown, FiChevronLeft, FiChevronRight, FiSettings } from "react-icons/fi";
import { Link } from "react-router";
import type { HealthDayDto } from "../../shared/health.ts";
import { healthTargets, type PersonFacts } from "../../shared/healthReference.ts";
import { ageAt } from "../../shared/reference.ts";
import { fromKilograms, type MeasurementDto, type UserDto } from "../../shared/schemas.ts";
import { api, useMeasurements } from "../api.ts";
import { AppleHealthCard, HealthTodayCard, lastActiveIndex, nightScore, SleepCard, useHealthDays } from "../appleHealth.tsx";
import { type Row, type Series, TrendChart } from "../charts.tsx";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { BulbIcon } from "../icons.tsx";
import { Avatar, BackLink, Card, PageHeader, Rings, SectionHeader, Segmented, signed, useFormat } from "../ui.tsx";

type RangeKey = "30" | "90" | "365";

/** Used when there is no weigh-in yet to work out the person's own targets. */
const DEFAULT_ACTIVE_KCAL = Math.round(2_000 / 7);
const DEFAULT_STEPS = 8_000;
/** 150 minutes a week (US and Canadian guidelines) over five days. */
const EXERCISE_GOAL_MIN = 30;
/** Days in each group before comparing nights after active and quiet days. */
const INSIGHT_MIN_DAYS = 5;

/** The date in the list closest to the one asked for (dates are "yyyy-MM-dd", oldest first). */
function closestDate(dates: string[], wanted: string): string {
  const at = Date.parse(`${wanted}T12:00:00Z`);
  return dates.reduce((best, d) => (Math.abs(Date.parse(`${d}T12:00:00Z`) - at) < Math.abs(Date.parse(`${best}T12:00:00Z`) - at) ? d : best), dates[0]!);
}

const localIso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** "hace 5 min" / "5 min ago", from the last time the Shortcut sent data. */
function useAgo() {
  const { locale } = useI18n();
  return (iso: string) => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    const min = Math.round((Date.parse(iso) - Date.now()) / 60_000);
    if (Math.abs(min) < 60) return rtf.format(min, "minute");
    const h = Math.round(min / 60);
    if (Math.abs(h) < 24) return rtf.format(h, "hour");
    return rtf.format(Math.round(h / 24), "day");
  };
}

/** Move, exercise and steps against the goals recommended for this person, as three rings. */
function RingsCard({ day, targets }: { day: HealthDayDto; targets: { kcal: number; steps: number } }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const rings = [
    { key: "move", label: t("act.ringMove"), value: day.activeKcal, goal: targets.kcal, unit: "kcal", dot: "bg-brand", stroke: "stroke-brand" },
    { key: "exercise", label: t("act.ringExercise"), value: day.exerciseMin, goal: EXERCISE_GOAL_MIN, unit: "min", dot: "bg-ring-2", stroke: "stroke-ring-2" },
    { key: "steps", label: t("act.ringSteps"), value: day.steps, goal: targets.steps, unit: "", dot: "bg-ring-3", stroke: "stroke-ring-3" },
  ];
  if (rings.every((r) => r.value === null)) return null;
  const pct = (r: (typeof rings)[number]) => Math.round(((r.value ?? 0) / r.goal) * 100);
  return (
    <Card>
      <div className="flex items-center gap-4.5">
        <Rings
          rings={rings.map((r) => ({ fraction: (r.value ?? 0) / r.goal, className: r.stroke }))}
          size={120}
          stroke={11}
          gap={2}
          label={tf("act.ringsLabel", { move: pct(rings[0]!), exercise: pct(rings[1]!), steps: pct(rings[2]!) })}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          {rings.map((r) => (
            <div key={r.key} className="flex flex-col">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-2">
                <span className={`h-2 w-2 rounded-full ${r.dot}`} aria-hidden />
                {r.label}
              </span>
              <span className="text-[17px] font-extrabold">
                {r.value === null ? "-" : f.number(r.value, 0)}
                <span className="text-[13px] text-muted">
                  {" "}
                  / {f.number(r.goal, 0)}
                  {r.unit && ` ${r.unit}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs font-semibold text-muted">{tf("act.ringsNote", { kcal: f.number(targets.kcal, 0), steps: f.number(targets.steps, 0) })}</p>
    </Card>
  );
}

/** One bar of a steps chart: its axis label, its name when picked, and the steps (null: no data). */
interface StepBar {
  key: string;
  axis: string;
  name: string;
  value: number | null;
}

/**
 * Tappable step bars with the goal as a dashed line. Tapping a bar shows its steps in the big
 * number (a tap works on a phone, where there is no hover); tapping it again goes back to the
 * default bar. Long charts label only some bars so the letters do not run together.
 */
function StepBars({
  bars,
  goal,
  title,
  pickedTitle,
  aside,
  hint,
  footer,
  labelEvery = 1,
  alwaysName = false,
}: {
  bars: StepBar[];
  goal: number;
  title: string;
  pickedTitle: (bar: StepBar) => string;
  aside?: string;
  hint: string;
  footer?: ReactNode;
  labelEvery?: number;
  /** Name the bar behind the big number even before a tap (charts where the default is not obvious). */
  alwaysName?: boolean;
}) {
  const { tf } = useI18n();
  const f = useFormat();
  // Until a bar is tapped, the big number is the newest bar with steps (today may have none yet).
  const fallback = [...bars].reverse().find((b) => b.value !== null) ?? bars[bars.length - 1];
  const [picked, setPicked] = useState<string | null>(null);
  // New bars (another day with the arrows, another view) start the chart fresh.
  const first = bars[0]?.key;
  useEffect(() => setPicked(null), [fallback?.key, first, bars.length]);
  const values = bars.flatMap((b) => (b.value === null ? [] : [b.value]));
  if (!fallback || values.length === 0) return null;
  const current = bars.find((b) => b.key === picked) ?? fallback;
  const BARS = 90;
  const top = Math.max(goal * 1.375, ...values);
  const h = (v: number) => Math.max(Math.round((v / top) * BARS), 4);
  const dense = bars.length > 12;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-bold text-ink-2 first-letter:uppercase" aria-live="polite">
            {picked || alwaysName ? pickedTitle(current) : title}
          </span>
          <span className="text-[28px] leading-8 font-extrabold">{current.value === null ? "-" : f.number(current.value, 0)}</span>
        </div>
        {aside && <span className="shrink-0 text-[13px] font-bold text-muted">{aside}</span>}
      </div>
      <div className={`relative flex h-27.5 items-end ${dense ? "gap-0.5" : "gap-2"}`} role="group" aria-label={tf("act.stepsChart", { goal: f.number(goal, 0) })}>
        <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-line-strong" style={{ bottom: h(goal) + 22 }} aria-hidden />
        <span className="pointer-events-none absolute right-0 text-[10px] font-extrabold text-muted" style={{ bottom: h(goal) + 26 }} aria-hidden>
          {f.number(goal, 0)}
        </span>
        {bars.map((b, i) => {
          const active = b.key === current.key;
          // Count from the newest bar so the latest always has its label.
          const labeled = (bars.length - 1 - i) % labelEvery === 0;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setPicked(b.key === picked || b.key === fallback.key ? null : b.key)}
              aria-pressed={active}
              aria-label={b.value === null ? tf("act.stepsBarNone", { day: b.name }) : tf("act.stepsBar", { day: b.name, n: f.number(b.value, 0) })}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5 rounded-lg outline-offset-2 transition active:scale-95"
            >
              <span
                className={`w-full transition-opacity ${dense ? "rounded-sm" : "rounded-lg"} ${(b.value ?? 0) >= goal ? "bg-brand" : "bg-good-band"} ${picked && !active ? "opacity-45" : ""}`}
                style={{ height: b.value === null ? 0 : h(b.value) }}
              />
              <span className={`h-4 text-[11px] font-bold whitespace-nowrap ${active ? "text-ink" : "text-muted"}`}>{labeled || active ? b.axis : ""}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs font-semibold text-muted">{hint}</p>
      {footer}
    </Card>
  );
}

/** Steps on the 7 days up to the one shown, with a way to the full history. */
function StepsCard({ days, goal, todayIso }: { days: HealthDayDto[]; goal: number; todayIso: string }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const withSteps = days.filter((d) => d.steps !== null);
  if (withSteps.length === 0) return null;
  const avg = withSteps.reduce((s, d) => s + d.steps!, 0) / withSteps.length;
  const dayName = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" });
  return (
    <StepBars
      goal={goal}
      title={t("act.stepsTitle")}
      pickedTitle={(b) => tf("act.stepsOn", { day: b.name })}
      aside={tf("act.stepsAvg", { n: f.number(avg, 0) })}
      hint={t("act.stepsHint")}
      bars={days.map((d) => ({
        key: d.date,
        axis: d.date === todayIso ? t("dayToday") : new Date(`${d.date}T12:00:00`).toLocaleDateString(locale, { weekday: "narrow" }),
        name: dayName(d.date),
        value: d.steps,
      }))}
      footer={
        <Link to="/actividad/pasos" className="-mb-1 flex min-h-11 items-center justify-center gap-1 rounded-2xl bg-surface-2 text-sm font-bold text-ink">
          {t("act.stepsHistory")} <FiChevronRight size={16} strokeWidth={2.4} aria-hidden />
        </Link>
      }
    />
  );
}

/** A small line of the values over time, scaled to fill the box. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 128).toFixed(1)} ${(4 + ((max - v) / (max - min || 1)) * 28).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 128 36" preserveAspectRatio="none" className="block h-9 w-full overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Resting heart rate or heart rate variability: the day's value, its line and how it changed. */
function HeartCard({ days, metric, unit, lowerIsBetter }: { days: HealthDayDto[]; metric: "restingHr" | "hrvMs"; unit: string; lowerIsBetter: boolean }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const points = days.flatMap((d) => (d[metric] !== null ? [{ date: d.date, v: d[metric]! }] : []));
  const last = points[points.length - 1];
  if (!last) return null;
  // The first week's average against the last week's, so one odd reading does not set the change.
  const avg = (xs: { v: number }[]) => xs.reduce((s, x) => s + x.v, 0) / xs.length;
  const change = points.length >= 14 ? avg(points.slice(-7)) - avg(points.slice(0, 7)) : null;
  const good = change !== null && (lowerIsBetter ? change < 0 : change > 0);
  return (
    <Card className="flex flex-col gap-1.5 rounded-3xl! p-4!">
      <p className="text-[13px] font-bold text-ink-2">{t(`ahMetric.${metric}` as MessageKey)}</p>
      <p className="flex items-baseline gap-1">
        <span className="text-[26px] leading-7.5 font-extrabold">{f.number(last.v, 0)}</span>
        <span className="text-[13px] font-bold text-muted">{unit}</span>
      </p>
      <Sparkline values={points.map((p) => p.v)} />
      {change !== null && (
        <p className={`text-xs font-bold ${good ? "text-good-text" : "text-ink-2"}`}>
          {tf("act.change", { delta: `${signed(change, (n) => f.number(n, 0))} ${unit}`, date: f.date(`${points[0]!.date}T12:00:00`) })}
        </p>
      )}
    </Card>
  );
}

/**
 * Sleep on the nights after days at the step goal against the nights after quieter days, from the
 * person's own data. Shown only with enough days on both sides and a difference worth telling.
 */
function stepsSleepInsight(days: HealthDayDto[], goal: number): { diffMin: number; n: number; m: number } | null {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const active: number[] = [];
  const quiet: number[] = [];
  for (const d of days) {
    if (!d.steps) continue;
    // A night is filed on the day you woke up: the one after this day.
    const next = byDate.get(localIso(Date.parse(`${d.date}T12:00:00`) + 86_400_000));
    if (!next?.sleep || next.sleep.asleepMin <= 0) continue;
    (d.steps >= goal ? active : quiet).push(next.sleep.asleepMin);
  }
  if (active.length < INSIGHT_MIN_DAYS || quiet.length < INSIGHT_MIN_DAYS) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const diffMin = Math.round(mean(active) - mean(quiet));
  return Math.abs(diffMin) >= 10 ? { diffMin, n: active.length, m: quiet.length } : null;
}

/**
 * The other half of the steps insight: how the weight moved from a day to the next morning after
 * days at the step goal, against quieter days. Only days weighed on both ends count; the first
 * weigh-in of each day is used, the closest to a fasting morning weight.
 */
function stepsWeightInsight(
  days: HealthDayDto[],
  measurements: MeasurementDto[],
  goal: number,
): { activeKg: number; quietKg: number; n: number; m: number } | null {
  const morning = new Map<string, number>();
  // Oldest first, so the first weigh-in of each day is the one kept.
  for (const m of [...measurements].reverse()) {
    const day = localIso(Date.parse(m.measuredAt));
    if (!morning.has(day)) morning.set(day, m.weightKg);
  }
  const active: number[] = [];
  const quiet: number[] = [];
  for (const d of days) {
    if (!d.steps) continue;
    const today = morning.get(d.date);
    const next = morning.get(localIso(Date.parse(`${d.date}T12:00:00`) + 86_400_000));
    if (today === undefined || next === undefined) continue;
    (d.steps >= goal ? active : quiet).push(next - today);
  }
  if (active.length < INSIGHT_MIN_DAYS || quiet.length < INSIGHT_MIN_DAYS) return null;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const activeKg = mean(active);
  const quietKg = mean(quiet);
  return Math.abs(activeKg - quietKg) >= 0.05 ? { activeKg, quietKg, n: active.length, m: quiet.length } : null;
}

function InsightCard({ title, children }: { title: string; children: string }) {
  return (
    <section className="flex items-start gap-3 rounded-3xl bg-hero p-4.5 text-hero-ink">
      <BulbIcon size={20} className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-extrabold">{title}</p>
        <p className="text-[13px] leading-4.75 font-semibold text-hero-muted">{children}</p>
      </div>
    </section>
  );
}

/** The person's own daily targets for active calories and steps, from the profile and the latest weigh-in. */
function useActivityGoals(user: UserDto) {
  const measurements = useMeasurements().data ?? [];
  const latestWeight = measurements[0]?.weightKg;
  const profile = user.profile;
  const person: PersonFacts | undefined =
    profile && latestWeight !== undefined
      ? { sex: profile.sex, age: ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date()), heightCm: profile.heightCm, weightKg: latestWeight }
      : undefined;
  const targets = person ? healthTargets(person) : null;
  return { measurements, person, targets, goals: { kcal: targets?.activeDayKcal ?? DEFAULT_ACTIVE_KCAL, steps: targets?.steps[0] ?? DEFAULT_STEPS } };
}

/** Everything from Apple Health: last night, the day's rings and steps, the heart, and how each measure moves. */
export function ActivityPage({ user }: { user: UserDto }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const ago = useAgo();
  const connected = user.appleHealth != null;
  const [picked, setPicked] = useState<string | null>(null);
  // Who the recommendations are for: the profile and the latest weigh-in.
  const { measurements, person, targets, goals } = useActivityGoals(user);
  const profile = user.profile;
  const [range, setRange] = useState<RangeKey>("30");
  const cutoff = Date.now() - Number(range) * 24 * 60 * 60 * 1000;
  // Days at local noon so each sits on its own day.
  const healthDays = useHealthDays(connected).data ?? [];
  const healthRows = useMemo<Row[]>(
    () =>
      healthDays
        .map((d, i) => ({
          t: new Date(`${d.date}T12:00:00`).getTime(),
          sleepScore: nightScore(healthDays, i)?.score ?? null,
          steps: d.steps,
          exerciseMin: d.exerciseMin,
          restingHr: d.restingHr,
          hrvMs: d.hrvMs,
          standMin: d.standMin,
          totalKcal: d.activeKcal !== null && d.restingKcal !== null ? d.activeKcal + d.restingKcal : null,
          sleepHours: d.sleep && d.sleep.asleepMin > 0 ? d.sleep.asleepMin / 60 : null,
        }))
        .filter((r) => r.t >= cutoff),
    [healthDays, cutoff],
  );
  const insight = useMemo(() => stepsSleepInsight(healthDays, goals.steps), [healthDays, goals.steps]);
  const weightInsight = useMemo(() => stepsWeightInsight(healthDays, measurements, goals.steps), [healthDays, measurements, goals.steps]);
  const unit = profile?.unit ?? "kg";
  const kg = (n: number) => `${signed(fromKilograms(n, unit), (x) => f.number(x))} ${unit}`;
  const one = (key: string, label: string): Series[] => [{ key, label, kind: "caliche" }];
  // The day picker walks the days Health sent; it starts on the last one with activity or sleep.
  const dates = healthDays.map((d) => d.date);
  const start = Math.max(lastActiveIndex(healthDays), healthDays.findLastIndex((d) => d.sleep));
  const date = picked ?? dates[start] ?? dates[dates.length - 1];
  const at = date ? dates.indexOf(date) : -1;
  const day = at === -1 ? undefined : healthDays[at];
  const todayIso = localIso(Date.now());
  const yesterdayIso = localIso(Date.now() - 86_400_000);
  const longDay = (iso: string) => f.longDay(new Date(`${iso}T12:00:00`));
  const dayLabel = (iso: string) =>
    iso === todayIso ? `${t("dayToday")}, ${longDay(iso)}` : iso === yesterdayIso ? `${t("dayYesterday")}, ${longDay(iso)}` : longDay(iso);
  const lastSync = user.appleHealth?.lastSyncAt ?? null;

  const header = (
    <PageHeader title={t("nav.activity")} subtitle={lastSync ? tf("act.source", { when: ago(lastSync) }) : t("act.sourceNever")}>
      <Avatar to="/yo" />
    </PageHeader>
  );

  if (!connected) {
    return (
      <div className="flex flex-col gap-3.5">
        {header}
        <AppleHealthCard user={user} />
      </div>
    );
  }

  const upTo = at === -1 ? [] : healthDays.slice(0, at + 1);

  return (
    <div className="flex flex-col gap-3.5">
      {header}
      {date && (
        <div className="flex items-center gap-2 rounded-[18px] bg-surface-2 p-1">
          <button
            type="button"
            aria-label={t("dayPrev")}
            disabled={at <= 0}
            onClick={() => setPicked(dates[at - 1]!)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-ink transition active:scale-95 disabled:opacity-40"
          >
            <FiChevronLeft size={20} strokeWidth={2.4} aria-hidden />
          </button>
          <div className="min-w-0 flex-1 text-center text-[15px] font-extrabold">
            <DatePicker
              label={t("activityPickDay")}
              trigger={<span className="first-letter:uppercase">{dayLabel(date)}</span>}
              value={date}
              required
              minDate={new Date(`${dates[0]}T12:00:00`)}
              maxDate={new Date(`${dates[dates.length - 1]}T12:00:00`)}
              // A day without data jumps to the closest one that has it.
              onChange={(v) => v && setPicked(closestDate(dates, v))}
            />
          </div>
          <button
            type="button"
            aria-label={t("dayNext")}
            disabled={at === -1 || at >= dates.length - 1}
            onClick={() => setPicked(dates[at + 1]!)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-ink transition active:scale-95 disabled:opacity-40"
          >
            <FiChevronRight size={20} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
      )}
      <SleepCard connected={connected} date={date} />
      {day && <RingsCard day={day} targets={goals} />}
      {day && <StepsCard days={upTo.slice(-7)} goal={goals.steps} todayIso={todayIso} />}
      {upTo.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <HeartCard days={upTo} metric="restingHr" unit={t("ahBpm")} lowerIsBetter />
          <HeartCard days={upTo} metric="hrvMs" unit="ms" lowerIsBetter={false} />
        </div>
      )}
      {insight ? (
        <InsightCard title={insight.diffMin > 0 ? t("act.insightMoreTitle") : t("act.insightLessTitle")}>
          {tf(insight.diffMin > 0 ? "act.insightMore" : "act.insightLess", {
            steps: f.number(goals.steps, 0),
            min: Math.abs(insight.diffMin),
            n: insight.n,
            m: insight.m,
          }) +
            (weightInsight
              ? ` ${tf("act.insightWeight", { active: kg(weightInsight.activeKg), quiet: kg(weightInsight.quietKg), n: weightInsight.n, m: weightInsight.m })}`
              : "")}
        </InsightCard>
      ) : (
        <InsightCard title={t("tip.move.title")}>{t("tip.move.body")}</InsightCard>
      )}
      <SectionHeader title={t("act.allHealth")} />
      <HealthTodayCard connected={connected} expanded date={date} person={person} unit={user.profile?.unit} />
      {healthRows.length > 0 && (
        <>
          <SectionHeader title={t("activityCharts")} />
          <Segmented
            label={t("range")}
            value={range}
            onChange={setRange}
            options={(["30", "90", "365"] as const).map((r) => ({ value: r, label: t(`range.${r}` as MessageKey) }))}
          />
          <TrendChart
            title={t("sleepScoreTitle")}
            rows={healthRows}
            series={one("sleepScore", t("sleepScoreTitle"))}
            band={{ min: 80, max: 100 }}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n, 0)}
            about={t("sleepScoreNote")}
          />
          <TrendChart
            title={`${t("sleepTitle")} (h)`}
            rows={healthRows}
            series={one("sleepHours", t("sleepTitle"))}
            band={{ min: 7, max: 9 }}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n)}
            unit=" h"
            about={t("about.ah.sleep")}
          />
          <TrendChart
            title={`${t("ahTotalKcal")} (kcal)`}
            rows={healthRows}
            series={one("totalKcal", t("ahTotalKcal"))}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n, 0)}
            unit=" kcal"
            about={t("about.ah.totalKcal")}
          />
          <TrendChart
            title={t("ahMetric.steps")}
            rows={healthRows}
            series={one("steps", t("ahMetric.steps"))}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n, 0)}
            about={t("about.ah.steps")}
          />
          <TrendChart
            title={`${t("ahMetric.exerciseMin")} (min)`}
            rows={healthRows}
            series={one("exerciseMin", t("ahMetric.exerciseMin"))}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n, 0)}
            unit=" min"
            about={t("about.ah.exerciseMin")}
          />
          <TrendChart
            title={`${t("ahMetric.restingHr")} (${t("ahBpm")})`}
            rows={healthRows}
            series={one("restingHr", t("ahMetric.restingHr"))}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n, 0)}
            unit={` ${t("ahBpm")}`}
            about={t("about.ah.restingHr")}
          />
          <TrendChart
            title={`${t("ahMetric.hrvMs")} (ms)`}
            rows={healthRows}
            series={one("hrvMs", t("ahMetric.hrvMs"))}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n, 0)}
            unit=" ms"
            about={t("about.ah.hrvMs")}
          />
          <TrendChart
            title={`${t("ahMetric.standMin")} (min)`}
            rows={healthRows}
            series={one("standMin", t("ahMetric.standMin"))}
            formatTick={(n) => f.number(n, 0)}
            formatValue={(n) => f.number(n, 0)}
            unit=" min"
            about={t("about.ah.standMin")}
          />
        </>
      )}
      <Link to="/ajustes" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 py-2.5 font-bold text-ink">
        <FiSettings aria-hidden /> {t("activitySettings")}
      </Link>
    </div>
  );
}

/** Days kept by the server, a little over a year. */
const HISTORY_DAYS = 400;

type StepsView = "days" | "weeks" | "months";

/** Monday of a "yyyy-MM-dd" day, as "yyyy-MM-dd". */
function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Days with steps grouped by a key, with their daily average. */
function groupSteps(days: HealthDayDto[], keyOf: (date: string) => string) {
  const groups = new Map<string, number[]>();
  for (const d of days) if (d.steps !== null) groups.set(keyOf(d.date), [...(groups.get(keyOf(d.date)) ?? []), d.steps]);
  return [...groups].map(([key, steps]) => ({ key, steps, avg: steps.reduce((a, b) => a + b, 0) / steps.length }));
}

/** Every day of steps Apple Health has sent: by day, week or month, totals, and month by month. */
export function StepsHistoryPage({ user }: { user: UserDto }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const connected = user.appleHealth != null;
  const { goals } = useActivityGoals(user);
  const goal = goals.steps;
  const [view, setView] = useState<StepsView>("days");
  const query = useQuery({ queryKey: ["apple-health", "days", HISTORY_DAYS], queryFn: () => api.healthDays(HISTORY_DAYS), enabled: connected });
  // Oldest first, only days with steps.
  const days = useMemo(() => (query.data ?? []).filter((d) => d.steps !== null).sort((a, b) => a.date.localeCompare(b.date)), [query.data]);
  const todayIso = localIso(Date.now());
  const dayName = (date: string, month: "short" | "long" = "short") =>
    new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month });
  const monthName = (key: string) => new Date(`${key}-15T12:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });

  const bars = useMemo<StepBar[]>(() => {
    if (view === "days") {
      // The last 30 calendar days, with gaps where nothing arrived.
      const byDate = new Map(days.map((d) => [d.date, d.steps]));
      return Array.from({ length: 30 }, (_, i) => {
        const date = localIso(Date.now() - (29 - i) * 86_400_000);
        return {
          key: date,
          axis: date === todayIso ? t("dayToday") : String(Number(date.slice(8))),
          name: dayName(date),
          value: byDate.get(date) ?? null,
        };
      });
    }
    if (view === "weeks") {
      return groupSteps(days, mondayOf)
        .slice(-26)
        .map((w) => {
          const label = new Date(`${w.key}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" });
          return { key: w.key, axis: label, name: tf("act.stepsWeekAvg", { date: label }), value: Math.round(w.avg) };
        });
    }
    return groupSteps(days, (d) => d.slice(0, 7)).map((m) => ({
      key: m.key,
      axis: new Date(`${m.key}-15T12:00:00`).toLocaleDateString(locale, { month: "narrow" }),
      name: tf("act.stepsMonthAvg", { month: monthName(m.key) }),
      value: Math.round(m.avg),
    }));
  }, [view, days, locale]);

  const header = (
    <>
      <BackLink to="/actividad" label={t("nav.activity")} />
      <div className="flex flex-col gap-0.5 px-1">
        <h1 className="text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{t("act.stepsHistoryTitle")}</h1>
        {days[0] && (
          <p className="text-[13px] font-semibold text-muted">
            {tf("act.stepsHistorySince", { n: f.number(days.length, 0), date: new Date(`${days[0].date}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }) })}
          </p>
        )}
      </div>
    </>
  );
  if (query.isPending && connected) return <div className="flex flex-col gap-3.5">{header}<p className="py-10 text-center text-muted">…</p></div>;
  if (days.length === 0) {
    return (
      <div className="flex flex-col gap-3.5">
        {header}
        <Card className="text-center text-[15px] font-semibold text-ink-2">{t("act.stepsNone")}</Card>
      </div>
    );
  }

  const total = days.reduce((s, d) => s + d.steps!, 0);
  const best = days.reduce((a, b) => (b.steps! > a.steps! ? b : a));
  const atGoal = days.filter((d) => d.steps! >= goal).length;
  const months = groupSteps(days, (d) => d.slice(0, 7)).reverse();
  const stat = (label: string, value: string, sub?: string) => (
    <div className="flex flex-col gap-0.5 rounded-[20px] border border-line bg-surface p-4 shadow-card">
      <span className="text-[13px] font-bold text-ink-2">{label}</span>
      <span className="text-[22px] leading-7 font-extrabold">{value}</span>
      {sub && <span className="text-xs font-semibold text-muted first-letter:uppercase">{sub}</span>}
    </div>
  );

  return (
    <div className="flex flex-col gap-3.5">
      {header}
      <Segmented
        label={t("act.stepsView")}
        value={view}
        onChange={setView}
        options={[
          { value: "days", label: t("act.stepsViewDays") },
          { value: "weeks", label: t("act.stepsViewWeeks") },
          { value: "months", label: t("act.stepsViewMonths") },
        ]}
      />
      <StepBars
        bars={bars}
        goal={goal}
        title={t("act.stepsTitle")}
        aside={view === "days" ? t("act.stepsLast30") : view === "weeks" ? t("act.stepsViewWeeks") : t("act.stepsViewMonths")}
        alwaysName
        pickedTitle={(b) => (view === "days" ? tf("act.stepsOn", { day: b.name }) : b.name)}
        hint={view === "days" ? t("act.stepsHint") : view === "weeks" ? t("act.stepsHintWeeks") : t("act.stepsHintMonths")}
        labelEvery={view === "days" ? 5 : view === "weeks" ? 4 : 1}
      />
      <div className="grid grid-cols-2 gap-3">
        {stat(t("act.stepsStatAvg"), f.number(total / days.length, 0))}
        {stat(t("act.stepsStatBest"), f.number(best.steps!, 0), dayName(best.date))}
        {stat(t("act.stepsStatGoal"), tf("act.stepsStatGoalValue", { n: f.number(atGoal, 0), total: f.number(days.length, 0) }), `${Math.round((atGoal / days.length) * 100)} %`)}
        {stat(t("act.stepsStatTotal"), f.number(total, 0))}
      </div>

      <SectionHeader title={t("act.stepsByMonth")} />
      <div className="flex flex-col gap-2.5">
        {months.map((m, i) => {
          const monthDays = days.filter((d) => d.date.startsWith(m.key)).reverse();
          const hits = monthDays.filter((d) => d.steps! >= goal).length;
          return (
            <details key={m.key} open={i === 0} className="group overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
              <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-extrabold first-letter:uppercase">{monthName(m.key)}</span>
                  <span className="text-xs font-semibold text-muted">
                    {tf("act.stepsMonthSummary", { avg: f.number(m.avg, 0), n: hits, total: monthDays.length })}
                  </span>
                </span>
                <FiChevronDown size={18} strokeWidth={2.4} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
              </summary>
              <ul>
                {monthDays.map((d) => {
                  const hit = d.steps! >= goal;
                  return (
                    <li key={d.date} className="flex min-h-12 items-center gap-3 border-t border-line px-4 py-2">
                      <span className="min-w-0 flex-1 text-sm font-semibold text-ink-2 first-letter:uppercase">{dayName(d.date)}</span>
                      <span className="text-[15px] font-extrabold">{f.number(d.steps!, 0)}</span>
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${hit ? "bg-good-soft text-good-text" : ""}`}
                        title={hit ? t("act.stepsAtGoal") : undefined}
                      >
                        {hit && <FiCheck size={13} strokeWidth={3} aria-label={t("act.stepsAtGoal")} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>
      <p className="px-1 text-xs font-semibold text-muted">{t("act.stepsYearNote")}</p>
    </div>
  );
}
