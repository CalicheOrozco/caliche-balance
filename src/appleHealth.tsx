import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiCheck, FiChevronDown, FiCopy, FiDownload, FiHeart, FiMoon } from "react-icons/fi";
import { type AppleHealthStatus, HEALTH_METRICS, HEALTH_SHORTCUT_VERSION, type HealthMetric, healthAverages } from "../shared/health.ts";
import type { UserDto } from "../shared/schemas.ts";
import { api } from "./api.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Button, Card, useFormat } from "./ui.tsx";

/** The signed Shortcut built by scripts/build-health-shortcut.py. */
const SHORTCUT_FILE = "/shortcuts/caliche-salud.shortcut";
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
      case "moveMin":
      case "mindfulMin":
        return `${f.number(v, 0)} min`;
      case "restingHr":
      case "walkingHr":
        return `${f.number(v, 0)} ${t("ahBpm")}`;
      case "hrvMs":
        return `${f.number(v, 0)} ms`;
      case "respiratoryRate":
        return `${f.number(v)} rpm`;
      case "wristTempC":
        return `${f.number(v)} °C`;
      case "waterMl":
        return `${f.number(v / 1000)} L`;
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
      case "waistCm":
        return `${f.number(v)} cm`;
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

const GROUPS: { key: "activity" | "energy" | "heart" | "body"; metrics: HealthMetric[] }[] = [
  { key: "activity", metrics: ["steps", "distanceKm", "flightsClimbed", "exerciseMin", "standMin", "moveMin", "walkingSpeedKmh", "stepLengthCm", "walkingAsymmetryPct", "stairSpeedUpMs", "stairSpeedDownMs"] },
  { key: "energy", metrics: ["activeKcal", "restingKcal"] },
  { key: "heart", metrics: ["restingHr", "hrvMs", "walkingHr", "respiratoryRate", "bloodOxygenPct"] },
  { key: "body", metrics: ["wristTempC", "bodyFatPct", "bmi", "waistCm", "waterMl", "mindfulMin", "environmentalSoundDb", "headphoneAudioDb"] },
];

/** Home: the latest day from Apple Health next to the 7-day average, by group, with total calories burned. */
export function HealthTodayCard({ connected }: { connected: boolean }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const format = useMetricFormat();
  const days = useHealthDays(connected).data ?? [];
  const latest = days[days.length - 1];
  if (!latest) return null;
  const week = healthAverages(days.slice(-7));
  const total = latest.activeKcal !== null && latest.restingKcal !== null ? latest.activeKcal + latest.restingKcal : null;
  const weekTotal = week.activeKcal !== null && week.restingKcal !== null ? week.activeKcal + week.restingKcal : null;
  const symptoms = Object.entries(latest.symptoms) as [keyof typeof latest.symptoms, string][];
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <FiHeart className="text-bad" aria-hidden /> {t("ahTodayTitle")}
      </h2>
      <p className="text-sm text-muted">{tf("ahFrom", { date: f.date(`${latest.date}T12:00:00`) })}</p>
      {total !== null && (
        <div className="mt-3 rounded-2xl bg-brand/10 p-3">
          <p className="text-sm text-ink-2">{t("ahTotalKcal")}</p>
          <p className="text-2xl font-bold">{f.number(total, 0)} kcal</p>
          {weekTotal !== null && (
            <p className="text-xs text-muted">
              {t("ahWeekAvg")}: {f.number(weekTotal, 0)} kcal
            </p>
          )}
          <p className="mt-1 text-xs text-ink-2">{t("ahTotalKcalHint")}</p>
        </div>
      )}
      {GROUPS.map((g) => {
        const shown = g.metrics.filter((m) => latest[m] !== null || week[m] !== null);
        if (shown.length === 0) return null;
        return (
          <div key={g.key} className="mt-4">
            <p className="text-sm font-semibold text-ink-2">{t(`ahGroup.${g.key}` as MessageKey)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              {shown.map((m) => (
                <div key={m} className="rounded-2xl bg-surface-2 p-3">
                  <dt className="text-xs text-ink-2">{t(`ahMetric.${m}` as MessageKey)}</dt>
                  <dd className="text-lg font-semibold">{format(m, latest[m])}</dd>
                  <dd className="text-xs text-muted">
                    {t("ahWeekAvg")}: {format(m, week[m])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
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
    </Card>
  );
}

const STAGE_COLOR = { deep: "bg-[#3b5bdb]", core: "bg-[#4dabf7]", rem: "bg-[#22b8cf]", awake: "bg-[#f59f00]" } as const;

/** Home: last night's sleep with its stages, against the 7-day average. */
export function SleepCard({ connected }: { connected: boolean }) {
  const { t, tf, locale } = useI18n();
  const days = useHealthDays(connected).data ?? [];
  const night = [...days].reverse().find((d) => d.sleep)?.sleep;
  if (!night) return null;
  const week = healthAverages(days.slice(-7)).sleepMin;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const stages = (["deep", "core", "rem", "awake"] as const).map((k) => ({ k, min: night[`${k}Min`] })).filter((s) => s.min !== null && s.min > 0);
  const total = stages.reduce((sum, s) => sum + (s.min ?? 0), 0);
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <FiMoon className="text-brand" aria-hidden /> {t("sleepTitle")}
      </h2>
      <p className="mt-2 text-2xl font-bold">{tf("sleepAsleep", { hours: hoursText(night.asleepMin) })}</p>
      <p className="text-sm text-ink-2">{tf("sleepSpan", { start: time(night.start), end: time(night.end) })}</p>
      {night.inBedMin !== null && <p className="text-sm text-muted">{tf("sleepInBed", { hours: hoursText(night.inBedMin) })}</p>}
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
    </Card>
  );
}
