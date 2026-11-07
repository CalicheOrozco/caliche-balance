import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FiBarChart2, FiBell, FiChevronRight, FiGlobe, FiHeart, FiHome, FiKey, FiLock, FiSmartphone, FiTarget, FiTrash2 } from "react-icons/fi";
import { Link, useLocation } from "react-router";
import { type Accent, ACCENTS, useAccent } from "../accent.ts";
import { AppleHealthCard } from "../appleHealth.tsx";
import { useCompareXiaomi } from "../compare.ts";
import { useChangeLanguage } from "../Controls.tsx";
import { DropIcon, FlameIcon, RulerIcon, ScaleIcon } from "../icons.tsx";
import { useBestStreak } from "../reports.tsx";
import { ageAt, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { maintainRange } from "../../shared/goals.ts";
import { CM_PER_IN, fromKilograms, toKilograms } from "../../shared/schemas.ts";
import type { UserDto } from "../../shared/schemas.ts";
import { bodyFatOf } from "../../shared/composition.ts";
import { api, useMeasurements } from "../api.ts";
import { clearOfflineData } from "../offline.ts";
import { disablePush, enablePush, type PushState, pushState } from "../push.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { type ThemeChoice, useTheme } from "../theme.ts";
import { useZeppStatus, ZeppHouseholdCard, ZeppScaleCard } from "./Zepp.tsx";
import { AppVersion, Avatar, BackLink, Button, Card, Field, Segmented, Toggle, useFormat } from "../ui.tsx";

/** Profile form; also the first screen after registering, when the profile is still empty. */
export function ProfileForm({ user, onSaved }: { user: UserDto; onSaved?: () => void }) {
  // Language is not part of this form: the switch at the top of every screen owns it.
  const { t, te, lang } = useI18n();
  const queryClient = useQueryClient();
  const p = user.profile;
  const [displayName, setDisplayName] = useState(p?.displayName ?? "");
  const [sex, setSex] = useState<"male" | "female">(p?.sex ?? "male");
  const [birthDate, setBirthDate] = useState(p?.birthDate ?? "");
  const [height, setHeight] = useState(p ? String(p.heightCm) : "");
  const [unit, setUnit] = useState<"kg" | "lb">(p?.unit ?? "kg");
  const [status, setStatus] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.saveProfile({
        displayName: displayName.trim() || undefined,
        sex,
        birthDate,
        heightCm: Number(height.replace(",", ".")),
        language: lang,
        unit,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["me"], saved);
      setStatus(t("saved"));
      onSaved?.();
    },
    onError: (e) => setStatus(te(e)),
  });

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setStatus(null);
        save.mutate();
      }}
      className="space-y-4"
    >
      <Field label={t("displayName")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
      <div>
        <span className="mb-1.5 block text-[13px] font-bold text-ink-2">{t("sex")}</span>
        <Segmented
          label={t("sex")}
          value={sex}
          onChange={setSex}
          options={[
            { value: "male", label: t("sex.male") },
            { value: "female", label: t("sex.female") },
          ]}
        />
      </div>
      <DatePicker label={t("birthDate")} value={birthDate} onChange={setBirthDate} maxDate={new Date()} minDate={new Date(1900, 0, 1)} required />
      <Field
        label={t("height")}
        inputMode="decimal"
        value={height}
        onChange={(e) => setHeight(e.target.value)}
        required
        placeholder="170"
      />
      <div>
        <span className="mb-1.5 block text-[13px] font-bold text-ink-2">{t("unit")}</span>
        <Segmented
          label={t("unit")}
          value={unit}
          onChange={setUnit}
          options={[
            { value: "kg", label: "kg" },
            { value: "lb", label: "lb" },
          ]}
        />
      </div>
      {status && <p className="text-sm font-semibold text-ink-2">{status}</p>}
      <Button type="submit" disabled={save.isPending} className="w-full">
        {t("save")}
      </Button>
    </form>
  );
}

/** Trash icon inside a goal field; asks before removing, since the goal's starting point goes with it. */
function RemoveGoalButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        if (confirm(t("removeGoalConfirm"))) onRemove();
      }}
      className="flex h-11 w-11 items-center justify-center rounded-xl text-bad-text transition hover:bg-bad-soft active:scale-95"
    >
      <FiTrash2 size={20} aria-hidden />
    </button>
  );
}

/** Weight (a target, or maintaining) and body fat goals; each one optional. */
function GoalsForm({ user }: { user: UserDto }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const profile = user.profile!;
  const unit = profile.unit;
  const toInput = (n: number | undefined | null) => (n === undefined || n === null ? "" : String(Math.round(n * 10) / 10));
  const [weight, setWeight] = useState(toInput(user.goals.weight && fromKilograms(user.goals.weight.targetKg, unit)));
  const [bodyFat, setBodyFat] = useState(toInput(user.goals.bodyFat?.targetPct));
  const [maintain, setMaintain] = useState(toInput(user.goals.maintain && fromKilograms(user.goals.maintain.centerKg, unit)));
  // Reaching a weight and maintaining one are alternatives; the form sends only the chosen one.
  const [mode, setMode] = useState<"target" | "maintain">(user.goals.maintain ? "maintain" : "target");
  const [status, setStatus] = useState<string | null>(null);

  const healthy = healthyWeightRange(profile.heightCm);
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date());
  const fatHealthy = bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!;
  // Where the person is today, so the goal can be chosen against it.
  const measurements = useMeasurements().data ?? [];
  const currentWeight = measurements[0]?.weightKg ?? null;
  const currentFat = measurements.map((m) => bodyFatOf(profile, m)).find((x) => x !== null) ?? null;

  type Draft = { mode: "target" | "maintain"; weight: string; maintain: string; bodyFat: string };
  const save = useMutation({
    mutationFn: (next: Draft) =>
      api.saveGoals({
        weight: next.mode === "target" && next.weight.trim() ? { value: next.weight, unit } : null,
        maintain: next.mode === "maintain" && next.maintain.trim() ? { value: next.maintain, unit } : null,
        bodyFatPct: next.bodyFat.trim() ? next.bodyFat : null,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["me"], saved);
      setStatus(t("saved"));
    },
    onError: (e) => setStatus(te(e)),
  });
  const submit = (next: Draft = { mode, weight, maintain, bodyFat }) => {
    setStatus(null);
    save.mutate(next);
  };

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <p className="text-sm font-semibold text-ink-2">{t("goalsIntro")}</p>
      <div className="space-y-3">
        {currentWeight !== null && <p className="text-sm font-bold text-ink">{tf("goalWeightNow", { weight: f.weight(currentWeight, unit) })}</p>}
        <Segmented
          label={t("weight")}
          value={mode}
          onChange={(next) => {
            setMode(next);
            // Start maintenance from today's weight, the usual choice.
            if (next === "maintain" && !maintain && currentWeight !== null) setMaintain(toInput(fromKilograms(currentWeight, unit)));
          }}
          options={[
            { value: "target", label: t("goalModeTarget") },
            { value: "maintain", label: t("goalModeMaintain") },
          ]}
        />
        {mode === "target" ? (
          <Field
            label={tf("goalWeight", { unit })}
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            help={tf("goalWeightHint", { min: f.weight(healthy.min, unit), max: f.weight(healthy.max, unit) })}
            trailing={
              user.goals.weight && (
                <RemoveGoalButton
                  label={t("removeWeightGoal")}
                  onRemove={() => {
                    setWeight("");
                    submit({ mode, weight: "", maintain, bodyFat });
                  }}
                />
              )
            }
          />
        ) : (
          <Field
            label={tf("goalMaintainField", { unit })}
            inputMode="decimal"
            value={maintain}
            onChange={(e) => setMaintain(e.target.value)}
            help={(() => {
              const kg = Number(maintain.replace(",", "."));
              if (!(kg > 0)) return undefined;
              const range = maintainRange(toKilograms(kg, unit));
              return tf("goalMaintainHint", { min: f.weight(range.minKg, unit), max: f.weight(range.maxKg, unit) });
            })()}
            trailing={
              user.goals.maintain && (
                <RemoveGoalButton
                  label={t("removeMaintainGoal")}
                  onRemove={() => {
                    setMaintain("");
                    submit({ mode, weight, maintain: "", bodyFat });
                  }}
                />
              )
            }
          />
        )}
      </div>
      <div>
        {currentFat && <p className="mb-1.5 text-sm font-bold text-ink">{tf("goalFatNow", { value: `${f.number(currentFat.value)} %` })}</p>}
        <Field
          label={t("goalBodyFat")}
          inputMode="decimal"
          value={bodyFat}
          onChange={(e) => setBodyFat(e.target.value)}
          help={tf("goalFatHint", { min: fatHealthy.min!, max: fatHealthy.max! })}
          trailing={
            user.goals.bodyFat && (
              <RemoveGoalButton
                label={t("removeFatGoal")}
                onRemove={() => {
                  setBodyFat("");
                  submit({ mode, weight, maintain, bodyFat: "" });
                }}
              />
            )
          }
        />
      </div>
      {status && <p className="text-sm font-semibold text-ink-2">{status}</p>}
      <Button type="submit" disabled={save.isPending} className="w-full">
        {t("save")}
      </Button>
    </form>
  );
}

/** "hace 12 min", "hace 3 h", "hace 2 días". */
function useAgo() {
  const { locale } = useI18n();
  return (iso: string) => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
    if (Math.abs(minutes) < 60) return rtf.format(Math.min(minutes, 0), "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
    return rtf.format(Math.round(hours / 24), "day");
  };
}

type Tone = "brand" | "warn" | "gray" | "blue" | "pink";

/** The colored square behind each settings icon. */
const TILE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-text",
  warn: "bg-warn-soft text-warn-text",
  gray: "bg-surface-2 text-ink-2",
  blue: "bg-series-2/15 text-series-2",
  pink: "bg-[#b4235a]/12 text-[#b4235a] [:root[data-theme=dark]_&]:bg-[#f472a0]/14 [:root[data-theme=dark]_&]:text-[#f472a0]",
};

/** One settings row: icon tile, label and a note, and on the right a value with a chevron, a switch or any control. */
function Row({
  icon: Icon,
  tone,
  label,
  sub,
  subTone = "muted",
  to,
  value,
  children,
}: {
  icon: IconType | ((props: { size?: number }) => ReactNode);
  tone: Tone;
  label: string;
  sub?: ReactNode;
  subTone?: "muted" | "good" | "warn";
  to?: string;
  value?: ReactNode;
  children?: ReactNode;
}) {
  const subClass = { muted: "text-muted", good: "text-good-text", warn: "text-warn-text" }[subTone];
  const body = (
    <>
      <span className={`flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-[10px] ${TILE[tone]}`} aria-hidden>
        <Icon size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-bold">{label}</span>
        {sub && <span className={`text-xs font-semibold ${subClass}`}>{sub}</span>}
      </span>
      {to ? (
        <>
          {value && <span className="max-w-[40%] truncate text-[15px] font-semibold whitespace-nowrap text-muted">{value}</span>}
          <FiChevronRight size={16} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
        </>
      ) : (
        children
      )}
    </>
  );
  const className = "flex min-h-15 items-center gap-3 border-t border-line px-4 py-2 text-ink first:border-t-0";
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** "METAS" and the rows under it, in one rounded card. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      <h2 className="mx-1 text-[13px] font-extrabold tracking-[0.06em] text-muted uppercase">{title}</h2>
      <section className="overflow-hidden rounded-[22px] border border-line bg-surface">{children}</section>
    </div>
  );
}

/** A two-option pill switch small enough to sit at the end of a row. */
function MiniChoice<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`min-h-9 min-w-11 rounded-lg px-2.5 text-sm transition disabled:opacity-50 ${o.value === value ? "bg-surface font-extrabold text-ink shadow-pill" : "font-bold text-ink-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GoalRows({ user }: { user: UserDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const unit = user.profile!.unit;
  const goals = user.goals;
  const latest = useMeasurements().data?.[0] ?? null;
  const save = useMutation({ mutationFn: api.saveGoals, onSuccess: (saved) => queryClient.setQueryData(["me"], saved) });
  const fatTarget = goals.bodyFat?.targetPct ?? null;
  const weightSub = goals.weight
    ? goals.weight.startKg !== null
      ? tf("set.goalFrom", { weight: f.weight(goals.weight.startKg, unit), date: f.date(goals.weight.setAt) })
      : undefined
    : goals.maintain
      ? t("set.goalMaintaining")
      : undefined;
  return (
    <Group title={t("goalsTitle")}>
      <Row
        icon={FiTarget}
        tone="brand"
        label={t("set.weightGoal")}
        sub={weightSub}
        to="#metas"
        value={goals.weight ? f.weight(goals.weight.targetKg, unit) : t("set.none")}
      />
      <Row icon={DropIcon} tone="warn" label={t("set.fatGoal")} to="#metas" value={fatTarget === null ? t("set.none") : `${f.number(fatTarget)} %`} />
      <Row
        icon={RulerIcon}
        tone="gray"
        label={t("goalModeMaintain")}
        sub={
          goals.maintain
            ? tf("goalMaintainHint", { min: f.weight(goals.maintain.minKg, unit), max: f.weight(goals.maintain.maxKg, unit) })
            : t("set.maintainHint")
        }
      >
        <Toggle
          label={t("goalModeMaintain")}
          checked={goals.maintain !== null}
          // Maintaining starts from today's weight, the usual choice; it replaces a weight target.
          disabled={save.isPending || (goals.maintain === null && latest === null)}
          onChange={(on) =>
            save.mutate(
              on
                ? { weight: null, maintain: { value: Math.round(latest!.weightKg * 10) / 10, unit: "kg" }, bodyFatPct: fatTarget }
                : { weight: null, maintain: null, bodyFatPct: fatTarget },
            )
          }
        />
      </Row>
    </Group>
  );
}

function ConnectionRows({ user }: { user: UserDto }) {
  const { t, tf } = useI18n();
  const ago = useAgo();
  const zepp = useZeppStatus().data;
  const health = user.appleHealth ?? null;
  const zeppSub =
    !zepp || zepp.role === "none"
      ? { text: t("set.notConnected"), tone: "muted" as const }
      : zepp.status === "ok" || zepp.status === null
        ? { text: zepp.lastSyncAt ? tf("set.zeppSynced", { when: ago(zepp.lastSyncAt) }) : t("zeppStatus.ok"), tone: "good" as const }
        : { text: t(`zeppStatus.${zepp.status}` as MessageKey), tone: "warn" as const };
  const people = zepp?.role === "owner" ? zepp.members.length : null;
  return (
    <Group title={t("set.connections")}>
      <Row icon={ScaleIcon} tone="brand" label={t("set.scale")} sub={zeppSub.text} subTone={zeppSub.tone} to="#zepp" />
      <Row
        icon={FiHeart}
        tone="pink"
        label={t("ahTitle")}
        sub={health ? (health.lastSyncAt ? tf("set.healthSent", { when: ago(health.lastSyncAt) }) : t("ahNoSyncYet")) : t("set.notConnected")}
        subTone={health?.lastSyncAt ? "good" : "muted"}
        to="#salud"
      />
      <Row
        icon={FiHome}
        tone="blue"
        label={t("set.home")}
        sub={zepp?.role === "member" ? t("memberOf").replace("{owner}", `@${zepp.ownerUsername ?? "?"}`) : t("set.homeHint")}
        to="#casa"
        value={people !== null ? tf("set.people", { n: people }) : undefined}
      />
    </Group>
  );
}

/** Push notifications for this device, plus which kinds the person wants on all devices. */
function NotificationRows({ user }: { user: UserDto }) {
  const { t, te } = useI18n();
  const queryClient = useQueryClient();
  const [state, setState] = useState<PushState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      setMessage(te(e));
    } finally {
      setBusy(false);
    }
  };
  const prefs = useMutation({
    mutationFn: api.saveNotifications,
    onSuccess: (saved) => queryClient.setQueryData(["me"], saved),
  });

  const note =
    state === "needs-install"
      ? t("notificationsInstall")
      : state === "unsupported"
        ? t("notificationsUnsupported")
        : state === "unavailable"
          ? t("notificationsUnavailable")
          : state === "misconfigured"
            ? t("notificationsMisconfigured")
            : state === "denied"
              ? t("notificationsDenied")
              : null;

  const toggles: { key: keyof UserDto["notifications"]; label: string; sub?: string; icon: IconType | typeof FlameIcon; tone: Tone }[] = [
    { key: "newWeighIn", label: t("set.notifyWeighIn"), sub: t("notifyNewWeighIn"), icon: FiBell, tone: "brand" },
    { key: "streak", label: t("set.notifyStreak"), sub: t("notifyStreak"), icon: FlameIcon, tone: "warn" },
    { key: "goals", label: t("goalsTitle"), sub: t("notifyGoals"), icon: FiTarget, tone: "brand" },
    { key: "zepp", label: t("set.notifyZepp"), sub: t("notifyZepp"), icon: FiKey, tone: "gray" },
  ];

  return (
    <Group title={t("notificationsTitle")}>
      <Row icon={FiSmartphone} tone="gray" label={t("set.thisDevice")} sub={state === "on" ? t("notificationsOn") : (note ?? t("notificationsIntro"))} subTone={state === "on" ? "good" : note ? "warn" : "muted"}>
        {state === "off" && (
          <Button className="min-h-10 shrink-0 rounded-full px-4 text-sm" disabled={busy} onClick={() => run(async () => setState(await enablePush()))}>
            {t("set.enable")}
          </Button>
        )}
      </Row>
      {state === "on" && (
        <>
          {toggles.map((x) => (
            <Row key={x.key} icon={x.icon} tone={x.tone} label={x.label} sub={x.sub}>
              <Toggle
                label={x.label}
                // streak is missing on an account cached offline by an older version of the app.
                checked={user.notifications[x.key] ?? true}
                disabled={prefs.isPending}
                onChange={(v) => prefs.mutate({ ...user.notifications, [x.key]: v })}
              />
            </Row>
          ))}
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            <Button
              variant="secondary"
              className="min-h-10 flex-1 text-sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.pushTest();
                  setMessage(t("testSent"));
                })
              }
            >
              {t("sendTest")}
            </Button>
            <Button
              variant="ghost"
              className="min-h-10 flex-1 text-sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await disablePush();
                  setState("off");
                })
              }
            >
              {t("disableNotifications")}
            </Button>
          </div>
        </>
      )}
      {message && <p className="border-t border-line px-4 py-3 text-sm font-semibold text-ink-2">{message}</p>}
    </Group>
  );
}

function PreferenceRows({ user }: { user: UserDto }) {
  const { t, lang } = useI18n();
  const changeLanguage = useChangeLanguage();
  const queryClient = useQueryClient();
  const [compare, setCompare] = useCompareXiaomi();
  const profile = user.profile!;
  const saveUnit = useMutation({
    mutationFn: (unit: "kg" | "lb") => api.saveProfile({ ...profile, unit, language: lang, displayName: profile.displayName ?? undefined }),
    onSuccess: (saved) => queryClient.setQueryData(["me"], saved),
  });
  return (
    <Group title={t("set.preferences")}>
      <Row icon={FiGlobe} tone="blue" label={t("language")}>
        <MiniChoice
          label={t("language")}
          value={lang}
          onChange={changeLanguage}
          options={[
            { value: "es", label: "ES" },
            { value: "en", label: "EN" },
          ]}
        />
      </Row>
      <Row icon={ScaleIcon} tone="gray" label={t("set.units")}>
        <MiniChoice
          label={t("unit")}
          value={profile.unit}
          disabled={saveUnit.isPending}
          onChange={(unit) => unit !== profile.unit && saveUnit.mutate(unit)}
          options={[
            { value: "kg", label: "kg" },
            { value: "lb", label: "lb" },
          ]}
        />
      </Row>
      <Row icon={FiBarChart2} tone="blue" label={t("compareXiaomi")} sub={t("set.compareHint")}>
        <Toggle label={t("compareXiaomi")} checked={compare} onChange={setCompare} />
      </Row>
    </Group>
  );
}

/** The fixed colors of the theme previews and accent swatches: they show what each choice looks like. */
const THEME_PREVIEW: Record<ThemeChoice, { bg: string; ink: string; brand: string }> = {
  light: { bg: "bg-[#f2f5f3]", ink: "bg-[#0b1610]", brand: "bg-[#12873f]" },
  dark: { bg: "bg-[#0e1411]", ink: "bg-[#edf3ef]", brand: "bg-[#2dc26b]" },
  system: { bg: "bg-surface-2", ink: "bg-muted", brand: "bg-brand" },
};
const SWATCH: Record<Accent, string> = {
  green: "bg-[#12873f] [:root[data-theme=dark]_&]:bg-[#2dc26b]",
  gold: "bg-[#a16207] [:root[data-theme=dark]_&]:bg-[#eab308]",
  diamond: "bg-[#6d28d9] [:root[data-theme=dark]_&]:bg-[#a78bfa]",
};
const THEME_LABEL: Record<ThemeChoice, MessageKey> = { light: "set.themeLight", dark: "set.themeDark", system: "set.themeSystem" };

/** Light, dark or the system's, and the app color; gold and diamond unlock with the best streak. */
function Appearance() {
  const { t, tf } = useI18n();
  const [, setTheme, choice] = useTheme();
  const [accent, setAccent] = useAccent();
  const best = useBestStreak() ?? 0;
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      <h2 className="mx-1 text-[13px] font-extrabold tracking-[0.06em] text-muted uppercase">{t("set.appearance")}</h2>
      <section className="flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-4">
        <div role="radiogroup" aria-label={t("set.theme")} className="grid grid-cols-3 gap-2">
          {(["light", "dark", "system"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={choice === c}
              onClick={() => setTheme(c)}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 px-1.5 py-2.5 text-ink transition active:scale-[0.98] ${choice === c ? "border-brand" : "border-line"}`}
            >
              <span className={`flex h-14 w-full flex-col gap-1.25 rounded-[10px] border border-line p-2 ${THEME_PREVIEW[c].bg}`} aria-hidden>
                <span className={`h-1.75 w-3/5 rounded ${THEME_PREVIEW[c].ink}`} />
                <span className={`h-1.75 w-2/5 rounded ${THEME_PREVIEW[c].brand}`} />
              </span>
              <span className="text-[13px] font-extrabold">{t(THEME_LABEL[c])}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="text-sm font-bold">{t("accentTitle")}</span>
          <div role="radiogroup" aria-label={t("accentTitle")} className="flex gap-3.5">
            {ACCENTS.map(({ accent: a, unlockDays }) => {
              const locked = unlockDays !== null && best < unlockDays;
              const name = t(`accent.${a}`);
              return (
                <div key={a} className="flex flex-col items-center gap-1.5">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={accent === a}
                    aria-label={locked ? `${name}, ${tf("accentLocked", { n: unlockDays! })}` : name}
                    disabled={locked}
                    onClick={() => setAccent(a)}
                    className={`flex h-12 w-12 items-center justify-center rounded-full border-[3px] text-white transition disabled:opacity-55 ${SWATCH[a]} ${accent === a ? "border-ink" : "border-transparent"}`}
                  >
                    {locked && <FiLock size={16} strokeWidth={2.6} aria-hidden />}
                  </button>
                  <span className="text-[11px] font-bold text-muted">{locked ? tf("set.days", { n: unlockDays! }) : name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

type View = "perfil" | "metas" | "zepp" | "salud" | "casa";
const VIEWS: View[] = ["perfil", "metas", "zepp", "salud", "casa"];

/** One setting opened from the list: a way back to Settings and the full editor. */
function SubView({ view, user }: { view: View; user: UserDto }) {
  const { t } = useI18n();
  const title: Record<View, MessageKey> = { perfil: "profileTitle", metas: "goalsTitle", zepp: "zeppTitle", salud: "ahTitle", casa: "household" };
  return (
    <div className="flex flex-col gap-3.5">
      <BackLink to="/ajustes" label={t("nav.settings")} />
      <h1 className="mx-1 text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{t(title[view])}</h1>
      {view === "perfil" && (
        <>
          <Card>
            <ProfileForm user={user} />
          </Card>
          <p className="px-1 text-[13px] font-semibold text-muted">
            {t("signedInAs")} <strong className="text-ink">@{user.username}</strong>
          </p>
        </>
      )}
      {view === "metas" && (
        <Card>
          <GoalsForm user={user} />
        </Card>
      )}
      {view === "zepp" && <ZeppScaleCard />}
      {view === "salud" && <AppleHealthCard user={user} />}
      {view === "casa" && <ZeppHouseholdCard />}
    </div>
  );
}

export function SettingsPage({ user }: { user: UserDto }) {
  const { t, tf, locale } = useI18n();
  const queryClient = useQueryClient();
  const location = useLocation();
  // Each setting opens at its own address (Home links to /ajustes#metas), so Back returns to the list.
  const view = VIEWS.find((v) => `#${v}` === location.hash) ?? null;
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view]);
  const signOut = async (action: () => Promise<void>) => {
    // This device stops receiving the account's notifications before the session ends.
    await disablePush().catch(() => undefined);
    await action();
    await clearOfflineData();
    // Setting "me" to null switches the app to the sign-in screen; clear() alone would not
    // notify it. Everything else belonged to the previous account.
    queryClient.setQueryData(["me"], null);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
  };

  if (view) return <SubView view={view} user={user} />;

  const profile = user.profile!;
  const facts = [
    `@${user.username}`,
    t(`sex.${profile.sex}` as MessageKey),
    profile.unit === "kg" ? `${(profile.heightCm / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m` : tf("me.heightFtIn", { ft: Math.floor(Math.round(profile.heightCm / CM_PER_IN) / 12), in: Math.round(profile.heightCm / CM_PER_IN) % 12 }),
    new Date(`${profile.birthDate}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }),
  ].join(" · ");

  return (
    <div className="flex flex-col gap-2.5">
      <BackLink to="/" label={t("nav.home")} />
      <h1 className="mx-1 mb-1.5 text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{t("nav.settings")}</h1>

      <Link to="#perfil" className="flex items-center gap-3.5 rounded-3xl border border-line bg-surface p-4 text-ink">
        <Avatar size={56} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[17px] font-extrabold">{profile.displayName ?? user.username}</span>
          <span className="text-[13px] font-semibold text-muted">{facts}</span>
        </span>
        <FiChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
      </Link>

      <GoalRows user={user} />
      <ConnectionRows user={user} />
      <NotificationRows user={user} />
      <PreferenceRows user={user} />
      <Appearance />

      <section className="mt-4.5 overflow-hidden rounded-[22px] border border-line bg-surface">
        <button type="button" onClick={() => signOut(api.logout)} className="min-h-14 w-full text-[15px] font-bold text-ink">
          {t("logout")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(t("deleteAccountConfirm"))) void signOut(api.deleteAccount);
          }}
          className="min-h-14 w-full border-t border-line text-[15px] font-bold text-bad-text"
        >
          {t("deleteAccount")}
        </button>
      </section>
      <div className="mt-2">
        <AppVersion />
      </div>
    </div>
  );
}
