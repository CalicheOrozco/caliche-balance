import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { FiLock, FiTrash2 } from "react-icons/fi";
import { type Accent, ACCENTS, useAccent } from "../accent.ts";
import { AppleHealthCard } from "../appleHealth.tsx";
import { useBestStreak } from "../reports.tsx";
import { useLocation } from "react-router";
import { ageAt, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { maintainRange } from "../../shared/goals.ts";
import { fromKilograms, toKilograms } from "../../shared/schemas.ts";
import type { UserDto } from "../../shared/schemas.ts";
import { bodyFatOf } from "../../shared/composition.ts";
import { api, useMeasurements } from "../api.ts";
import { clearOfflineData } from "../offline.ts";
import { disablePush, enablePush, type PushState, pushState } from "../push.ts";
import { useI18n } from "../i18n.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { ZeppCard } from "./Zepp.tsx";
import { AppVersion, Button, Card, Field, Segmented, Switch, useFormat } from "../ui.tsx";

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
        <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("sex")}</span>
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
        <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("unit")}</span>
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
      {status && <p className="text-sm text-ink-2">{status}</p>}
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
      className="flex h-11 w-11 items-center justify-center rounded-xl text-bad transition hover:bg-bad/15 active:scale-95"
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
      <p className="text-sm text-ink-2">{t("goalsIntro")}</p>
      <div className="space-y-3">
        {currentWeight !== null && <p className="text-sm font-medium text-ink">{tf("goalWeightNow", { weight: f.weight(currentWeight, unit) })}</p>}
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
        {currentFat && <p className="mb-1.5 text-sm font-medium text-ink">{tf("goalFatNow", { value: `${f.number(currentFat.value)} %` })}</p>}
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
      {status && <p className="text-sm text-ink-2">{status}</p>}
      <Button type="submit" disabled={save.isPending} className="w-full">
        {t("save")}
      </Button>
    </form>
  );
}

/** The app color; gold and diamond unlock with the best streak. */
function AccentCard() {
  const { t, tf } = useI18n();
  const [accent, setAccent] = useAccent();
  const best = useBestStreak() ?? 0;
  const swatch: Record<Accent, string> = { green: "bg-[#21b359]", gold: "bg-[#eab308]", diamond: "bg-[conic-gradient(#67e8f9,#a78bfa,#f0abfc,#67e8f9)]" };
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("accentTitle")}</h2>
      <div role="radiogroup" aria-label={t("accentTitle")} className="mt-3 grid grid-cols-3 gap-2">
        {ACCENTS.map(({ accent: a, unlockDays }) => {
          const locked = unlockDays !== null && best < unlockDays;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={accent === a}
              disabled={locked}
              onClick={() => setAccent(a)}
              className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 px-2 py-2 text-sm font-medium transition disabled:opacity-60 ${
                accent === a ? "border-brand bg-brand/10 text-ink" : "border-line bg-surface-2 text-ink-2"
              }`}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full ${swatch[a]}`} aria-hidden>
                {locked && <FiLock size={14} className="text-white" />}
              </span>
              {t(`accent.${a}`)}
              {locked && <span className="text-xs font-normal text-muted">{tf("accentLocked", { n: unlockDays! })}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** Push notifications for this device, plus which kinds the person wants on all devices. */
function NotificationsCard({ user }: { user: UserDto }) {
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

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("notificationsTitle")}</h2>
      <p className="mt-1 text-sm text-ink-2">{t("notificationsIntro")}</p>
      {note && <p className="mt-3 rounded-2xl bg-warn/15 px-4 py-3 text-sm text-ink">{note}</p>}
      {state === "off" && (
        <Button className="mt-4 w-full" disabled={busy} onClick={() => run(async () => setState(await enablePush()))}>
          {t("enableNotifications")}
        </Button>
      )}
      {state === "on" && (
        <>
          <p className="mt-3 text-sm font-medium text-good">{t("notificationsOn")}</p>
          <div className="mt-2 divide-y divide-line">
            <Switch
              label={t("notifyNewWeighIn")}
              checked={user.notifications.newWeighIn}
              disabled={prefs.isPending}
              onChange={(v) => prefs.mutate({ ...user.notifications, newWeighIn: v })}
            />
            <Switch
              label={t("notifyZepp")}
              checked={user.notifications.zepp}
              disabled={prefs.isPending}
              onChange={(v) => prefs.mutate({ ...user.notifications, zepp: v })}
            />
            <Switch
              label={t("notifyGoals")}
              checked={user.notifications.goals}
              disabled={prefs.isPending}
              onChange={(v) => prefs.mutate({ ...user.notifications, goals: v })}
            />
            <Switch
              label={t("notifyStreak")}
              // Missing on an account cached offline by an older version of the app.
              checked={user.notifications.streak ?? true}
              disabled={prefs.isPending}
              onChange={(v) => prefs.mutate({ ...user.notifications, streak: v })}
            />
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <Button variant="secondary" disabled={busy} onClick={() =>
                run(async () => {
                  await api.pushTest();
                  setMessage(t("testSent"));
                })
              }>
              {t("sendTest")}
            </Button>
            <Button
              variant="ghost"
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
      {message && <p className="mt-3 text-sm text-ink-2">{message}</p>}
    </Card>
  );
}

export function SettingsPage({ user }: { user: UserDto }) {
  const location = useLocation();
  // Home links to /ajustes#metas; scroll to the goals card once it is on screen.
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash]);
  const { t } = useI18n();
  const queryClient = useQueryClient();
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("nav.settings")}</h1>
      <Card>
        <h2 className="mb-4 text-lg font-semibold">{t("profileTitle")}</h2>
        <ProfileForm user={user} />
      </Card>
      <div id="metas" className="scroll-mt-4">
        <Card>
          <h2 className="mb-2 text-lg font-semibold">{t("goalsTitle")}</h2>
          <GoalsForm user={user} />
        </Card>
      </div>
      <AccentCard />
      <ZeppCard />
      <AppleHealthCard user={user} />
      <NotificationsCard user={user} />
      <Card>
        <h2 className="text-lg font-semibold">{t("account")}</h2>
        <p className="mt-1 text-ink-2">
          {t("signedInAs")} <strong className="text-ink">{user.username}</strong>
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Button variant="secondary" onClick={() => signOut(api.logout)}>
            {t("logout")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(t("deleteAccountConfirm"))) void signOut(api.deleteAccount);
            }}
          >
            {t("deleteAccount")}
          </Button>
        </div>
      </Card>
      <AppVersion />
    </div>
  );
}
