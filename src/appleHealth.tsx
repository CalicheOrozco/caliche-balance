import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiCheck, FiChevronDown, FiChevronRight, FiCopy, FiDownload, FiHeart, FiInfo, FiMoon } from "react-icons/fi";
import { Link } from "react-router";
import { healthTargets, type PersonFacts } from "../shared/healthReference.ts";
import { type SleepPart, type SleepScore, sleepScoreOf } from "../shared/sleepScore.ts";
import { type AppleHealthStatus, type HealthDayDto, HEALTH_METRICS, type SleepSegment, HEALTH_SHORTCUT_VERSION, type HealthMetric, healthAverages } from "../shared/health.ts";
import type { UserDto } from "../shared/schemas.ts";
import { api } from "./api.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Button, Card, Modal, useFormat } from "./ui.tsx";

/** The signed Shortcut built by scripts/build-health-shortcut.py. */
const SHORTCUT_FILE = "/shortcuts/caliche-salud.shortcut";
/** The one-time Shortcut that brings in the last 12 months. */
const YEAR_SHORTCUT_FILE = "/shortcuts/caliche-salud-anio.shortcut";
/** Metrics the Shortcut sends today; sleep can be sent by hand-built Shortcuts. */
const SENT: HealthMetric[] = ["steps", "activeKcal", "exerciseMin", "distanceKm", "restingHr"];

export function useHealthDays(enabled: boolean) {
  return useQuery({ queryKey: ["apple-health", "days"], queryFn: () => api.healthDays(90), enabled });
}

function CopyChip({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-left font-mono text-xs break-all text-ink"
      aria-label={`${t("ahCopy")} ${label ?? value}`}
    >
      <span className="min-w-0 flex-1">{label ?? value}</span>
      <span className="flex shrink-0 items-center gap-1 font-sans text-xs font-medium text-brand">
        {copied ? <FiCheck aria-hidden /> : <FiCopy aria-hidden />} {copied ? t("ahCopied") : t("ahCopy")}
      </span>
    </button>
  );
}

/** Settings: the person's key, the one-tap Shortcut, its status, and a manual guide as a fallback. */
/** Which copy of the Shortcut ran last and what came of it: saved days, or why it failed. */
function LastRun({ attempt }: { attempt: NonNullable<AppleHealthStatus["lastAttempt"]> }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const day = (date: string) => f.date(`${date}T12:00:00`);
  // "days.0.restingHr" reads as the metric's name.
  const field = (path: string) => {
    const last = path.split(".").pop() ?? path;
    return (HEALTH_METRICS as string[]).includes(last) ? t(`ahMetric.${last}` as MessageKey) : path;
  };
  const current = attempt.version === HEALTH_SHORTCUT_VERSION;
  return (
    <div className="mt-2 space-y-1 text-sm">
      <p className={current ? "text-good" : "text-warn"}>
        {current
          ? tf("ahVersionCurrent", { n: attempt.version ?? 0 })
          : tf("ahVersionOld", { n: attempt.version === null ? t("ahVersionNone") : String(attempt.version) })}
      </p>
      {attempt.ok ? (
        <p className="text-ink-2">
          {tf("ahLastOk", {
            when: f.dateTime(attempt.at),
            days: attempt.saved.map((d) => tf("ahDayCount", { date: day(d.date), n: d.count })).join(", "),
          })}
        </p>
      ) : (
        <p className="text-bad">{tf("ahLastFailed", { when: f.dateTime(attempt.at) })}</p>
      )}
      {attempt.problems.length > 0 && (
        <div className={attempt.ok ? "text-warn" : "text-bad"}>
          {attempt.ok && <p>{t("ahLeftOut")}</p>}
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {attempt.problems.map((p) => (
              <li key={p.path}>
                {field(p.path)}: {p.code}
                {p.received !== undefined && ` (${tf("ahReceived", { value: String(p.received) })})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {attempt.received && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-brand [&::-webkit-details-marker]:hidden">
            {t("ahReceivedTitle")} <FiChevronDown className="transition group-open:rotate-180" aria-hidden />
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface-2 p-2 text-xs whitespace-pre-wrap break-all text-ink-2">{attempt.received}</pre>
        </details>
      )}
    </div>
  );
}

export function AppleHealthCard({ user }: { user: UserDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const [key, setKey] = useState<string | null>(null);
  const status = user.appleHealth ?? null;
  const url = `${window.location.origin}/api/apple-health/ingest`;
  const refreshMe = () => queryClient.invalidateQueries({ queryKey: ["me"] });
  const create = useMutation({
    mutationFn: api.createHealthKey,
    onSuccess: (made) => {
      setKey(made.key);
      void refreshMe();
    },
  });
  const remove = useMutation({
    mutationFn: api.removeHealthKey,
    onSuccess: () => {
      setKey(null);
      void refreshMe();
    },
  });
  const steps = (keys: MessageKey[]) => (
    <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink-2">
      {keys.map((k) => (
        <li key={k}>{t(k)}</li>
      ))}
    </ol>
  );

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <FiHeart className="text-bad" aria-hidden /> {t("ahTitle")}
      </h2>
      <p className="mt-1 text-sm text-ink-2">{t("ahIntro")}</p>

      {status && (
        <p className="mt-3 text-sm text-ink">
          {tf("ahConnectedSince", { date: f.date(status.since) })}{" "}
          {!status.lastAttempt && (
            <span className={status.lastSyncAt ? "text-good" : "text-muted"}>
              {status.lastSyncAt ? tf("ahLastSync", { when: f.dateTime(status.lastSyncAt) }) : t("ahNoSyncYet")}
            </span>
          )}
        </p>
      )}
      {status?.lastAttempt && <LastRun attempt={status.lastAttempt} />}

      {key && (
        <div className="mt-3 rounded-2xl border-2 border-brand/40 p-3">
          <p className="text-sm font-medium text-ink">{t("ahKeyOnce")}</p>
          <div className="mt-2">
            <CopyChip value={key} />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {!status ? (
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {t("ahMakeKey")}
          </Button>
        ) : (
          <>
            <a
              href={SHORTCUT_FILE}
              download="Caliche Salud.shortcut"
              className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-2.5 font-semibold text-brand-ink"
            >
              <FiDownload aria-hidden /> {tf("ahAddShortcut", { n: HEALTH_SHORTCUT_VERSION })}
            </a>
            <a
              href={YEAR_SHORTCUT_FILE}
              download="Caliche Salud Año.shortcut"
              className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-surface-2 px-4 py-2.5 font-medium text-ink"
            >
              <FiDownload aria-hidden /> {t("ahAddYearShortcut")}
            </a>
            <p className="text-xs text-muted">{t("ahYearShortcutHint")}</p>
            <Button
              variant="secondary"
              disabled={create.isPending}
              onClick={() => {
                if (confirm(t("ahNewKeyConfirm"))) create.mutate();
              }}
            >
              {t("ahNewKey")}
            </Button>
          </>
        )}
      </div>

      <p className="mt-4 text-sm font-semibold">{t("ahQuickTitle")}</p>
      {steps(["ahQuick1", "ahQuick2", "ahQuick3", "ahQuickLarge", "ahQuick4"])}

      <details className="group mt-4">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
          {t("ahGuideTitle")} <FiChevronDown className="transition group-open:rotate-180" aria-hidden />
        </summary>
        {steps(["ahStep1", "ahStep2", "ahStep3", "ahStep4", "ahStep5"])}
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">{t("ahUrl")}</p>
          <CopyChip value={url} />
          <p className="text-xs text-muted">{t("ahHeaderValue")}</p>
          {key ? <CopyChip value={`Bearer ${key}`} /> : <p className="text-xs text-muted">{t("ahHeaderValueHint")}</p>}
        </div>
        <ol start={6} className="mt-3 list-decimal space-y-2 pl-5 text-sm text-ink-2">
          <li>
            {t("ahStep6")}
            <p className="mt-1 text-xs text-muted">{t("ahFieldHint")}</p>
            <div className="mt-1 grid grid-cols-1 gap-1.5">
              {SENT.map((m) => (
                <CopyChip key={m} value={m} label={`${m} → ${t(`ahVar.${m}` as MessageKey)}`} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{t("ahStep6Unit")}</p>
          </li>
          <li>{t("ahStep7")}</li>
          <li>{t("ahStep8")}</li>
        </ol>
      </details>

      {status && (
        <Button
          variant="dangerText"
          className="mt-3 w-full"
          disabled={remove.isPending}
          onClick={() => {
            if (confirm(t("ahDisconnectConfirm"))) remove.mutate();
          }}
        >
          {t("ahDisconnect")}
        </Button>
      )}
    </Card>
  );
}

/** How each metric reads on screen; the unit labels come from the person's language where needed. */
function useMetricFormat() {
  const { t } = useI18n();
  const f = useFormat();
  return (m: HealthMetric, v: number | null | undefined): string => {
    if (v === null || v === undefined) return "-";
    switch (m) {
      case "distanceKm":
        return `${f.number(v)} km`;
      case "activeKcal":
      case "restingKcal":
        return `${f.number(v, 0)} kcal`;
      case "exerciseMin":
      case "standMin":
        return `${f.number(v, 0)} min`;
      case "restingHr":
      case "walkingHr":
        return `${f.number(v, 0)} ${t("ahBpm")}`;
      case "hrvMs":
        return `${f.number(v, 0)} ms`;
      case "respiratoryRate":
        return `${f.number(v)} rpm`;
      case "walkingSpeedKmh":
        return `${f.number(v)} km/h`;
      case "stepLengthCm":
        return `${f.number(v, 0)} cm`;
      case "walkingAsymmetryPct":
      case "bloodOxygenPct":
      case "bodyFatPct":
        return `${f.number(v)} %`;
      case "stairSpeedUpMs":
      case "stairSpeedDownMs":
        return `${f.number(v, 2)} m/s`;
      case "bmi":
        return f.number(v);
      case "environmentalSoundDb":
      case "headphoneAudioDb":
        return `${f.number(v, 0)} dB`;
      default:
        return f.number(v, 0);
    }
  };
}

/** "7 h 05 min", or "55 min" under an hour. */
export function hoursText(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, "0")} min`;
}

/** What is recommended for this person for one measure, with the day's value and the week's average. */
function HealthInfoModal({
  metric,
  person,
  unit,
  value,
  week,
  onClose,
}: {
  metric: HealthMetric | "totalKcal";
  person: PersonFacts;
  unit: "kg" | "lb";
  value: string;
  week: string;
  onClose: () => void;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const x = healthTargets(person);
  const n = (v: number, digits = 0) => f.number(v, digits);
  const params: Record<string, string | number> = {
    bmr: n(x.bmrKcal),
    from: metric === "steps" ? n(x.steps[0]) : metric === "distanceKm" ? n(x.distanceKm[0], 1) : metric === "bodyFatPct" ? n(x.bodyFatPct[0]) : f.weight(x.healthyWeightKg.min, unit),
    to: metric === "steps" ? n(x.steps[1]) : metric === "distanceKm" ? n(x.distanceKm[1], 1) : metric === "bodyFatPct" ? n(x.bodyFatPct[1]) : f.weight(x.healthyWeightKg.max, unit),
    step: n(x.stepLengthCm),
    stepsFrom: n(x.steps[0]),
    stepsTo: n(x.steps[1]),
    kcal: n(x.activeDayKcal),
    loss: x.exerciseForLoss ? t("ahInfo.exerciseLoss") : "",
  };
  return (
    <Modal title={metric === "totalKcal" ? t("ahTotalKcal") : t(`ahMetric.${metric}` as MessageKey)} onClose={onClose}>
      <p className="text-sm font-medium text-ink">{tf("ahInfoToday", { value, week })}</p>
      <p className="mt-3 text-sm text-ink-2">{tf(`ahInfo.${metric}` as MessageKey, params)}</p>
      <p className="mt-4 text-xs text-muted">{t("ahInfoNote")}</p>
    </Modal>
  );
}

/** The last day with any activity; Health's "Fill Missing" makes a day that just started all zeros. */
export function lastActiveIndex(days: HealthDayDto[]): number {
  return days.findLastIndex((d) => (d.steps ?? 0) > 0 || (d.activeKcal ?? 0) > 0 || (d.exerciseMin ?? 0) > 0);
}

/** Shown first; everything else is one tap away under "See all". */
const KEY_METRICS: HealthMetric[] = ["steps", "exerciseMin", "standMin", "distanceKm", "restingHr", "hrvMs"];

const GROUPS: { key: "activity" | "energy" | "heart" | "body"; metrics: HealthMetric[] }[] = [
  { key: "activity", metrics: ["steps", "distanceKm", "flightsClimbed", "exerciseMin", "standMin", "walkingSpeedKmh", "stepLengthCm", "walkingAsymmetryPct", "stairSpeedUpMs", "stairSpeedDownMs"] },
  { key: "energy", metrics: ["activeKcal", "restingKcal"] },
  { key: "heart", metrics: ["restingHr", "hrvMs", "walkingHr", "respiratoryRate", "bloodOxygenPct"] },
  { key: "body", metrics: ["bodyFatPct", "bmi", "environmentalSoundDb", "headphoneAudioDb"] },
];

/** The latest day from Apple Health next to the 7-day average: total calories burned and the key numbers, then the rest (folded unless expanded). */
export function HealthTodayCard({
  connected,
  expanded = false,
  date,
  person,
  unit = "kg",
}: {
  connected: boolean;
  expanded?: boolean;
  date?: string;
  /** With it, each number gets an info button with what is recommended for this person. */
  person?: PersonFacts;
  unit?: "kg" | "lb";
}) {
  const { t, tf } = useI18n();
  const [info, setInfo] = useState<HealthMetric | "totalKcal" | null>(null);
  const f = useFormat();
  const format = useMetricFormat();
  const all = useHealthDays(connected).data ?? [];
  // A chosen day, or else the last day that has activity (right after midnight today is all zeros).
  const shown = date === undefined ? lastActiveIndex(all) : all.findIndex((d) => d.date === date);
  const days = shown === -1 ? (date === undefined ? all : []) : all.slice(0, shown + 1);
  const latest = days[days.length - 1];
  if (!latest) return null;
  const week = healthAverages(days.slice(-7));
  const total = latest.activeKcal !== null && latest.restingKcal !== null ? latest.activeKcal + latest.restingKcal : null;
  const weekTotal = week.activeKcal !== null && week.restingKcal !== null ? week.activeKcal + week.restingKcal : null;
  const symptoms = Object.entries(latest.symptoms) as [keyof typeof latest.symptoms, string][];
  const has = (m: HealthMetric) => latest[m] !== null || week[m] !== null;
  const infoButton = (m: HealthMetric | "totalKcal") =>
    person && (
      <button
        type="button"
        onClick={() => setInfo(m)}
        aria-label={`${t("ahInfoOpen")}: ${m === "totalKcal" ? t("ahTotalKcal") : t(`ahMetric.${m}` as MessageKey)}`}
        className="-m-1.5 shrink-0 rounded-full p-1.5 text-muted transition hover:text-ink"
      >
        <FiInfo size={16} aria-hidden />
      </button>
    );
  const tile = (m: HealthMetric) => (
    <div key={m} className="rounded-2xl bg-surface-2 p-3">
      <dt className="flex items-start justify-between gap-1 text-xs text-ink-2">
        <span>{t(`ahMetric.${m}` as MessageKey)}</span>
        {infoButton(m)}
      </dt>
      <dd className="text-lg font-semibold">{format(m, latest[m])}</dd>
      <dd className="text-xs text-muted">
        {t("ahWeekAvg")}: {format(m, week[m])}
      </dd>
    </div>
  );
  // Everything past the key numbers, by group: folded on Home, open on the Activity page.
  const rest = GROUPS.map((g) => {
    const shown = g.metrics.filter((m) => !KEY_METRICS.includes(m) && has(m));
    if (shown.length === 0) return null;
    return (
      <div key={g.key} className="mt-4">
        <p className="text-sm font-semibold text-ink-2">{t(`ahGroup.${g.key}` as MessageKey)}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2">{shown.map(tile)}</dl>
      </div>
    );
  });
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <FiHeart className="text-bad" aria-hidden /> {t("ahTodayTitle")}
      </h2>
      <p className="text-sm text-muted">{tf("ahFrom", { date: f.date(`${latest.date}T12:00:00`) })}</p>
      {total !== null && (
        <div className="mt-3 rounded-2xl bg-brand/10 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-ink-2">{t("ahTotalKcal")}</p>
            {infoButton("totalKcal")}
          </div>
          <p className="text-2xl font-bold">{f.number(total, 0)} kcal</p>
          {weekTotal !== null && (
            <p className="text-xs text-muted">
              {t("ahWeekAvg")}: {f.number(weekTotal, 0)} kcal
            </p>
          )}
          <p className="mt-1 text-xs text-ink-2">{t("ahTotalKcalHint")}</p>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2">{KEY_METRICS.filter(has).map(tile)}</dl>
      {expanded
        ? rest
        : GROUPS.some((g) => g.metrics.some((m) => !KEY_METRICS.includes(m) && has(m))) && (
            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
                {t("ahSeeAll")} <FiChevronDown className="transition group-open:rotate-180" aria-hidden />
              </summary>
              {rest}
            </details>
          )}
      {symptoms.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-ink-2">{t("ahSymptomsTitle")}</p>
          <ul className="mt-1 text-sm text-ink">
            {symptoms.map(([s, v]) => (
              <li key={s}>
                {t(`ahSymptom.${s}` as MessageKey)}: {v}
              </li>
            ))}
          </ul>
        </div>
      )}
      {info && person && (
        <HealthInfoModal
          metric={info}
          person={person}
          unit={unit}
          value={info === "totalKcal" ? (total === null ? "-" : `${f.number(total, 0)} kcal`) : format(info, latest[info])}
          week={info === "totalKcal" ? (weekTotal === null ? "-" : `${f.number(weekTotal, 0)} kcal`) : format(info, week[info])}
          onClose={() => setInfo(null)}
        />
      )}
    </Card>
  );
}

const STAGE_COLOR = { deep: "bg-[#3b5bdb]", core: "bg-[#4dabf7]", rem: "bg-[#22b8cf]", awake: "bg-[#f59f00]" } as const;
/** The same colors for the chart, which draws in SVG; "asleep" (no Watch stages) shares core's. */
const STAGE_HEX = { deep: "#3b5bdb", core: "#4dabf7", rem: "#22b8cf", awake: "#f59f00", asleep: "#4dabf7" } as const;
/** Rows from top to bottom, as Apple Health draws them. */
const CHART_ROWS = ["awake", "rem", "core", "deep"] as const;

/**
 * The night stage by stage over time, like Apple Health's: a row per stage, a bar for each stretch,
 * thin lines where it moves from one stage to the next, and the hours underneath.
 */
function SleepChart({ segments }: { segments: SleepSegment[] }) {
  const { t, tf, locale } = useI18n();
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (segments.length === 0) return null;
  const from = Date.parse(segments[0]!.start);
  const to = Math.max(...segments.map((x) => Date.parse(x.end)));
  const W = 320;
  const LABEL = 48;
  const ROW = 38;
  const BAR = 18;
  const H = ROW * CHART_ROWS.length + 18;
  const x = (iso: string) => LABEL + ((Date.parse(iso) - from) / (to - from)) * (W - LABEL - 4);
  const rowOf = (stage: SleepSegment["stage"]) => CHART_ROWS.indexOf(stage === "asleep" ? "core" : stage);
  const y = (stage: SleepSegment["stage"]) => rowOf(stage) * ROW + ROW / 2;
  // Every 2 hours on the hour, local time.
  const ticks: number[] = [];
  const first = new Date(from);
  first.setMinutes(0, 0, 0);
  for (let t0 = first.getTime() + 3_600_000; t0 < to; t0 += 3_600_000) if (new Date(t0).getHours() % 2 === 0) ticks.push(t0);
  const xs = (ms: number) => LABEL + ((ms - from) / (to - from)) * (W - LABEL - 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={t("sleepChartLabel")}>
      {CHART_ROWS.map((r, i) => (
        <g key={r}>
          <line x1={LABEL} x2={W} y1={(i + 1) * ROW} y2={(i + 1) * ROW} stroke="var(--line)" strokeWidth={0.5} />
          <text x={0} y={i * ROW + ROW / 2 + 4} fontSize={10} fill="var(--ink-2)">
            {t(`sleepStage.${r}` as MessageKey)}
          </text>
        </g>
      ))}
      {ticks.map((t0) => (
        <g key={t0}>
          <line x1={xs(t0)} x2={xs(t0)} y1={0} y2={ROW * CHART_ROWS.length} stroke="var(--line)" strokeWidth={0.5} strokeDasharray="2 3" />
          <text x={xs(t0)} y={H - 4} fontSize={9} fill="var(--muted)" textAnchor="middle">
            {new Date(t0).toLocaleTimeString(locale, { hour: "numeric" })}
          </text>
        </g>
      ))}
      {segments.slice(1).map((seg, i) => {
        const prev = segments[i]!;
        return <line key={`l${i}`} x1={x(seg.start)} x2={x(seg.start)} y1={y(prev.stage)} y2={y(seg.stage)} stroke="var(--muted)" strokeWidth={1} opacity={0.6} />;
      })}
      {segments.map((seg, i) => (
        <rect
          key={i}
          x={x(seg.start)}
          y={y(seg.stage) - BAR / 2}
          width={Math.max(x(seg.end) - x(seg.start), 1.5)}
          height={BAR}
          rx={4}
          fill={STAGE_HEX[seg.stage]}
        >
          <title>
            {tf("sleepSegmentSpan", {
              stage: t(`sleepStage.${seg.stage === "asleep" ? "core" : seg.stage}` as MessageKey),
              start: clock(seg.start),
              end: clock(seg.end),
            })}
          </title>
        </rect>
      ))}
    </svg>
  );
}

/** Home: last night's sleep with its stages, against the 7-day average. */
/** The sleep score of the night on days[index], with the nights before it for the usual bedtime. */
export function nightScore(days: HealthDayDto[], index: number): SleepScore | null {
  const night = days[index]?.sleep;
  if (!night) return null;
  const before = days.slice(0, index).flatMap((d) => (d.sleep ? [d.sleep] : []));
  return sleepScoreOf(night, before, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** A 0 to 100 score in a ring, with its name under it. */
function ScoreRing({ score, label }: { score: number; label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface-2)" strokeWidth="3.5" />
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--brand)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${score} 100`} pathLength={100} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-bold">{score}</span>
      </div>
      <span className="mt-0.5 text-xs text-ink-2">{label}</span>
    </div>
  );
}

/** Each part of the sleep score with what it read, folded. */
function SleepScoreParts({ score }: { score: SleepScore }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const x = score.facts;
  const read: Record<SleepPart, string> = {
    duration: hoursText(x.asleepMin),
    stages: x.deepPct !== null && x.remPct !== null ? tf("sleepScoreStages", { deep: f.number(x.deepPct, 0), rem: f.number(x.remPct, 0) }) : "-",
    continuity: [
      x.awakeMin !== null ? tf("sleepScoreAwake", { min: f.number(x.awakeMin, 0) }) : null,
      x.awakenings === 1 ? t("sleepAwakeningsOne") : tf("sleepAwakenings", { n: x.awakenings }),
      x.efficiencyPct !== null ? tf("sleepScoreEfficiency", { pct: f.number(x.efficiencyPct, 0) }) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    regularity: x.bedtimeOffMin !== null ? tf("sleepScoreBedtime", { min: f.number(x.bedtimeOffMin, 0) }) : "-",
  };
  return (
    <details className="group mt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
        {t("sleepScoreHow")} <FiChevronDown className="transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-3 space-y-3">
        {score.parts.map((p) => (
          <li key={p.part}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">
                {t(`sleepPart.${p.part}` as MessageKey)} <span className="text-muted">· {read[p.part]}</span>
              </span>
              <span className="shrink-0 text-ink-2">
                <strong className="text-ink">{Math.round(p.score)}</strong>/100 · {tf("scorePartWeight", { weight: Math.round(p.weight * 100) })}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(p.score, 2)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">{t("sleepScoreNote")}</p>
    </details>
  );
}

/** "Noche del 24 al 25 oct": a night is filed on the day you woke up. */
function useNightLabel() {
  const { tf, locale } = useI18n();
  return (wakeDay: string) => {
    const wake = new Date(`${wakeDay}T12:00:00`);
    const before = new Date(wake.getTime() - 86_400_000);
    return tf("sleepNightOf", {
      from: before.toLocaleDateString(locale, before.getMonth() === wake.getMonth() ? { day: "numeric" } : { day: "numeric", month: "short" }),
      to: wake.toLocaleDateString(locale, { day: "numeric", month: "short" }),
    });
  };
}

/**
 * Last night, or the night that ended on `date` (the Activity page's day picker), with the average
 * of the 7 days up to it.
 */
export function SleepCard({ connected, date }: { connected: boolean; date?: string }) {
  const { t, tf, locale } = useI18n();
  const nightLabel = useNightLabel();
  const all = useHealthDays(connected).data ?? [];
  const index = date === undefined ? all.findLastIndex((d) => d.sleep) : all.findIndex((d) => d.date === date);
  const day = all[index];
  if (date === undefined && !day) return null;
  const night = day?.sleep;
  if (!night) {
    return (
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FiMoon className="text-brand" aria-hidden /> {t("sleepTitle")}
        </h2>
        {date && <p className="text-sm text-muted">{nightLabel(date)}</p>}
        <p className="mt-2 text-sm text-ink-2">{t("sleepNone")}</p>
      </Card>
    );
  }
  const week = healthAverages(all.slice(Math.max(0, index - 6), index + 1)).sleepMin;
  const score = nightScore(all, index);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const stages = (["deep", "core", "rem", "awake"] as const).map((k) => ({ k, min: night[`${k}Min`] })).filter((s) => s.min !== null && s.min > 0);
  const total = stages.reduce((sum, s) => sum + (s.min ?? 0), 0);
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <FiMoon className="text-brand" aria-hidden /> {t("sleepTitle")}
      </h2>
      <p className="text-sm text-muted">{nightLabel(day.date)}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-bold">{tf("sleepAsleep", { hours: hoursText(night.asleepMin) })}</p>
          <p className="text-sm text-ink-2">{tf("sleepSpan", { start: time(night.start), end: time(night.end) })}</p>
          {night.inBedMin !== null && <p className="text-sm text-muted">{tf("sleepInBed", { hours: hoursText(night.inBedMin) })}</p>}
        </div>
        {score && <ScoreRing score={score.score} label={t("sleepScore")} />}
      </div>
      {night.segments && night.segments.length > 0 ? (
        <SleepChart segments={night.segments} />
      ) : (
        // Saved before stage times were kept: only the totals are there, so there is no timeline to draw.
        <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{t("sleepChartMissing")}</p>
      )}
      {score?.facts.bedtimeDiffMin != null && score.facts.usualBedtimeMin !== null && Math.abs(score.facts.bedtimeDiffMin) >= 5 && (
        <p className="mt-2 text-sm text-ink-2">
          {tf(score.facts.bedtimeDiffMin < 0 ? "sleepBedtimeEarlier" : "sleepBedtimeLater", {
            min: Math.round(Math.abs(score.facts.bedtimeDiffMin)),
            usual: new Date(2000, 0, 1, Math.floor(score.facts.usualBedtimeMin / 60), score.facts.usualBedtimeMin % 60).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
          })}
        </p>
      )}
      {total > 0 ? (
        <>
          <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {stages.map((s) => (
              <div key={s.k} className={STAGE_COLOR[s.k]} style={{ width: `${((s.min ?? 0) / total) * 100}%` }} />
            ))}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {stages.map((s) => (
              <div key={s.k} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${STAGE_COLOR[s.k]}`} aria-hidden />
                <dt className="text-ink-2">{t(`sleepStage.${s.k}` as MessageKey)}</dt>
                <dd className="ml-auto font-medium">{hoursText(s.min ?? 0)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-ink-2">{night.awakenings === 1 ? t("sleepAwakeningsOne") : tf("sleepAwakenings", { n: night.awakenings })}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{t("sleepNoStages")}</p>
      )}
      {week !== null && <p className="mt-2 text-sm text-muted">{tf("sleepWeekAvg", { hours: hoursText(week) })}</p>}
      {night.asleepMin > 0 && night.asleepMin < 7 * 60 && <p className="mt-2 text-sm text-warn">{t("sleepShort")}</p>}
      {score && <SleepScoreParts score={score} />}
    </Card>
  );
}

/** Home: last night and the latest active day in four numbers, with the way to everything else. */
export function ActivityGlanceCard({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  const f = useFormat();
  const days = useHealthDays(connected).data ?? [];
  const night = [...days].reverse().find((d) => d.sleep)?.sleep;
  const day = days[lastActiveIndex(days)];
  if (!night && !day) return null;
  const total = day && day.activeKcal !== null && day.restingKcal !== null ? day.activeKcal + day.restingKcal : null;
  const tiles = [
    { label: t("ahGlanceSleep"), value: night ? hoursText(night.asleepMin) : "-" },
    { label: t("ahMetric.steps"), value: day?.steps != null ? f.number(day.steps, 0) : "-" },
    { label: t("ahTotalKcal"), value: total !== null ? `${f.number(total, 0)} kcal` : "-" },
    { label: t("ahMetric.exerciseMin"), value: day?.exerciseMin != null ? `${f.number(day.exerciseMin, 0)} min` : "-" },
  ];
  return (
    <Card>
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-xs text-ink-2">{x.label}</dt>
            <dd className="text-lg font-semibold">{x.value}</dd>
          </div>
        ))}
      </dl>
      {day && <p className="mt-2 text-xs text-muted">{t("ahFrom").replace("{date}", f.date(`${day.date}T12:00:00`))}</p>}
      <Link
        to="/actividad"
        className="mt-3 flex min-h-11 items-center justify-center gap-1 rounded-2xl bg-surface-2 px-4 py-2.5 font-medium text-ink"
      >
        {t("ahGlanceMore")} <FiChevronRight size={18} aria-hidden />
      </Link>
    </Card>
  );
}
