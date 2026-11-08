import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiBarChart2, FiChevronRight, FiInfo } from "react-icons/fi";
import { Link } from "react-router";
import { STREAK_UNLOCKS } from "../../shared/achievements.ts";
import { metabolicAge } from "../../shared/bodyAge.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { ageAt, bmi, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { type ReportItemKey, readingReport } from "../../shared/report.ts";
import { CM_PER_IN, fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { exerciseFatPattern, type HabitPattern, sleepWeightPattern } from "../../shared/patterns.ts";
import { scoreOf } from "../../shared/score.ts";
import { weightTrend } from "../../shared/trend.ts";
import { api, useMe } from "../api.ts";
import { backFromHistory } from "../backTo.ts";
import { useAdvice } from "../advice.ts";
import { type LinePoint, LineChartSvg, type Row, type Series, Spark, TrendChart } from "../charts.tsx";
import { useCompareXiaomi } from "../compare.ts";
import { BulbIcon } from "../icons.tsx";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { ReportCard, useBestStreak } from "../reports.tsx";
import { BackLink, Button, Callout, Card, DeltaPill, Segmented, SectionHeader, Switch, signed, useFormat } from "../ui.tsx";
import { BodyTop, isFull, useCountSince, ExportButton } from "./Body.tsx";

type RangeKey = "30" | "90" | "180" | "365" | "all";
const RANGES: RangeKey[] = ["30", "90", "180", "365", "all"];
const DAY = 24 * 60 * 60 * 1000;

type Props = { profile: ProfileDto; measurements: MeasurementDto[]; goals: GoalsDto };

/** "en 3 meses" for the period picked, to follow a change. */
function usePeriodText(range: RangeKey) {
  const { t } = useI18n();
  return t(`body.period.${range}` as MessageKey);
}

/**
 * Day-of-week pattern: how far each weekday's weigh-ins sit from the mean of their own week.
 * Only weeks with three or more weigh-ins count, and a weekday needs two such weeks; with fewer
 * than three weeks there is no pattern to tell. Monday first.
 */
function weekdayPattern(points: { t: number; v: number }[]): (number | null)[] | null {
  const weeks = new Map<number, { day: number; v: number }[]>();
  for (const p of points) {
    const d = new Date(p.t);
    const day = (d.getDay() + 6) % 7;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
    weeks.set(monday, [...(weeks.get(monday) ?? []), { day, v: p.v }]);
  }
  const sums = Array.from({ length: 7 }, () => ({ total: 0, n: 0 }));
  let used = 0;
  for (const list of weeks.values()) {
    if (list.length < 3) continue;
    used += 1;
    const mean = list.reduce((s, x) => s + x.v, 0) / list.length;
    for (const x of list) {
      sums[x.day]!.total += x.v - mean;
      sums[x.day]!.n += 1;
    }
  }
  if (used < 3) return null;
  return sums.map((s) => (s.n >= 2 ? s.total / s.n : null));
}

/** "2026-11-06" on the person's own calendar, to line weigh-ins up with Apple Health days. */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Sleep and exercise patterns over all the weigh-ins (not only the chosen period: they need many
 * weeks), from up to a year of Apple Health days. Nothing when Apple Health is not connected.
 */
function useHealthPatterns(profile: ProfileDto, measurements: MeasurementDto[]) {
  const connected = useMe().data?.appleHealth != null;
  const days = useQuery({ queryKey: ["apple-health", "days", 365], queryFn: () => api.healthDays(365), enabled: connected }).data;
  return useMemo(() => {
    if (!days || days.length === 0) return { sleep: null, exercise: null };
    const nights = days.flatMap((d) => (d.sleep ? [{ date: d.date, value: d.sleep.asleepMin }] : []));
    const exercise = days.flatMap((d) => (d.exerciseMin !== null ? [{ date: d.date, value: d.exerciseMin }] : []));
    const weights = measurements.map((m) => ({ date: localDate(m.measuredAt), value: fromKilograms(m.weightKg, profile.unit) }));
    const fats = measurements.flatMap((m) => {
      const fat = isFull(m) ? bodyFatOf(profile, m) : null;
      return fat ? [{ date: localDate(m.measuredAt), value: fat.value }] : [];
    });
    const shown = (p: HabitPattern | null, min: number) => (p && Math.abs(p.difference) >= min ? p : null);
    return { sleep: shown(sleepWeightPattern(nights, weights), 0.1), exercise: shown(exerciseFatPattern(exercise, fats), 0.05) };
  }, [days, measurements, profile]);
}

/** One found pattern: the difference in big type and what it means next to it. */
function PatternRow({ pattern, text, digits }: { pattern: HabitPattern; text: string; digits: number }) {
  const f = useFormat();
  return (
    <div className="flex items-start gap-3">
      <span className={`min-w-16 text-[22px] font-extrabold ${pattern.difference < 0 ? "text-good-text" : "text-warn-text"}`}>
        {signed(pattern.difference, (n) => f.number(n, digits))}
      </span>
      <p className="text-[13px] leading-4.75 font-semibold text-ink-2">{text}</p>
    </div>
  );
}

/**
 * Body > Trends and the full History share every number: Trends shows the redesign's cards and
 * patterns; History is the page with every chart, what each measure means and the advice for it.
 */
function BodyCharts({ profile, measurements, goals, mode }: Props & { mode: "trends" | "history" }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const [range, setRange] = useState<RangeKey>("90");
  const [compare, setCompare] = useCompareXiaomi();
  const period = usePeriodText(range);
  const subtitle = useCountSince(measurements);
  const back = backFromHistory();

  const cutoff = range === "all" ? -Infinity : Date.now() - Number(range) * DAY;
  const visible = useMemo(() => measurements.filter((m) => new Date(m.measuredAt).getTime() >= cutoff), [measurements, cutoff]);
  const unit = profile.unit;
  const waistUnit = unit === "lb" ? "in" : "cm";
  const mass = (kg: number | null | undefined) => (kg === null || kg === undefined ? null : fromKilograms(kg, unit));

  // The real weight runs over the whole history, so the first days of a range are already smoothed.
  const best = useBestStreak();
  const trendUnlocked = best !== null && best >= STREAK_UNLOCKS.trend;
  const trendAt = useMemo(() => new Map(weightTrend(measurements).map((p) => [p.time, p.trendKg])), [measurements]);

  // Every value is computed once per weigh-in; the charts below only pick columns.
  const rows = useMemo<Row[]>(
    () =>
      [...visible].reverse().map((m) => {
        const na = compositionOf(profile, m);
        const x = xiaomiComparable(m);
        const fat = bodyFatOf(profile, m);
        return {
          t: new Date(m.measuredAt).getTime(),
          weight: mass(m.weightKg),
          trend: mass(trendAt.get(new Date(m.measuredAt).getTime())),
          bmi: bmi(m.weightKg, profile.heightCm),
          "fat.c": fat?.value ?? null,
          "fat.x": x.bodyFatPct,
          "ffm.c": mass(na?.fatFreeMassKg),
          "ffm.x": mass(x.fatFreeMassKg),
          "water.c": na?.bodyWaterPct ?? null,
          "water.x": x.bodyWaterPct,
          "bmr.c": na?.bmrKcal ?? null,
          "bmr.x": x.bmrKcal,
          skeletalMuscle: mass(na?.skeletalMuscleKg),
          "lean.c": mass(na?.leanSoftKg),
          "lean.x": mass(x.muscleKg),
          "protein.c": na?.proteinPct ?? null,
          "protein.x": x.proteinPct,
          // Metabolic age; readings outside 18 to 80 chart at that limit.
          "age.c": fat ? metabolicAge({ fatPct: fat.value, weightKg: m.weightKg, age: ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(m.measuredAt)), sex: profile.sex }).age : null,
          "age.x": m.bodyAge,
          waist: m.waistCm === null ? null : waistUnit === "in" ? m.waistCm / CM_PER_IN : m.waistCm,
          visceral: m.visceralFat,
          // Weight-only weigh-ins would score on BMI alone and jump; only full ones are charted.
          "score.c": isFull(m) ? scoreOf(profile, m).score : null,
          "score.x": m.bodyScore,
        };
      }),
    [visible, profile, unit, trendAt],
  );
  const column = (key: string): LinePoint[] => rows.flatMap((r) => (r[key] === null || r[key] === undefined ? [] : [{ t: r.t, v: r[key]! }]));

  const healthy = healthyWeightRange(profile.heightCm);
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date());
  const fatHealthy = bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!;
  const caliche = (key: string, label = "Caliche Balance"): Series => ({ key, label, kind: "caliche" });
  const xiaomi = (key: string): Series => ({ key, label: "Xiaomi", kind: "xiaomi" });
  const paired = (c: string, x: string) => (compare ? [caliche(c), xiaomi(x)] : [caliche(c)]);
  const one = (key: string, label: string) => [caliche(key, label)];
  const plain = { formatTick: (n: number) => f.number(n, 0), formatValue: (n: number) => f.number(n) };

  // What the latest weigh-in means, from the same report as the weigh-in detail page.
  const latest = measurements[0];
  const latestFull = measurements.find(isFull) ?? latest;
  const report = latestFull ? readingReport(profile, latestFull, measurements) : null;
  const advice = useAdvice(profile);
  const adviceFor = (key: ReportItemKey) => {
    const item = report?.items.find((i) => i.key === key);
    return item && report ? advice(item, report) : null;
  };
  const na = latestFull ? compositionOf(profile, latestFull) : null;
  const heightText = unit === "lb" ? `${Math.floor(profile.heightCm / CM_PER_IN / 12)}' ${Math.round((profile.heightCm / CM_PER_IN) % 12)}"` : `${f.number(profile.heightCm / 100, 2)} m`;
  const weightNow = latest
    ? tf(latest.weightKg > healthy.max ? "now.weightAbove" : latest.weightKg < healthy.min ? "now.weightBelow" : "now.weightIn", {
        height: heightText,
        min: f.weight(healthy.min, unit),
        max: f.weight(healthy.max, unit),
        weight: f.weight(latest.weightKg, unit),
        amount: f.weight(latest.weightKg > healthy.max ? latest.weightKg - healthy.max : healthy.min - latest.weightKg, unit),
      })
    : null;
  const latestFat = latestFull ? bodyFatOf(profile, latestFull) : null;
  const fatAge =
    latestFat && latestFull
      ? metabolicAge({ fatPct: latestFat.value, weightKg: latestFull.weightKg, age: ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(latestFull.measuredAt)), sex: profile.sex })
      : null;
  const fatAgeText = fatAge
    ? fatAge.kind === "over"
      ? tf("bodyAgeOver", { age: fatAge.age })
      : fatAge.kind === "under"
        ? tf("bodyAgeUnder", { age: fatAge.age })
        : tf("bodyAgeYears", { age: fatAge.age })
    : null;
  const waistCount = measurements.filter((m) => m.waistCm !== null).length;

  // Weight: the change over the period goes the right way when it heads toward the healthy range.
  const weights = column("weight");
  const wFirst = weights[0];
  const wLast = weights[weights.length - 1];
  const wDelta = wFirst && wLast && weights.length > 1 ? wLast.v - wFirst.v : null;
  const wGood = wDelta === null || (latest && latest.weightKg > healthy.max ? wDelta <= 0 : latest && latest.weightKg < healthy.min ? wDelta >= 0 : true);

  // Body fat, ours and Xiaomi's, from the newest weigh-in in the period that has each.
  const fatC = column("fat.c");
  const fatX = column("fat.x");
  const fatXLatest = latestFull ? xiaomiComparable(latestFull).bodyFatPct : null;
  const fatGap =
    compare && report?.bodyFat?.source === "north-america" && fatXLatest !== null ? report.bodyFat.value - fatXLatest : null;

  const pattern = weekdayPattern(weights);
  const health = useHealthPatterns(profile, measurements);
  const patternMax = pattern ? Math.max(...pattern.map((v) => v ?? -Infinity)) : -Infinity;
  const patternDay = pattern && patternMax >= 0.2 ? pattern.indexOf(patternMax) : -1;
  // Monday 2024-01-01 onward, for weekday names in the person's language.
  const weekday = (i: number, style: "narrow" | "long") => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: style });

  const mini = (key: string, label: string, valueUnit: string, digits: number, goodWhen: "up" | "down" | null) => {
    const points = column(key);
    const last = points[points.length - 1];
    if (!last) return null;
    const delta = points.length > 1 ? last.v - points[0]!.v : null;
    const tone =
      delta === null || goodWhen === null || Math.abs(delta) < 0.05
        ? "text-ink-2"
        : (goodWhen === "up") === delta > 0
          ? "text-good-text"
          : "text-warn-text";
    return (
      <Card key={key} className="flex flex-col gap-1.5 p-4!">
        <p className="text-[13px] font-bold text-ink-2">{label}</p>
        <p className="flex items-baseline gap-1">
          <span className="text-2xl leading-7 font-extrabold tracking-[-0.02em]">{f.number(last.v, digits)}</span>
          {valueUnit && <span className="text-[13px] font-bold text-muted">{valueUnit}</span>}
        </p>
        <Spark values={points.map((p) => p.v)} />
        {delta !== null && (
          <p className={`text-xs font-bold ${tone}`}>{tf("body.inPeriod", { value: `${signed(delta, (n) => f.number(n, digits))}${valueUnit ? ` ${valueUnit}` : ""}`, period })}</p>
        )}
      </Card>
    );
  };
  const minis = [
    mini("skeletalMuscle", t("skeletalMuscle"), unit, 1, "up"),
    mini("water.c", t("bodyWater"), "%", 1, null),
    mini("bmi", t("bmi"), "", 1, latest && latest.weightKg > healthy.max ? "down" : latest && latest.weightKg < healthy.min ? "up" : null),
    mini("bmr.c", t("bmr"), "kcal", 0, null),
  ].filter((m) => m !== null);

  if (mode === "history") {
    return (
      <div className="flex flex-col gap-3.5">
        <BackLink to={back.to} label={t(back.label)} />
        <h1 className="mx-1 text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{t("historyTitle")}</h1>
        <Segmented
          label={t("range")}
          value={range}
          onChange={setRange}
          options={(["30", "90", "365", "all"] as const).map((r) => ({ value: r, label: t(`range.${r}` as MessageKey) }))}
        />
        <Card className="flex flex-col gap-1 py-3!">
          <Switch label={t("compareXiaomi")} checked={compare} onChange={setCompare} />
          <p className="text-sm font-medium text-muted">{t("compareHint")}</p>
        </Card>
        <ReportCard profile={profile} measurements={measurements} days={30} unlock="monthly" title={t("monthlyTitle")} intro={t("monthlyIntro")} />
        <TrendChart
          title={`${t("bodyScoreTitle")} (0-100)`}
          rows={rows}
          series={paired("score.c", "score.x")}
          formatTick={(n) => f.number(n, 0)}
          formatValue={(n) => f.number(n, 0)}
          about={t("about.score")}
          now={report ? tf("now.score", { score: report.score.score }) : null}
        />
        <TrendChart
          title={`${t("weight")} (${unit})`}
          rows={rows}
          series={trendUnlocked ? [caliche("weight", t("weight")), { key: "trend", label: t("trendTitle"), kind: "trend" }] : one("weight", t("weight"))}
          band={{ min: fromKilograms(healthy.min, unit), max: fromKilograms(healthy.max, unit) }}
          goal={goals.weight ? fromKilograms(goals.weight.targetKg, unit) : null}
          unit={` ${unit}`}
          about={t("about.weight")}
          now={weightNow}
          {...plain}
        />
        <TrendChart
          title={`${t("bodyFat")} (%)`}
          rows={rows}
          series={paired("fat.c", "fat.x")}
          band={{ min: fatHealthy.min!, max: fatHealthy.max! }}
          goal={goals.bodyFat?.targetPct ?? null}
          unit=" %"
          about={t("about.bodyFat")}
          now={adviceFor("bodyFat")}
          {...plain}
        />
        <TrendChart
          title={`${t("fatFreeMass")} (${unit})`}
          rows={rows}
          series={paired("ffm.c", "ffm.x")}
          unit={` ${unit}`}
          about={t("about.ffm")}
          now={na ? tf("now.value", { value: f.weight(na.fatFreeMassKg, unit) }) : null}
          {...plain}
        />
        <TrendChart
          title={`${t("skeletalMuscle")} (${unit})`}
          rows={rows}
          series={one("skeletalMuscle", t("skeletalMuscle"))}
          unit={` ${unit}`}
          about={t("about.skeletalMuscle")}
          now={adviceFor("muscleIndex")}
          {...plain}
        />
        <TrendChart
          title={`${t("leanSoftVsXiaomi")} (${unit})`}
          rows={rows}
          series={paired("lean.c", "lean.x")}
          unit={` ${unit}`}
          about={t("about.lean")}
          now={na ? tf("now.value", { value: f.weight(na.leanSoftKg, unit) }) : null}
          {...plain}
        />
        <TrendChart
          title={`${t("bodyWater")} (%)`}
          rows={rows}
          series={paired("water.c", "water.x")}
          unit=" %"
          about={t("about.water")}
          now={na ? tf("now.value", { value: `${f.number(na.bodyWaterPct)} %` }) : null}
          {...plain}
        />
        <TrendChart
          title={`${t("bmr")} (kcal)`}
          rows={rows}
          series={paired("bmr.c", "bmr.x")}
          formatTick={(n) => f.number(n, 0)}
          formatValue={(n) => f.number(n, 0)}
          unit=" kcal"
          about={t("about.bmr")}
          now={na ? tf("now.value", { value: `${f.number(na.bmrKcal, 0)} ${t("kcalDay")}` }) : null}
        />
        <TrendChart
          title={`${t("proteinExperimental")} (%)`}
          rows={rows}
          series={paired("protein.c", "protein.x")}
          unit=" %"
          about={t("proteinNote")}
          now={na?.proteinPct != null ? tf("now.value", { value: `${f.number(na.proteinPct)} %` }) : null}
          {...plain}
        />
        <TrendChart
          title={t("bodyAgeTitle")}
          rows={rows}
          series={paired("age.c", "age.x")}
          formatTick={(n) => f.number(n, 0)}
          formatValue={(n) => f.number(n, 0)}
          about={t("about.bodyAge")}
          // "70 or older" readings chart at the peak age, so the change over the period would read as 0.
          showChange={false}
          now={fatAgeText && report ? tf("now.bodyAge", { value: fatAgeText, age: report.age }) : null}
        />
        <TrendChart
          title={`${t("waist")} (${waistUnit})`}
          rows={rows}
          series={one("waist", t("waist"))}
          unit={` ${waistUnit}`}
          about={t("about.waist")}
          now={adviceFor("waist")}
          empty={waistCount === 0 ? t("body.waistNone") : waistCount === 1 ? t("now.waistOne") : undefined}
          {...plain}
        />
        {compare && (
          <>
            <SectionHeader title={t("xiaomiOnlyTitle")} />
            <TrendChart
              title={t("visceral")}
              rows={rows}
              series={[xiaomi("visceral")]}
              formatTick={(n) => f.number(n, 0)}
              formatValue={(n) => f.number(n, 0)}
              about={t("about.visceral")}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <BodyTop subtitle={subtitle}>
        <ExportButton profile={profile} measurements={measurements} />
      </BodyTop>
      <Segmented label={t("range")} value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: t(`body.range.${r}` as MessageKey) }))} />
      <div className="rounded-[20px] border border-line bg-surface px-4 py-2.5">
        <Switch label={t("compareXiaomi")} hint={t("body.compareHint")} checked={compare} onChange={setCompare} />
      </div>

      {wLast && (
        <Card className="flex flex-col gap-1">
          <p className="text-[15px] font-bold text-ink-2">{t("weight")}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-[40px] leading-11.5 font-extrabold tracking-[-0.03em]">{f.number(wLast.v)}</span>
            <span className="text-base font-bold text-muted">{unit}</span>
            <span className="flex-1" />
            {wDelta !== null && (
              <span className="self-center">
                <DeltaPill value={wDelta} good={wGood} size="sm">
                  {tf("body.inPeriod", { value: `${f.number(Math.abs(wDelta))} ${unit}`, period })}
                </DeltaPill>
              </span>
            )}
          </div>
          <LineChartSvg
            label={tf("body.weightChartLabel", { period })}
            height={170}
            area
            lines={[
              { points: weights, kind: "caliche" },
              ...(trendUnlocked ? [{ points: column("trend"), kind: "trend" as const }] : []),
            ]}
            goal={goals.weight ? fromKilograms(goals.weight.targetKg, unit) : null}
            goalLabel={goals.weight ? tf("body.goalLabel", { value: f.number(fromKilograms(goals.weight.targetKg, unit), 0) }) : undefined}
            formatTick={(n) => f.number(n, 0)}
          />
          {trendUnlocked && <p className="mt-1 text-xs font-semibold text-muted">{t("body.trendLegend")}</p>}
          {weightNow && <p className="mt-2.5 text-[13px] leading-4.75 font-semibold text-ink-2">{weightNow}</p>}
        </Card>
      )}

      {fatC.length > 0 && (
        <Card className="flex flex-col gap-1">
          <p className="text-[15px] font-bold text-ink-2">{t("bodyFat")}</p>
          <div className={`mt-1.5 grid gap-2 ${compare && fatX.length > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="flex flex-col gap-0.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-2">
                <span className="h-0.75 w-3.5 rounded-full bg-brand" />
                Caliche Balance
              </span>
              <span className="text-[26px] font-extrabold tracking-[-0.02em]">{f.number(fatC[fatC.length - 1]!.v)} %</span>
            </div>
            {compare && fatX.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-2">
                  <svg width="14" height="4" aria-hidden>
                    <line x1="0" x2="14" y1="2" y2="2" stroke="var(--series-2)" strokeWidth="3" strokeDasharray="4 3" />
                  </svg>
                  Xiaomi
                </span>
                <span className="text-[26px] font-extrabold tracking-[-0.02em]">{f.number(fatX[fatX.length - 1]!.v)} %</span>
              </div>
            )}
          </div>
          <LineChartSvg
            label={tf("body.fatChartLabel", { period })}
            height={150}
            lines={[{ points: fatC, kind: "caliche" }, ...(compare ? [{ points: fatX, kind: "xiaomi" as const }] : [])]}
            band={{ min: fatHealthy.min!, max: fatHealthy.max! }}
            goal={goals.bodyFat?.targetPct ?? null}
            goalLabel={goals.bodyFat ? tf("body.goalLabel", { value: `${f.number(goals.bodyFat.targetPct, 0)} %` }) : undefined}
            formatTick={(n) => `${f.number(n, 0)} %`}
          />
          <div className="mt-2.5 flex items-center gap-2 rounded-2xl bg-surface-2 px-3.5 py-3">
            <span className="h-3 w-3 shrink-0 rounded-[3px] border border-brand/40 bg-(--band)" aria-hidden />
            <p className="text-[13px] leading-4.75 font-semibold text-ink-2">
              {tf("body.fatHealthyTo", { min: f.number(fatHealthy.min!, 0), max: f.number(fatHealthy.max!, 1) })}
              {fatGap !== null && Math.abs(fatGap) >= 0.1 && (
                <>
                  {" "}
                  {tf(fatGap > 0 ? "body.xiaomiLower" : "body.xiaomiHigher", { n: f.number(Math.abs(fatGap)) })}
                </>
              )}
            </p>
          </div>
        </Card>
      )}

      {((pattern && patternDay >= 0) || health.sleep || health.exercise) && (
        <Card className="flex flex-col gap-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <BulbIcon size={20} />
            </span>
            <p className="text-base font-extrabold">{t("body.patternsTitle")}</p>
          </div>
          {pattern && patternDay >= 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold">{tf("body.patternDay", { day: weekday(patternDay, "long") })}</p>
            <div className="flex h-19 items-end gap-1.5" role="img" aria-label={t("body.patternNote")}>
              {pattern.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className={`text-[10px] font-extrabold ${i === patternDay ? "text-warn-text" : "text-muted"}`}>
                    {v === null ? "" : signed(v, (n) => f.number(n))}
                  </span>
                  <span
                    className={`w-full rounded-md ${i === patternDay ? "bg-warn" : "bg-track"}`}
                    style={{ height: v === null ? 2 : Math.round(6 + Math.min(Math.abs(v), 0.8) * 60) }}
                  />
                  <span className="text-[11px] font-bold text-muted uppercase">{weekday(i, "narrow")}</span>
                </div>
              ))}
            </div>
            <p className="text-xs font-semibold text-muted">{tf("body.patternNote", { unit })}</p>
          </div>
          )}
          {(health.sleep || health.exercise) && (
            <>
              {pattern && patternDay >= 0 && <div className="h-px bg-line" />}
              {health.sleep && (
                <PatternRow
                  pattern={health.sleep}
                  digits={1}
                  text={tf(health.sleep.difference < 0 ? "body.patternSleepLess" : "body.patternSleepMore", {
                    unit,
                    n: health.sleep.habitWeeks,
                    total: health.sleep.totalWeeks,
                  })}
                />
              )}
              {health.exercise && (
                <PatternRow
                  pattern={health.exercise}
                  digits={1}
                  text={tf(health.exercise.difference < 0 ? "body.patternExerciseLess" : "body.patternExerciseMore", {
                    n: health.exercise.habitWeeks,
                    total: health.exercise.totalWeeks,
                  })}
                />
              )}
              <p className="text-xs font-semibold text-muted">{t("body.patternsHealthNote")}</p>
            </>
          )}
        </Card>
      )}

      {minis.length > 0 && <div className="grid grid-cols-2 gap-3">{minis}</div>}

      <Link
        to="/historial"
        className="flex items-center gap-3.5 rounded-3xl border border-line bg-surface p-4 text-ink shadow-card"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-text">
          <FiBarChart2 size={22} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-extrabold">{t("body.historyLink")}</span>
          <span className="text-[13px] font-semibold text-muted">{t("body.historyLinkHint")}</span>
        </span>
        <FiChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
      </Link>
    </div>
  );
}

export function TrendsPage(props: Props) {
  return <BodyCharts {...props} mode="trends" />;
}

/** Every chart with what it means and the advice for it, over the period picked (the History page). */
export function HistoryPage(props: Props) {
  return <BodyCharts {...props} mode="history" />;
}

/** How many weeks the weigh-ins list shows at first, and how many more each tap adds. */
const WEEKS_PAGE = 6;

/** Body > Weigh-ins: every weigh-in, newest first, a card per week. */
export function WeighInsPage({ profile, measurements }: Props) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const [weeks, setWeeks] = useState(WEEKS_PAGE);
  const subtitle = useCountSince(measurements);
  const unit = profile.unit;
  const waistUnit = unit === "lb" ? "in" : "cm";

  const groups = useMemo(() => {
    const out: { monday: number; items: { m: MeasurementDto; older: MeasurementDto | undefined }[] }[] = [];
    measurements.forEach((m, i) => {
      const d = new Date(m.measuredAt);
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
      const item = { m, older: measurements[i + 1] };
      const last = out[out.length - 1];
      if (last && last.monday === monday) last.items.push(item);
      else out.push({ monday, items: [item] });
    });
    return out;
  }, [measurements]);

  const now = new Date();
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const weekTitle = (monday: number) =>
    monday === thisMonday
      ? t("body.thisWeek")
      : monday === new Date(new Date(thisMonday).setDate(new Date(thisMonday).getDate() - 7)).getTime()
        ? t("body.lastWeek")
        : tf("body.weekOf", { date: new Date(monday).toLocaleDateString(locale, { day: "numeric", month: "short", year: new Date(monday).getFullYear() === now.getFullYear() ? undefined : "numeric" }) });

  return (
    <div className="flex flex-col gap-3.5">
      <BodyTop subtitle={subtitle}>
        <ExportButton profile={profile} measurements={measurements} />
      </BodyTop>
      {groups.length === 0 && (
        <Card className="text-center">
          <p className="text-sm font-semibold text-ink-2">{t("noMeasurementsBody")}</p>
        </Card>
      )}
      {groups.slice(0, weeks).map((g) => (
        <section key={g.monday} className="flex flex-col gap-2.5">
          <SectionHeader title={weekTitle(g.monday)} aside={tf("body.weighInsCount", { n: g.items.length })} />
          <Card padded={false}>
            {g.items.map(({ m, older }) => {
              const d = new Date(m.measuredAt);
              const fat = bodyFatOf(profile, m);
              const delta = older ? fromKilograms(m.weightKg, unit) - fromKilograms(older.weightKg, unit) : null;
              const meta = [
                isFull(m) ? t("body.full") : t("body.weightOnly"),
                fat && isFull(m) ? tf("body.fatShort", { value: f.number(fat.value) }) : null,
                m.waistCm !== null ? `${t("waist")} ${waistUnit === "in" ? f.number(m.waistCm / CM_PER_IN) : f.number(m.waistCm, 0)} ${waistUnit}` : null,
                f.time(m.measuredAt),
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <Link key={m.id} to={`/medicion/${m.id}`} className="flex min-h-16 items-center gap-3 border-t border-line px-4 py-2.5 text-ink first:border-t-0">
                  <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface-2">
                    <span className="text-[10px] font-extrabold text-muted uppercase">{d.toLocaleDateString(locale, { weekday: "short" }).replace(".", "")}</span>
                    <span className="text-base leading-4.5 font-extrabold">{d.getDate()}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-base font-extrabold">{f.weight(m.weightKg, unit)}</span>
                    <span className="truncate text-xs font-semibold text-muted">{meta}</span>
                    {m.note && <span className="truncate text-xs font-semibold text-ink-2 italic">“{m.note}”</span>}
                  </span>
                  {delta !== null && (
                    <span
                      className={`inline-flex h-6.5 shrink-0 items-center rounded-full px-2.5 text-xs font-extrabold ${delta <= 0 ? "bg-good-soft text-good-text" : "bg-warn-soft text-warn-text"}`}
                    >
                      {signed(delta, (n) => f.number(n))}
                    </span>
                  )}
                  <FiChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
                </Link>
              );
            })}
          </Card>
        </section>
      ))}
      {groups.length > weeks && (
        <Button variant="secondary" onClick={() => setWeeks((w) => w + WEEKS_PAGE)}>
          {t("body.showMore")}
        </Button>
      )}
      <Callout icon={FiInfo}>{t("body.weighInsHint")}</Callout>
    </div>
  );
}
