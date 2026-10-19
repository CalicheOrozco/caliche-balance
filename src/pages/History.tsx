import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { FiEdit2, FiTrash2, FiUserX } from "react-icons/fi";
import { Link } from "react-router";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bodyFatAge } from "../../shared/bodyAge.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { ageAt, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { type ReportItemKey, readingReport } from "../../shared/report.ts";
import { scoreOf } from "../../shared/score.ts";
import { CM_PER_IN, fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { useAdvice } from "../advice.ts";
import { useCompareXiaomi } from "../compare.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Button, Card, Field, Segmented, Switch, signed, useFormat } from "../ui.tsx";

type RangeKey = "30" | "90" | "365" | "all";

/** One row per weigh-in; each chart reads its own columns, null where a value is missing. */
type Row = { t: number } & Record<string, number | null>;

interface Series {
  key: string;
  label: string;
  /** Caliche Balance is solid green; Xiaomi is dashed blue, so the pair differs beyond color. */
  kind: "caliche" | "xiaomi";
}

const SERIES_STYLE = {
  caliche: { stroke: "var(--series)", dash: undefined },
  xiaomi: { stroke: "var(--series-2)", dash: "6 4" },
} as const;

/** One measure per chart (never two y-axes). Two series only when they measure the same thing. */
function TrendChart({
  title,
  rows,
  series,
  band = null,
  goal = null,
  formatTick,
  formatValue,
  unit = "",
  about,
  now,
  empty,
  showChange = true,
}: {
  title: string;
  rows: Row[];
  series: Series[];
  band?: { min: number; max: number } | null;
  goal?: number | null;
  formatTick: (n: number) => string;
  formatValue: (n: number) => string;
  /** Appended to values in the period change, e.g. " kg". */
  unit?: string;
  /** What the measure is, in plain words. */
  about?: string;
  /** What the latest value means for this person. */
  now?: string | null;
  /** Shown instead of the chart when there are fewer than two points; without it the card is left out. */
  empty?: string;
  /** Off for capped measures, where a change over the period would mislead. */
  showChange?: boolean;
}) {
  const { t, tf, locale } = useI18n();
  const data = rows.filter((r) => series.some((s) => r[s.key] !== null));
  const notes = (
    <>
      {about && <p className="mt-1 text-sm text-ink-2">{about}</p>}
      {now && <p className="mt-2 text-sm font-medium text-ink">{now}</p>}
    </>
  );
  // A chart with fewer than two points says nothing; show why, or leave the card out.
  if (data.length < 2) {
    return empty ? (
      <Card>
        <h2 className="text-lg font-semibold">{title}</h2>
        {notes}
        <p className="mt-2 text-sm text-muted">{empty}</p>
      </Card>
    ) : null;
  }
  // Change over the selected period for the first (Caliche Balance) series.
  const main = series[0]!.key;
  const withMain = data.filter((r) => r[main] !== null);
  const from = withMain[0]?.[main] ?? null;
  const to = withMain[withMain.length - 1]?.[main] ?? null;
  const change =
    showChange && from !== null && to !== null && withMain.length >= 2
      ? tf("periodChange", { delta: `${signed(to - from, formatValue)}${unit}`, from: `${formatValue(from)}${unit}`, to: `${formatValue(to)}${unit}` })
      : null;

  const values = data.flatMap((r) => series.map((s) => r[s.key]).filter((v): v is number => v !== null));
  const lo = Math.min(...values, ...(band ? [band.min] : []), ...(goal === null ? [] : [goal]));
  const hi = Math.max(...values, ...(band ? [band.max] : []), ...(goal === null ? [] : [goal]));
  const pad = Math.max((hi - lo) * 0.1, 1);
  // Long histories need the year on the axis, or "8 jul" from two different years look the same.
  const times = data.map((r) => r.t);
  const longSpan = Math.max(...times) - Math.min(...times) > 300 * 24 * 60 * 60 * 1000;
  const tickDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, longSpan ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
  const fullDate = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const [first, second] = series;
  const pair = series.length === 2 && first && second ? ([first, second] as const) : null;

  return (
    <Card>
      <h2 className="text-lg font-semibold">{title}</h2>
      {notes}
      {change && <p className="mt-1 text-sm text-ink-2">{change}</p>}
      {pair && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
          {pair.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <svg width="22" height="8" aria-hidden>
                <line x1="1" y1="4" x2="21" y2="4" stroke={SERIES_STYLE[s.kind].stroke} strokeWidth="2.5" strokeDasharray={SERIES_STYLE[s.kind].dash} />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="0" vertical={false} />
            {band && <ReferenceArea y1={band.min} y2={band.max} fill="var(--band)" stroke="none" ifOverflow="hidden" />}
            {goal !== null && <ReferenceLine y={goal} stroke="var(--ink-2)" strokeDasharray="2 4" strokeWidth={1.5} ifOverflow="extendDomain" />}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={tickDate}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              axisLine={{ stroke: "var(--line)" }}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              domain={[Math.floor(lo - pad), Math.ceil(hi + pad)]}
              // Ticks are shown as whole numbers; half steps would print the same label twice.
              allowDecimals={false}
              tickFormatter={(n: number) => formatTick(n)}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                if (!row) return null;
                const a = pair ? (row[pair[0].key] ?? null) : null;
                const b = pair ? (row[pair[1].key] ?? null) : null;
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink shadow-lg">
                    <p className="font-semibold">{fullDate(row.t)}</p>
                    {series.map((s) =>
                      row[s.key] === null ? null : (
                        <p key={s.key} className="text-ink-2">
                          {s.label}: <strong className="text-ink">{formatValue(row[s.key]!)}</strong>
                        </p>
                      ),
                    )}
                    {a !== null && b !== null && (
                      <p className="text-ink-2">
                        {t("difference")}: <strong className="text-ink">{signed(a - b, formatValue)}</strong>
                      </p>
                    )}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                connectNulls
                stroke={SERIES_STYLE[s.kind].stroke}
                strokeDasharray={SERIES_STYLE[s.kind].dash}
                strokeWidth={2}
                dot={data.length <= 40 ? { r: 3, fill: SERIES_STYLE[s.kind].stroke, stroke: "var(--surface)", strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: SERIES_STYLE[s.kind].stroke, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {(band || goal !== null) && (
        <p className="mt-2 text-xs text-muted">{[band && t("healthyBand"), goal !== null && t("goalLine")].filter(Boolean).join(" · ")}</p>
      )}
    </Card>
  );
}

export function HistoryPage({ profile, measurements, goals }: { profile: ProfileDto; measurements: MeasurementDto[]; goals: GoalsDto }) {
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
    [visible, profile, unit],
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
        series={one("weight", t("weight"))}
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
