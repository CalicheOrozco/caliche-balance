import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "./i18n.tsx";
import { Card, signed } from "./ui.tsx";

/** One row per weigh-in; each chart reads its own columns, null where a value is missing. */
export type Row = { t: number } & Record<string, number | null>;

export interface Series {
  key: string;
  label: string;
  /** Caliche Balance is solid green; Xiaomi is dashed blue, so the pair differs beyond color. */
  /** Trend is the smoothed "real weight", a long dash in a neutral color so it never reads as Xiaomi. */
  kind: "caliche" | "xiaomi" | "trend";
}

export const SERIES_STYLE = {
  caliche: { stroke: "var(--series)", dash: undefined },
  xiaomi: { stroke: "var(--series-2)", dash: "6 4" },
  trend: { stroke: "var(--ink-2)", dash: "10 4" },
} as const;

/** One measure per chart (never two y-axes). Two series only when they measure the same thing. */
export function TrendChart({
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
      {about && <p className="mt-1 text-[13px] leading-4.75 font-semibold text-ink-2">{about}</p>}
      {now && <p className="mt-2 text-[13px] leading-4.75 font-bold text-ink">{now}</p>}
    </>
  );
  // A chart with fewer than two points says nothing; show why, or leave the card out.
  if (data.length < 2) {
    return empty ? (
      <Card>
        <h2 className="text-base font-extrabold">{title}</h2>
        {notes}
        <p className="mt-2 text-sm font-semibold text-muted">{empty}</p>
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
      <h2 className="text-base font-extrabold">{title}</h2>
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
                  <div className="rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-ink shadow-card">
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
                dot={s.kind !== "trend" && data.length <= 40 ? { r: 3, fill: SERIES_STYLE[s.kind].stroke, stroke: "var(--surface)", strokeWidth: 2 } : false}
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

/** One point of a hand-drawn line: time in ms and value. */
export interface LinePoint {
  t: number;
  v: number;
}

const W = 348;
const PLOT_W = 318;

/** About 3 round steps between lo and hi, for the dashed grid lines. */
function gridValues(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 3;
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/**
 * The redesign's line chart, drawn as SVG: dashed grid with the values on the right, an optional
 * healthy band, a goal line with its label, and up to a few lines (Caliche Balance solid green,
 * Xiaomi dashed blue, the real weight dashed neutral). It scales with the card's width.
 */
export function LineChartSvg({
  lines,
  band = null,
  goal = null,
  goalLabel,
  area = false,
  height = 160,
  formatTick,
  label,
}: {
  lines: { points: LinePoint[]; kind: Series["kind"] }[];
  band?: { min: number; max: number } | null;
  goal?: number | null;
  goalLabel?: string;
  /** A soft fill under the first line. */
  area?: boolean;
  height?: number;
  formatTick: (n: number) => string;
  /** What the chart shows, for screen readers. */
  label: string;
}) {
  const { locale } = useI18n();
  const drawn = lines.filter((l) => l.points.length > 0);
  const all = drawn.flatMap((l) => l.points);
  if (all.length < 2) return null;
  const values = all.map((p) => p.v);
  let lo = Math.min(...values, ...(goal === null ? [] : [goal]));
  let hi = Math.max(...values, ...(goal === null ? [] : [goal]));
  // The band only widens the scale a little past the data, so a far band does not flatten the lines.
  if (band) {
    lo = Math.min(lo, Math.max(band.min, lo - (hi - lo)));
    hi = Math.max(hi, Math.min(band.max, hi + (hi - lo)));
  }
  const pad = Math.max((hi - lo) * 0.12, 0.5);
  lo -= pad;
  hi += pad;
  const top = 10;
  const bottom = height - 10;
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const x = (t: number) => Math.round(((t - t0) / (t1 - t0 || 1)) * PLOT_W * 10) / 10;
  const y = (v: number) => Math.round((top + ((hi - v) / (hi - lo)) * (bottom - top)) * 10) / 10;
  const path = (points: LinePoint[]) =>
    [...points]
      .sort((a, b) => a.t - b.t)
      .map((p, i) => `${i ? "L" : "M"}${x(p.t)} ${y(p.v)}`)
      .join(" ");
  const first = drawn[0]!;
  const sortedFirst = [...first.points].sort((a, b) => a.t - b.t);
  const last = sortedFirst[sortedFirst.length - 1]!;
  const span = t1 - t0;
  const dayMs = 24 * 60 * 60 * 1000;
  const tick = (ms: number) =>
    new Date(ms).toLocaleDateString(
      locale,
      span > 300 * dayMs ? { month: "short", year: "2-digit" } : span > 60 * dayMs ? { month: "short" } : { day: "numeric", month: "short" },
    );
  const ticks = [0, 1, 2, 3].map((i) => t0 + (span * i) / 3);
  const goalY = goal === null ? null : y(goal);
  const goalW = goalLabel ? goalLabel.length * 6.6 + 18 : 0;
  // The label sits above the goal line, or under it when the line is near the top.
  const goalBoxY = goalY === null ? 0 : goalY - 26 < 0 ? goalY + 6 : goalY - 26;
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full overflow-visible" role="img" aria-label={label}>
        {band && (
          <rect
            x={0}
            y={y(Math.min(band.max, hi))}
            width={PLOT_W}
            height={Math.max(y(Math.max(band.min, lo)) - y(Math.min(band.max, hi)), 0)}
            fill="var(--band)"
          />
        )}
        {gridValues(lo, hi).map((v) => (
          <g key={v}>
            <line x1={0} x2={PLOT_W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 5" />
            <text x={W} y={y(v) + 4} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--muted)">
              {formatTick(v)}
            </text>
          </g>
        ))}
        {goalY !== null && (
          <>
            <line x1={0} x2={PLOT_W} y1={goalY} y2={goalY} stroke="var(--brand)" strokeWidth={1.5} strokeDasharray="6 5" />
            {goalLabel && (
              <>
                <rect x={0} y={goalBoxY} width={goalW} height={20} rx={10} fill="var(--brand-soft)" />
                <text x={goalW / 2} y={goalBoxY + 14} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--brand-text)">
                  {goalLabel}
                </text>
              </>
            )}
          </>
        )}
        {area && sortedFirst.length > 1 && (
          <path d={`${path(sortedFirst)} L${x(last.t)} ${bottom} L${x(sortedFirst[0]!.t)} ${bottom} Z`} fill="var(--chart-fill)" />
        )}
        {[...drawn].reverse().map((l, i) => (
          <path
            key={i}
            d={path(l.points)}
            fill="none"
            stroke={l.kind === "caliche" ? "var(--brand)" : SERIES_STYLE[l.kind].stroke}
            strokeWidth={2.5}
            strokeDasharray={l.kind === "caliche" ? undefined : SERIES_STYLE[l.kind].dash}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <circle cx={x(last.t)} cy={y(last.v)} r={5} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
      </svg>
      <figcaption className="mt-0.5 flex justify-between text-[11px] font-semibold text-muted" style={{ width: `${(PLOT_W / W) * 100}%` }}>
        {ticks.map((ms) => (
          <span key={ms}>{tick(ms)}</span>
        ))}
      </figcaption>
    </figure>
  );
}

/** A tiny line with no axes, for the small cards. */
export function Spark({ values, width = 128, height = 40 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <div style={{ height }} aria-hidden />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${Math.round((i * width) / (values.length - 1))} ${Math.round(4 + ((hi - v) / (hi - lo || 1)) * (height - 8))}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke="var(--brand)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
