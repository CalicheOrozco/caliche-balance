import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import type { UserDto } from "../../shared/schemas.ts";
import { api, errorKey } from "../api.ts";
import { clearOfflineData } from "../offline.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { ZeppCard } from "./Zepp.tsx";
import { Button, Card, Field, Segmented } from "../ui.tsx";

/** Profile form; also the first screen after registering, when the profile is still empty. */
export function ProfileForm({ user, onSaved }: { user: UserDto; onSaved?: () => void }) {
  // Language is not part of this form: the switch at the top of every screen owns it.
  const { t, lang } = useI18n();
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
    onError: (e) => setStatus(t(errorKey(e) as MessageKey)),
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

export function SettingsPage({ user }: { user: UserDto }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const signOut = async (action: () => Promise<void>) => {
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
      <ZeppCard />
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
