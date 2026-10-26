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

const SERIES_STYLE = {
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
