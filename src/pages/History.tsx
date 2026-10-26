import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { FiEdit2, FiTrash2, FiUserX } from "react-icons/fi";
import { Link } from "react-router";
import { bodyFatAge } from "../../shared/bodyAge.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { ageAt, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { type ReportItemKey, readingReport } from "../../shared/report.ts";
import { scoreOf } from "../../shared/score.ts";
import { STREAK_UNLOCKS } from "../../shared/achievements.ts";
import { weightTrend } from "../../shared/trend.ts";
import { ReportCard, useBestStreak } from "../reports.tsx";
import { CM_PER_IN, fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { useAdvice } from "../advice.ts";
import { useCompareXiaomi } from "../compare.ts";
import { type Row, type Series, TrendChart } from "../charts.tsx";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Button, Card, Field, Segmented, Switch, signed, useFormat } from "../ui.tsx";

type RangeKey = "30" | "90" | "365" | "all";


export function HistoryPage({
  profile,
  measurements,
  goals,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  goals: GoalsDto;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>("90");
  const [compare, setCompare] = useCompareXiaomi();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["measurements"] });
  const remove = useMutation({ mutationFn: api.deleteMeasurement, onSuccess: refresh });
  const notMine = useMutation({ mutationFn: api.notMine, onSuccess: refresh });

  const cutoff = range === "all" ? -Infinity : Date.now() - Number(range) * 24 * 60 * 60 * 1000;
  const visible = useMemo(() => measurements.filter((m) => new Date(m.measuredAt).getTime() >= cutoff), [measurements, cutoff]);
  const unit = profile.unit;
  const waistUnit = unit === "lb" ? "in" : "cm";
  const [waistFor, setWaistFor] = useState<string | null>(null);
  const [waistValue, setWaistValue] = useState("");
  const saveWaist = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => api.setWaist(id, value.trim() ? value : null, waistUnit),
    onSuccess: () => {
      setWaistFor(null);
      void refresh();
    },
  });
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
          // Body fat age against Mexican American medians; "or older" readings chart at the peak age.
          "age.c": fat ? bodyFatAge(fat.value, profile.sex, "mexican-american").age : null,
          "age.x": m.bodyAge,
          waist: m.waistCm === null ? null : waistUnit === "in" ? m.waistCm / CM_PER_IN : m.waistCm,
          visceral: m.visceralFat,
          // Weight-only weigh-ins would score on BMI alone and jump; only full ones are charted.
          "score.c": m.bodyFatPct !== null || m.impedance !== null ? scoreOf(profile, m).score : null,
          "score.x": m.bodyScore,
        };
      }),
    [visible, profile, unit, trendAt],
  );

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
  const latestFull = measurements.find((m) => m.bodyFatPct !== null || m.impedance !== null) ?? latest;
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
  const fatAge = latestFat ? bodyFatAge(latestFat.value, profile.sex, "mexican-american") : null;
  const fatAgeText = fatAge
    ? fatAge.kind === "over"
      ? tf("bodyAgeOver", { age: fatAge.age })
      : fatAge.kind === "under"
        ? tf("bodyAgeUnder", { age: fatAge.age })
        : tf("bodyAgeYears", { age: fatAge.age })
    : null;
  const waistCount = measurements.filter((m) => m.waistCm !== null).length;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("historyTitle")}</h1>
      <Segmented
        label={t("range")}
        value={range}
        onChange={setRange}
        options={(["30", "90", "365", "all"] as const).map((r) => ({ value: r, label: t(`range.${r}` as MessageKey) }))}
      />
      <Card className="py-3">
        <Switch label={t("compareXiaomi")} checked={compare} onChange={setCompare} />
        <p className="text-sm text-muted">{t("compareHint")}</p>
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
        empty={waistCount === 0 ? t("now.waistNone") : waistCount === 1 ? t("now.waistOne") : undefined}
        {...plain}
      />

      {compare && (
        <>
          <h2 className="px-1 pt-2 text-lg font-semibold">{t("xiaomiOnlyTitle")}</h2>
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

      <Card padded={false}>
        <h2 className="px-5 pt-5 text-lg font-semibold">{t("measurements")}</h2>
        <ul className="mt-2 divide-y divide-line">
          {visible.map((m) => {
            const fat = bodyFatOf(profile, m);
            return (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/medicion/${m.id}`} className="-my-1 block rounded-xl py-1 active:opacity-70">
                    <p className="font-semibold">
                      {f.weight(m.weightKg, unit)}
                      {fat && <span className="font-normal text-ink-2"> · {f.number(fat.value)} %</span>}
                    </p>
                    <p className="text-sm text-muted">
                      {f.dateTime(m.measuredAt)} · {t(`source.${m.source}` as MessageKey)}
                      {m.waistCm !== null &&
                        ` · ${t("waist")} ${waistUnit === "in" ? f.number(m.waistCm / CM_PER_IN) : f.number(m.waistCm, 0)} ${waistUnit}`}
                    </p>
                  </Link>
                  {waistFor === m.id && (
                    <form
                      className="mt-2 flex items-end gap-2"
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        saveWaist.mutate({ id: m.id, value: waistValue });
                      }}
                    >
                      <div className="flex-1">
                        <Field label={`${t("waist")} (${waistUnit})`} inputMode="decimal" value={waistValue} onChange={(e) => setWaistValue(e.target.value)} autoFocus />
                      </div>
                      <Button type="submit" disabled={saveWaist.isPending}>
                        {t("save")}
                      </Button>
                    </form>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`${t("editWaist")}: ${f.dateTime(m.measuredAt)}`}
                  title={t("editWaist")}
                  onClick={() => {
                    setWaistFor(waistFor === m.id ? null : m.id);
                    setWaistValue(m.waistCm === null ? "" : String(Math.round((waistUnit === "in" ? m.waistCm / CM_PER_IN : m.waistCm) * 10) / 10));
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink active:scale-95"
                >
                  <FiEdit2 size={18} aria-hidden />
                </button>
                {m.source === "zepp" && (
                  <button
                    type="button"
                    aria-label={`${t("notMine")}: ${f.dateTime(m.measuredAt)}`}
                    title={t("notMine")}
                    onClick={() => {
                      if (confirm(t("notMineConfirm"))) notMine.mutate(m.id);
                    }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink active:scale-95"
                  >
                    <FiUserX size={20} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`${t("delete")}: ${f.dateTime(m.measuredAt)}`}
                  title={t("delete")}
                  onClick={() => {
                    if (confirm(t("deleteMeasurementConfirm"))) remove.mutate(m.id);
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-bad transition hover:bg-bad/15 active:scale-95"
                >
                  <FiTrash2 size={20} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
