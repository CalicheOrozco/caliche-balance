import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { ageAt, bodyFatBands, healthyWeightRange } from "../../shared/reference.ts";
import { fromKilograms } from "../../shared/schemas.ts";
import type { UserDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { clearOfflineData } from "../offline.ts";
import { disablePush, enablePush, type PushState, pushState } from "../push.ts";
import { useI18n } from "../i18n.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { ZeppCard } from "./Zepp.tsx";
import { Button, Card, Field, Segmented, Switch, useFormat } from "../ui.tsx";

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

/** Weight and body fat goals; each one optional. */
function GoalsForm({ user }: { user: UserDto }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const profile = user.profile!;
  const unit = profile.unit;
  const toInput = (n: number | undefined | null) => (n === undefined || n === null ? "" : String(Math.round(n * 10) / 10));
  const [weight, setWeight] = useState(toInput(user.goals.weight && fromKilograms(user.goals.weight.targetKg, unit)));
  const [bodyFat, setBodyFat] = useState(toInput(user.goals.bodyFat?.targetPct));
  const [status, setStatus] = useState<string | null>(null);

  const healthy = healthyWeightRange(profile.heightCm);
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date());
  const fatHealthy = bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!;

  const save = useMutation({
    mutationFn: (next: { weight: string; bodyFat: string }) =>
      api.saveGoals({
        weight: next.weight.trim() ? { value: next.weight, unit } : null,
        bodyFatPct: next.bodyFat.trim() ? next.bodyFat : null,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["me"], saved);
      setStatus(t("saved"));
    },
    onError: (e) => setStatus(te(e)),
  });
  const submit = (next = { weight, bodyFat }) => {
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
      <div>
        <Field
          label={tf("goalWeight", { unit })}
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          help={tf("goalWeightHint", { min: f.weight(healthy.min, unit), max: f.weight(healthy.max, unit) })}
        />
        {user.goals.weight && (
          <Button type="button" variant="dangerText" onClick={() => {
              setWeight("");
              submit({ weight: "", bodyFat });
            }}>
            {t("removeGoal")}
          </Button>
        )}
      </div>
      <div>
        <Field
          label={t("goalBodyFat")}
          inputMode="decimal"
          value={bodyFat}
          onChange={(e) => setBodyFat(e.target.value)}
          help={tf("goalFatHint", { min: fatHealthy.min!, max: fatHealthy.max! })}
        />
        {user.goals.bodyFat && (
          <Button type="button" variant="dangerText" onClick={() => {
              setBodyFat("");
              submit({ weight, bodyFat: "" });
            }}>
            {t("removeGoal")}
          </Button>
        )}
      </div>
      {status && <p className="text-sm text-ink-2">{status}</p>}
      <Button type="submit" disabled={save.isPending} className="w-full">
        {t("save")}
      </Button>
    </form>
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
      <ZeppCard />
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
    </div>
  );
}
