import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FiActivity, FiCheck, FiChevronDown, FiCopy, FiDownload, FiHeart, FiMapPin, FiZap } from "react-icons/fi";
import type { IconType } from "react-icons";
import { type HealthMetric, healthAverages } from "../shared/health.ts";
import type { UserDto } from "../shared/schemas.ts";
import { api } from "./api.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Button, Card, useFormat } from "./ui.tsx";

/** The signed Shortcut built by scripts/build-health-shortcut.py. */
const SHORTCUT_FILE = "/shortcuts/caliche-salud.shortcut";
/** Metrics the Shortcut sends today; sleep can be sent by hand-built Shortcuts. */
const SENT: Exclude<HealthMetric, "sleepHours">[] = ["steps", "activeKcal", "exerciseMin", "distanceKm", "restingHr"];

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
          <span className={status.lastSyncAt ? "text-good" : "text-muted"}>
            {status.lastSyncAt ? tf("ahLastSync", { when: f.dateTime(status.lastSyncAt) }) : t("ahNoSyncYet")}
          </span>
        </p>
      )}

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
              <FiDownload aria-hidden /> {t("ahAddShortcut")}
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
      {steps(["ahQuick1", "ahQuick2", "ahQuick3", "ahQuick4"])}

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

const ICON: Record<Exclude<HealthMetric, "sleepHours">, IconType> = {
  steps: FiActivity,
  activeKcal: FiZap,
  exerciseMin: FiActivity,
  distanceKm: FiMapPin,
  restingHr: FiHeart,
};

/** Home: the latest day from Apple Health next to the 7-day average. */
export function HealthTodayCard({ connected }: { connected: boolean }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const days = useHealthDays(connected).data ?? [];
  const latest = days[days.length - 1];
  if (!latest) return null;
  const week = healthAverages(days.slice(-7));
  const format = (m: HealthMetric, v: number | null) =>
    v === null ? "-" : m === "distanceKm" ? `${f.number(v)} km` : m === "activeKcal" ? `${f.number(v, 0)} kcal` : m === "exerciseMin" ? `${f.number(v, 0)} min` : m === "restingHr" ? `${f.number(v, 0)} ${t("ahBpm")}` : f.number(v, 0);
  const shown = SENT.filter((m) => latest[m] !== null || week[m] !== null);
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <FiHeart className="text-bad" aria-hidden /> {t("ahTodayTitle")}
      </h2>
      <p className="text-sm text-muted">{tf("ahFrom", { date: f.date(`${latest.date}T12:00:00`) })}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {shown.map((m) => {
          const Icon = ICON[m];
          return (
            <div key={m} className="rounded-2xl bg-surface-2 p-3">
              <dt className="flex items-center gap-1.5 text-sm text-ink-2">
                <Icon size={14} aria-hidden /> {t(`ahMetric.${m}` as MessageKey)}
              </dt>
              <dd className="text-xl font-semibold">{format(m, latest[m])}</dd>
              <dd className="text-xs text-muted">
                {t("ahWeekAvg")}: {format(m, week[m])}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}
