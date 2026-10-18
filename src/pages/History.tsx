import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiTrash2, FiUserX } from "react-icons/fi";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { ageAt, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { useCompareXiaomi } from "../compare.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Card, Segmented, Switch, signed, useFormat } from "../ui.tsx";

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
}: {
  title: string;
  rows: Row[];
  series: Series[];
  band?: { min: number; max: number } | null;
  goal?: number | null;
  formatTick: (n: number) => string;
  formatValue: (n: number) => string;
}) {
  const { t, locale } = useI18n();
  const data = rows.filter((r) => series.some((s) => r[s.key] !== null));
  // A chart with fewer than two points says nothing; leave it out instead of showing an empty card.
  if (data.length < 2) return null;

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
  const { t } = useI18n();
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
  const mass = (kg: number | null | undefined) => (kg === null || kg === undefined ? null : fromKilograms(kg, unit));

  // Every value is computed once per weigh-in; the charts below only pick columns.
  const rows = useMemo<Row[]>(
    () =>
      [...visible].reverse().map((m) => {
        const na = compositionOf(profile, m);
        const x = xiaomiComparable(m);
        return {
          t: new Date(m.measuredAt).getTime(),
          weight: mass(m.weightKg),
          "fat.c": bodyFatOf(profile, m)?.value ?? null,
          "fat.x": x.bodyFatPct,
          "ffm.c": mass(na?.fatFreeMassKg),
          "ffm.x": mass(x.fatFreeMassKg),
          "water.c": na?.bodyWaterPct ?? null,
          "water.x": x.bodyWaterPct,
          "bmr.c": na?.bmrKcal ?? null,
          "bmr.x": x.bmrKcal,
          skeletalMuscle: mass(na?.skeletalMuscleKg),
          muscleX: mass(m.muscleKg),
          visceral: m.visceralFat,
          protein: m.proteinPct,
          bodyAge: m.bodyAge,
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
        title={`${t("weight")} (${unit})`}
        rows={rows}
        series={one("weight", t("weight"))}
        band={{ min: fromKilograms(healthy.min, unit), max: fromKilograms(healthy.max, unit) }}
        goal={goals.weight ? fromKilograms(goals.weight.targetKg, unit) : null}
        {...plain}
      />
      <TrendChart
        title={`${t("bodyFat")} (%)`}
        rows={rows}
        series={paired("fat.c", "fat.x")}
        band={{ min: fatHealthy.min!, max: fatHealthy.max! }}
        goal={goals.bodyFat?.targetPct ?? null}
        {...plain}
      />
      <TrendChart title={`${t("fatFreeMass")} (${unit})`} rows={rows} series={paired("ffm.c", "ffm.x")} {...plain} />
      <TrendChart title={`${t("bodyWater")} (%)`} rows={rows} series={paired("water.c", "water.x")} {...plain} />
      <TrendChart
        title={`${t("bmr")} (kcal)`}
        rows={rows}
        series={paired("bmr.c", "bmr.x")}
        formatTick={(n) => f.number(n, 0)}
        formatValue={(n) => f.number(n, 0)}
      />
      <TrendChart title={`${t("skeletalMuscle")} (${unit})`} rows={rows} series={one("skeletalMuscle", t("skeletalMuscle"))} {...plain} />

      <h2 className="px-1 pt-2 text-lg font-semibold">{t("xiaomiOnlyTitle")}</h2>
      <p className="-mt-2 px-1 text-sm text-muted">{t("xiaomiOnlyHint")}</p>
      <TrendChart title={`${t("muscle")} (${unit})`} rows={rows} series={[xiaomi("muscleX")]} {...plain} />
      <TrendChart title={t("visceral")} rows={rows} series={[xiaomi("visceral")]} formatTick={(n) => f.number(n, 0)} formatValue={(n) => f.number(n, 0)} />
      <TrendChart title={`${t("protein")} (%)`} rows={rows} series={[xiaomi("protein")]} {...plain} />
      <TrendChart title={t("bodyAge")} rows={rows} series={[xiaomi("bodyAge")]} formatTick={(n) => f.number(n, 0)} formatValue={(n) => f.number(n, 0)} />

      <Card padded={false}>
        <h2 className="px-5 pt-5 text-lg font-semibold">{t("measurements")}</h2>
        <ul className="mt-2 divide-y divide-line">
          {visible.map((m) => {
            const fat = bodyFatOf(profile, m);
            return (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {f.weight(m.weightKg, unit)}
                    {fat && <span className="font-normal text-ink-2"> · {f.number(fat.value)} %</span>}
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
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
