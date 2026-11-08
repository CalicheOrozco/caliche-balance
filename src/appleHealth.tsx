import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FiAlertCircle, FiCheck, FiChevronDown, FiChevronRight, FiCopy, FiDownload, FiHeart, FiInfo, FiMoon } from "react-icons/fi";
import { Link } from "react-router";
import { healthTargets, type PersonFacts } from "../shared/healthReference.ts";
import { type SleepPart, type SleepScore, sleepScoreOf } from "../shared/sleepScore.ts";
import { type AppleHealthStatus, type HealthDayDto, HEALTH_METRICS, type SleepSegment, type SleepSummary, HEALTH_SHORTCUT_VERSION, type HealthMetric, healthAverages } from "../shared/health.ts";
import type { UserDto } from "../shared/schemas.ts";
import { api } from "./api.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Button, Card, Modal, Progress, Rings, useFormat } from "./ui.tsx";

/** The signed Shortcut built by scripts/build-health-shortcut.py. */
const SHORTCUT_FILE = "/shortcuts/caliche-salud.shortcut";
/** The one-time Shortcuts that bring in the last 12 months, in 4 parts so none runs out of memory. */
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
      <span className="flex shrink-0 items-center gap-1 font-sans text-xs font-bold text-brand-text">
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
      <p className={current ? "text-good-text" : "text-warn-text"}>
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
        <p className="text-bad-text">{tf("ahLastFailed", { when: f.dateTime(attempt.at) })}</p>
      )}
      {attempt.problems.length > 0 && (
        <div className={attempt.ok ? "text-warn-text" : "text-bad-text"}>
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
          <summary className="flex cursor-pointer list-none items-center gap-1 font-bold text-brand-text [&::-webkit-details-marker]:hidden">
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
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <FiHeart className="text-bad-text" aria-hidden /> {t("ahTitle")}
      </h2>
      <p className="mt-1 text-sm text-ink-2">{t("ahIntro")}</p>

      {status && (
        <p className="mt-3 text-sm text-ink">
          {tf("ahConnectedSince", { date: f.date(status.since) })}{" "}
          {!status.lastAttempt && (
            <span className={status.lastSyncAt ? "text-good-text" : "text-muted"}>
              {status.lastSyncAt ? tf("ahLastSync", { when: f.dateTime(status.lastSyncAt) }) : t("ahNoSyncYet")}
            </span>
          )}
        </p>
      )}
      {status?.lastAttempt && <LastRun attempt={status.lastAttempt} />}

      {key && (
        <div className="mt-3 rounded-2xl border-2 border-brand p-3">
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
              className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-2.5 font-extrabold text-brand-ink"
            >
              <FiDownload aria-hidden /> {tf("ahAddShortcut", { n: HEALTH_SHORTCUT_VERSION })}
            </a>
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
        <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-bold text-brand-text [&::-webkit-details-marker]:hidden">
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
      <dt className="flex items-start justify-between gap-1 text-xs font-bold text-ink-2">
        <span>{t(`ahMetric.${m}` as MessageKey)}</span>
        {infoButton(m)}
      </dt>
      <dd className="text-lg font-extrabold">{format(m, latest[m])}</dd>
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
        <p className="text-[13px] font-extrabold tracking-[0.06em] text-muted uppercase">{t(`ahGroup.${g.key}` as MessageKey)}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2">{shown.map(tile)}</dl>
      </div>
    );
  });
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <FiHeart className="text-bad-text" aria-hidden /> {t("ahTodayTitle")}
      </h2>
      <p className="text-sm text-muted">{tf("ahFrom", { date: f.date(`${latest.date}T12:00:00`) })}</p>
      {total !== null && (
        <div className="mt-3 rounded-2xl bg-brand-soft p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-ink-2">{t("ahTotalKcal")}</p>
            {infoButton("totalKcal")}
          </div>
          <p className="text-[28px] leading-8 font-extrabold">{f.number(total, 0)} kcal</p>
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
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-bold text-brand-text [&::-webkit-details-marker]:hidden">
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

/** Stage colors from the design tokens; "asleep" (no Watch stages) shares core's. */
const STAGE_FILL = { deep: "var(--sleep-deep)", core: "var(--sleep-core)", rem: "var(--sleep-rem)", awake: "var(--sleep-awake)", asleep: "var(--sleep-core)" } as const;
/** Rows from top to bottom, as Apple Health draws them. */
const CHART_ROWS = ["awake", "rem", "core", "deep"] as const;

/**
 * The night stage by stage over time, like Apple Health's: a row per stage, a bar for each stretch,
 * and the hours underneath. Touching, dragging or hovering over it shows, as in Apple Health, the
 * stage at that moment with its stretch and how long it lasted; arrow keys step from one stretch
 * to the next.
 */
function SleepChart({ segments }: { segments: SleepSegment[] }) {
  const { t, tf, locale } = useI18n();
  const [at, setAt] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (segments.length === 0) return null;
  const spans = segments.map((seg) => ({ stage: seg.stage === "asleep" ? ("core" as const) : seg.stage, s: Date.parse(seg.start), e: Date.parse(seg.end) }));
  const from = spans[0]!.s;
  const to = Math.max(...spans.map((x) => x.e));
  const W = 280;
  const ROW = 24;
  const BAR = 16;
  const H = ROW * CHART_ROWS.length - (ROW - BAR);
  const x = (ms: number) => ((ms - from) / (to - from)) * W;
  const rowOf = (stage: (typeof spans)[number]["stage"]) => CHART_ROWS.indexOf(stage);
  // Start, end and two times in between.
  const marks = [0, 1 / 3, 2 / 3, 1].map((k) => from + k * (to - from));
  const current = at === null ? -1 : spans.findIndex((sp) => at >= sp.s && at < sp.e);
  const picked = current >= 0 ? spans[current]! : null;

  const timeAt = (clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    const k = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return from + k * (to - from);
  };
  const follow = (e: React.PointerEvent) => {
    // A mouse follows on hover; a finger on touch and while dragging.
    if (e.pointerType === "mouse" || e.buttons > 0 || e.type === "pointerdown") setAt(timeAt(e.clientX));
  };
  const step = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Escape") return;
    e.preventDefault();
    if (e.key === "Escape") return setAt(null);
    const next = current < 0 ? (e.key === "ArrowRight" ? 0 : spans.length - 1) : Math.min(spans.length - 1, Math.max(0, current + (e.key === "ArrowRight" ? 1 : -1)));
    setAt(spans[next]!.s);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Fixed height, so the chart does not jump while reading it. */}
      <div className="flex min-h-10 flex-col justify-center pl-16.5" aria-live="polite">
        {at === null ? (
          <span className="text-xs font-semibold text-muted">{t("act.sleepChartHint")}</span>
        ) : picked ? (
          <>
            <span className="flex items-center gap-1.5 text-sm font-extrabold">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STAGE_FILL[picked.stage] }} aria-hidden />
              {t(`sleepStage.${picked.stage}` as MessageKey)} · {clock(at)}
            </span>
            <span className="text-xs font-semibold text-muted">
              {tf("act.sleepChartSpan", { start: clock(picked.s), end: clock(picked.e), duration: hoursText((picked.e - picked.s) / 60_000) })}
            </span>
          </>
        ) : (
          <span className="text-sm font-extrabold">
            {clock(at)} · <span className="text-muted">{t("act.sleepChartGap")}</span>
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex w-14.5 shrink-0 flex-col justify-between text-[10px] font-bold text-muted" style={{ height: H }} aria-hidden>
          {CHART_ROWS.map((r) => (
            <span key={r} className="leading-4">
              {t(`sleepStage.${r}` as MessageKey)}
            </span>
          ))}
        </div>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="min-w-0 flex-1 cursor-crosshair touch-pan-y outline-none"
          style={{ height: H }}
          role="img"
          tabIndex={0}
          aria-label={t("act.sleepChartRows")}
          onPointerDown={follow}
          onPointerMove={follow}
          onPointerLeave={(e) => e.pointerType === "mouse" && setAt(null)}
          onKeyDown={step}
          onBlur={() => setAt(null)}
        >
          {spans.map((sp, i) => (
            <rect
              key={i}
              x={x(sp.s)}
              y={rowOf(sp.stage) * ROW}
              width={Math.max(x(sp.e) - x(sp.s) - 1, 2)}
              height={BAR}
              rx={4}
              fill={STAGE_FILL[sp.stage]}
              opacity={current < 0 || i === current ? 1 : 0.35}
            >
              <title>{tf("sleepSegmentSpan", { stage: t(`sleepStage.${sp.stage}` as MessageKey), start: clock(sp.s), end: clock(sp.e) })}</title>
            </rect>
          ))}
          {at !== null && <line x1={x(at)} x2={x(at)} y1={0} y2={H} stroke="var(--ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.8} />}
        </svg>
      </div>
      <div className="flex justify-between pl-16.5 text-[11px] font-semibold text-muted" aria-hidden>
        {marks.map((m) => (
          <span key={m}>{clock(m)}</span>
        ))}
      </div>
    </div>
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
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-bold text-brand-text [&::-webkit-details-marker]:hidden">
        {t("sleepScoreHow")} <FiChevronDown className="transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-1 space-y-3">
        {score.parts.map((p) => (
          <li key={p.part}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-bold">
              <span className="text-ink-2">
                {t(`sleepPart.${p.part}` as MessageKey)} <span className="text-muted">· {read[p.part]}</span>
              </span>
              <span className="shrink-0">
                {Math.round(p.score)} <span className="text-muted">/ 100 · {tf("scorePartWeight", { weight: Math.round(p.weight * 100) })}</span>
              </span>
            </div>
            <Progress fraction={p.score / 100} height={8} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] font-semibold text-muted">{t("sleepScoreNote")}</p>
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

/** One factor of the night: its name, what it read, and a check or a warning. */
function FactorTile({ label, value, good }: { label: string; value: string; good: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 rounded-[14px] bg-surface-2 px-3 py-2.5">
      <span className={`flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full ${good ? "bg-good-soft text-good-text" : "bg-warn-soft text-warn-text"}`}>
        {good ? <FiCheck size={12} strokeWidth={3} aria-hidden /> : <FiAlertCircle size={12} strokeWidth={3} aria-hidden />}
        <span className="sr-only">{good ? t("act.factorGood") : t("act.factorWarn")}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-bold text-muted">{label}</span>
        <span className="truncate text-sm font-extrabold">{value}</span>
      </span>
    </div>
  );
}

/** The night's factors next to the published references the sleep score uses. */
function SleepFactors({ night, score }: { night: SleepSummary; score: SleepScore | null }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const x = score?.facts;
  const pctOf = (min: number | null) => (min !== null && night.asleepMin > 0 ? (min / night.asleepMin) * 100 : null);
  const deep = x?.deepPct ?? pctOf(night.deepMin);
  const rem = x?.remPct ?? pctOf(night.remMin);
  const h = night.asleepMin / 60;
  const tiles: { label: string; value: string; good: boolean }[] = [{ label: t("act.factor.duration"), value: hoursText(night.asleepMin), good: h >= 7 && h <= 9 }];
  // Deep 13 to 23 % and REM 20 to 25 % of the night are usual in adults.
  if (deep !== null && night.deepMin !== null) tiles.push({ label: t("act.factor.deep"), value: `${f.number(deep, 0)} % · ${hoursText(night.deepMin)}`, good: deep >= 13 });
  if (rem !== null && night.remMin !== null) tiles.push({ label: t("act.factor.rem"), value: `${f.number(rem, 0)} % · ${hoursText(night.remMin)}`, good: rem >= 20 });
  // National Sleep Foundation: efficiency of 85 % or more and 20 minutes awake or less are good.
  if (x?.efficiencyPct != null) tiles.push({ label: t("act.factor.efficiency"), value: `${f.number(x.efficiencyPct, 0)} %`, good: x.efficiencyPct >= 85 });
  const awake = x?.awakeMin ?? night.awakeMin;
  if (awake !== null) tiles.push({ label: t("act.factor.awake"), value: hoursText(awake), good: awake <= 20 });
  if (x?.bedtimeDiffMin != null) {
    const diff = Math.round(x.bedtimeDiffMin);
    tiles.push({
      label: t("act.factor.bedtime"),
      value: Math.abs(diff) < 5 ? t("act.bedtimeOnTime") : diff > 0 ? tf("act.bedtimeLate", { min: diff }) : tf("act.bedtimeEarly", { min: -diff }),
      good: Math.abs(diff) <= 30,
    });
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {tiles.map((tile) => (
        <FactorTile key={tile.label} {...tile} />
      ))}
    </div>
  );
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
  const heading = (label?: string) => (
    <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-2">
      <FiMoon size={15} strokeWidth={2.2} aria-hidden /> {t("sleepTitle")}
      {label && <span className="font-bold">· {label.charAt(0).toLowerCase() + label.slice(1)}</span>}
    </p>
  );
  if (!night) {
    return (
      <Card className="flex flex-col gap-2">
        {heading(date ? nightLabel(date) : undefined)}
        <p className="text-sm font-semibold text-ink-2">{t("sleepNone")}</p>
      </Card>
    );
  }
  const week = healthAverages(all.slice(Math.max(0, index - 6), index + 1)).sleepMin;
  const score = nightScore(all, index);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const hasStages = [night.deepMin, night.coreMin, night.remMin].some((m) => m !== null && m > 0);
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {heading(nightLabel(day.date))}
          <p className="text-[34px] leading-9.5 font-extrabold tracking-[-0.03em]">{hoursText(night.asleepMin)}</p>
          <p className="text-[13px] font-semibold text-muted">
            {tf("sleepSpan", { start: time(night.start), end: time(night.end) })} ·{" "}
            {night.awakenings === 1 ? t("act.awakeningsOne") : tf("act.awakenings", { n: night.awakenings })}
          </p>
        </div>
        {score && (
          <Rings rings={[{ fraction: score.score / 100, className: "stroke-brand" }]} size={68} stroke={7} label={`${t("sleepScoreTitle")}: ${score.score}`}>
            <span className="text-xl font-extrabold">{score.score}</span>
          </Rings>
        )}
      </div>
      {night.segments && night.segments.length > 0 ? (
        <SleepChart segments={night.segments} />
      ) : (
        // Saved before stage times were kept: only the totals are there, so there is no timeline to draw.
        <p className="rounded-2xl bg-surface-2 px-3.5 py-3 text-[13px] font-semibold text-ink-2">{t("sleepChartMissing")}</p>
      )}
      <SleepFactors night={night} score={score} />
      {!hasStages && <p className="text-[13px] font-semibold text-muted">{t("sleepNoStages")}</p>}
      {score?.facts.bedtimeDiffMin != null && score.facts.usualBedtimeMin !== null && Math.abs(score.facts.bedtimeDiffMin) >= 5 && (
        <p className="text-[13px] font-semibold text-ink-2">
          {tf(score.facts.bedtimeDiffMin < 0 ? "sleepBedtimeEarlier" : "sleepBedtimeLater", {
            min: Math.round(Math.abs(score.facts.bedtimeDiffMin)),
            usual: new Date(2000, 0, 1, Math.floor(score.facts.usualBedtimeMin / 60), score.facts.usualBedtimeMin % 60).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
          })}
        </p>
      )}
      {night.asleepMin > 0 && night.asleepMin < 7 * 60 && (
        <p className="rounded-2xl bg-warn-soft px-3.5 py-3 text-[13px] font-semibold text-warn-text">{t("sleepShort")}</p>
      )}
      {week !== null && <p className="text-[13px] font-semibold text-muted">{tf("sleepWeekAvg", { hours: hoursText(week) })}</p>}
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
    <Card padded={false}>
      <dl className="grid grid-cols-2 gap-2 p-4">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-2xl bg-surface-2 p-3">
            <dt className="text-xs font-bold text-ink-2">{x.label}</dt>
            <dd className="text-lg font-extrabold">{x.value}</dd>
          </div>
        ))}
      </dl>
      {day && <p className="-mt-1 px-5 pb-1 text-xs font-semibold text-muted">{t("ahFrom").replace("{date}", f.date(`${day.date}T12:00:00`))}</p>}
      <Link to="/actividad" className="flex min-h-14 items-center justify-between gap-1 border-t border-line px-5 text-[15px] font-bold text-ink">
        {t("ahGlanceMore")} <FiChevronRight size={18} strokeWidth={2.4} className="text-muted" aria-hidden />
      </Link>
    </Card>
  );
}
