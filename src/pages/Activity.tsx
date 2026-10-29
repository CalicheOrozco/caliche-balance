import { useMemo, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiSettings } from "react-icons/fi";
import { Link } from "react-router";
import { ageAt } from "../../shared/reference.ts";
import type { UserDto } from "../../shared/schemas.ts";
import { useMeasurements } from "../api.ts";
import { AppleHealthCard, HealthTodayCard, lastActiveIndex, nightScore, SleepCard, useHealthDays } from "../appleHealth.tsx";
import { type Row, type Series, TrendChart } from "../charts.tsx";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { Segmented, useFormat } from "../ui.tsx";

type RangeKey = "30" | "90" | "365";

/** The date in the list closest to the one asked for (dates are "yyyy-MM-dd", oldest first). */
function closestDate(dates: string[], wanted: string): string {
  const at = Date.parse(`${wanted}T12:00:00Z`);
  return dates.reduce((best, d) => (Math.abs(Date.parse(`${d}T12:00:00Z`) - at) < Math.abs(Date.parse(`${best}T12:00:00Z`) - at) ? d : best), dates[0]!);
}

/** Everything from Apple Health: last night, the latest day in full, and how each measure moves. */
export function ActivityPage({ user }: { user: UserDto }) {
  const { t, locale } = useI18n();
  const f = useFormat();
  const connected = user.appleHealth != null;
  const [picked, setPicked] = useState<string | null>(null);
  // Who the recommendations are for: the profile and the latest weigh-in.
  const latestWeight = useMeasurements().data?.[0]?.weightKg;
  const profile = user.profile;
  const person =
    profile && latestWeight !== undefined
      ? { sex: profile.sex, age: ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date()), heightCm: profile.heightCm, weightKg: latestWeight }
      : undefined;
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
  const one = (key: string, label: string): Series[] => [{ key, label, kind: "caliche" }];
  // The day picker walks the days Health sent; it starts on the last one with activity or sleep.
  const dates = healthDays.map((d) => d.date);
  const start = Math.max(lastActiveIndex(healthDays), healthDays.findLastIndex((d) => d.sleep));
  const date = picked ?? dates[start] ?? dates[dates.length - 1];
  const at = date ? dates.indexOf(date) : -1;
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const yesterdayIso = new Date(Date.now() - 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const dayLabel = (iso: string) =>
    iso === todayIso
      ? t("dayToday")
      : iso === yesterdayIso
        ? t("dayYesterday")
        : new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" });

  if (!connected) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t("nav.activity")}</h1>
        <AppleHealthCard user={user} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("nav.activity")}</h1>
      {date && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface p-1.5">
          <button
            type="button"
            aria-label={t("dayPrev")}
            disabled={at <= 0}
            onClick={() => setPicked(dates[at - 1]!)}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink disabled:opacity-30"
          >
            <FiChevronLeft size={20} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
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
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-ink disabled:opacity-30"
          >
            <FiChevronRight size={20} aria-hidden />
          </button>
        </div>
      )}
      <SleepCard connected={connected} date={date} />
      <HealthTodayCard connected={connected} expanded date={date} person={person} unit={user.profile?.unit} />
      {healthRows.length > 0 && (
        <>
          <Segmented
            label={t("range")}
            value={range}
            onChange={setRange}
            options={(["30", "90", "365"] as const).map((r) => ({ value: r, label: t(`range.${r}` as MessageKey) }))}
          />
<h2 className="px-1 pt-2 text-lg font-semibold">{t("activityCharts")}</h2>
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
      <Link to="/ajustes" className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 py-2.5 font-medium text-ink">
        <FiSettings aria-hidden /> {t("activitySettings")}
      </Link>
    </div>
  );
}
