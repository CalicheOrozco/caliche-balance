import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiTrash2, FiUserX } from "react-icons/fi";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bodyFatOf, compositionOf } from "../../shared/composition.ts";
import { ageAt, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Card, Segmented, Select, useFormat } from "../ui.tsx";

type RangeKey = "30" | "90" | "365" | "all";
type MetricKey =
  | "bodyFat"
  | "skeletalMuscle"
  | "bodyWater"
  | "bodyFatXiaomi"
  | "muscle"
  | "water"
  | "visceral"
  | "protein"
  | "bodyAge";

interface Point {
  t: number;
  value: number;
}

/** One measure per chart (never two y-axes); the green band is the healthy range. */
function TrendChart({
  title,
  points,
  band,
  goal = null,
  formatTick,
  formatValue,
}: {
  title: string;
  points: Point[];
  band: { min: number; max: number } | null;
  goal?: number | null;
  formatTick: (n: number) => string;
  formatValue: (n: number) => string;
}) {
  const { t, locale } = useI18n();
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, ...(band ? [band.min] : []), ...(goal === null ? [] : [goal]));
  const hi = Math.max(...values, ...(band ? [band.max] : []), ...(goal === null ? [] : [goal]));
  const pad = Math.max((hi - lo) * 0.1, 1);
  // Long histories need the year on the axis, or "8 jul" from two different years look the same.
  const times = points.map((p) => p.t);
  const longSpan = Math.max(...times) - Math.min(...times) > 300 * 24 * 60 * 60 * 1000;
  const tickDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, longSpan ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
  const fullDate = (ms: number) => new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  return (
    <Card>
      <h2 className="text-lg font-semibold">{title}</h2>
      {points.length < 2 ? (
        <p className="mt-2 text-sm text-muted">{t("notEnoughData")}</p>
      ) : (
        <>
          <div className="mt-3 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="0" vertical={false} />
                {band && <ReferenceArea y1={band.min} y2={band.max} fill="var(--band)" stroke="none" ifOverflow="hidden" />}
                {goal !== null && <ReferenceLine y={goal} stroke="var(--ink-2)" strokeDasharray="6 4" strokeWidth={1.5} ifOverflow="extendDomain" />}
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
                  tickFormatter={(n: number) => formatTick(n)}
                  tick={{ fill: "var(--muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    color: "var(--ink)",
                  }}
                  labelFormatter={(ms) => fullDate(Number(ms))}
                  formatter={(v) => [formatValue(Number(v)), title]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--series)"
                  strokeWidth={2}
                  dot={points.length <= 40 ? { r: 3, fill: "var(--series)", stroke: "var(--surface)", strokeWidth: 2 } : false}
                  activeDot={{ r: 5, fill: "var(--series)", stroke: "var(--surface)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {(band || goal !== null) && (
            <p className="mt-2 text-xs text-muted">{[band && t("healthyBand"), goal !== null && t("goalLine")].filter(Boolean).join(" · ")}</p>
          )}
        </>
      )}
    </Card>
  );
}

export function HistoryPage({ profile, measurements, goals }: { profile: ProfileDto; measurements: MeasurementDto[]; goals: GoalsDto }) {
  const { t } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<RangeKey>("90");
  const [metric, setMetric] = useState<MetricKey>("bodyFat");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["measurements"] });
  const remove = useMutation({ mutationFn: api.deleteMeasurement, onSuccess: refresh });
  const notMine = useMutation({ mutationFn: api.notMine, onSuccess: refresh });

  const cutoff = range === "all" ? -Infinity : Date.now() - Number(range) * 24 * 60 * 60 * 1000;
  const visible = measurements.filter((m) => new Date(m.measuredAt).getTime() >= cutoff);
  const chronological = [...visible].reverse();
  const weights = chronological.map((m) => ({ t: new Date(m.measuredAt).getTime(), value: fromKilograms(m.weightKg, profile.unit) }));
  const healthy = healthyWeightRange(profile.heightCm);
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date());
  const fatHealthy = bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!;

  // Second chart: any body measure. Only body fat has a North American healthy band.
  const metrics: Record<MetricKey, { label: string; unit: string; pick: (m: MeasurementDto) => number | null; band: { min: number; max: number } | null }> = {
    // North American recalculation (falls back to the scale's value only for body fat without impedance).
    bodyFat: { label: t("bodyFat"), unit: "%", pick: (m) => bodyFatOf(profile, m)?.value ?? null, band: { min: fatHealthy.min!, max: fatHealthy.max! } },
    skeletalMuscle: {
      label: t("skeletalMuscle"),
      unit: profile.unit,
      pick: (m) => {
        const c = compositionOf(profile, m);
        return c ? fromKilograms(c.skeletalMuscleKg, profile.unit) : null;
      },
      band: null,
    },
    bodyWater: { label: t("bodyWater"), unit: "%", pick: (m) => compositionOf(profile, m)?.bodyWaterPct ?? null, band: null },
    // Xiaomi's own values, shown as they come.
    bodyFatXiaomi: { label: `${t("bodyFat")} (Xiaomi)`, unit: "%", pick: (m) => m.bodyFatPct, band: null },
    muscle: { label: `${t("muscle")} (Xiaomi)`, unit: profile.unit, pick: (m) => (m.muscleKg === null ? null : fromKilograms(m.muscleKg, profile.unit)), band: null },
    water: { label: `${t("water")} (Xiaomi)`, unit: "%", pick: (m) => m.waterPct, band: null },
    visceral: { label: `${t("visceral")} (Xiaomi)`, unit: "", pick: (m) => m.visceralFat, band: null },
    protein: { label: `${t("protein")} (Xiaomi)`, unit: "%", pick: (m) => m.proteinPct, band: null },
    bodyAge: { label: `${t("bodyAge")} (Xiaomi)`, unit: "", pick: (m) => m.bodyAge, band: null },
  };
  const selected = metrics[metric];
  const metricPoints = chronological.flatMap((m) => {
    const value = selected.pick(m);
    return value === null ? [] : [{ t: new Date(m.measuredAt).getTime(), value }];
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("historyTitle")}</h1>
      <Segmented
        label={t("range")}
        value={range}
        onChange={setRange}
        options={(["30", "90", "365", "all"] as const).map((r) => ({ value: r, label: t(`range.${r}` as MessageKey) }))}
      />
      <TrendChart
        title={`${t("weight")} (${profile.unit})`}
        points={weights}
        band={{ min: fromKilograms(healthy.min, profile.unit), max: fromKilograms(healthy.max, profile.unit) }}
        goal={goals.weight ? fromKilograms(goals.weight.targetKg, profile.unit) : null}
        formatTick={(n) => f.number(n, 0)}
        formatValue={(n) => f.number(n)}
      />
      <div>
        <Select label={t("metric")} value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
          {(Object.keys(metrics) as MetricKey[]).map((key) => (
            <option key={key} value={key}>
              {metrics[key].label}
            </option>
          ))}
        </Select>
      </div>
      <TrendChart
        title={selected.unit ? `${selected.label} (${selected.unit})` : selected.label}
        points={metricPoints}
        band={selected.band}
        goal={metric === "bodyFat" ? (goals.bodyFat?.targetPct ?? null) : null}
        formatTick={(n) => f.number(n, 0)}
        formatValue={(n) => f.number(n)}
      />
      <Card padded={false}>
        <h2 className="px-5 pt-5 text-lg font-semibold">{t("measurements")}</h2>
        <ul className="mt-2 divide-y divide-line">
          {visible.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {f.weight(m.weightKg, profile.unit)}
                  {m.bodyFatPct !== null && <span className="font-normal text-ink-2"> · {f.number(m.bodyFatPct)} %</span>}
                </p>
                <p className="text-sm text-muted">
                  {f.dateTime(m.measuredAt)} · {t(`source.${m.source}` as MessageKey)}
                </p>
              </div>
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
          ))}
        </ul>
      </Card>
    </div>
  );
}
