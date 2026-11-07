import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { api } from "../api.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Controls } from "../Controls.tsx";
import { AppVersion, Button, CopyButton, Field, Logo, PasswordField } from "../ui.tsx";

type Mode = "login" | "register" | "recover";

const CHIPS: MessageKey[] = ["auth.chipSources", "auth.chipOffline", "auth.chipRanges"];

export function AuthPage() {
  const { t, te } = useI18n();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A new recovery code must be acknowledged before entering the app. */
  const [newCode, setNewCode] = useState<{ code: string; finish: () => void } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        const { user } = await api.login(username, password);
        queryClient.setQueryData(["me"], user);
      } else {
        const result =
          mode === "register" ? await api.register(username, password) : await api.recover(username, recoveryCode, password);
        setNewCode({ code: result.recoveryCode, finish: () => queryClient.setQueryData(["me"], result.user) });
      }
    } catch (e) {
      setError(te(e));
    } finally {
      setBusy(false);
    }
  }

  if (newCode) {
    return (
      <Shell>
        <div className="flex flex-col gap-3.5">
          <h2 className="text-[22px] font-extrabold">{t("recoveryTitle")}</h2>
          <p className="text-[15px] font-medium text-ink-2">{t("recoveryBody")}</p>
          <p className="my-2 rounded-2xl border border-line bg-surface p-4 text-center font-mono text-xl font-bold tracking-wider select-all">{newCode.code}</p>
          <div className="flex gap-3">
            <CopyButton text={newCode.code} />
            <Button className="min-h-14 flex-1 rounded-[18px] text-[17px]" onClick={newCode.finish}>
              {t("recoverySaved")}
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <Shell>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <h2 className="text-[22px] font-extrabold">{mode === "login" ? t("auth.enter") : t(mode)}</h2>
        <Field
          label={t("username")}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          help={mode === "register" ? t("usernameHelp") : undefined}
        />
        {mode === "recover" && (
          <Field
            label={t("recoveryCode")}
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            required
          />
        )}
        <PasswordField
          label={mode === "recover" ? t("newPassword") : t("password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          help={mode === "login" ? undefined : t("passwordHelp")}
        />
        {error && (
          <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-text">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="mt-1 min-h-14 w-full rounded-[18px] text-[17px]">
          {mode === "login" ? t("auth.enter") : t(mode)}
        </Button>
        {mode === "login" ? (
          <>
            <Button type="button" variant="secondary" className="min-h-13 w-full rounded-[18px] text-base" onClick={() => switchTo("register")}>
              {t("register")}
            </Button>
            <button
              type="button"
              onClick={() => switchTo("recover")}
              className="min-h-11 self-center text-center text-sm font-bold text-brand-text"
            >
              {t("auth.forgotLink")}
            </button>
          </>
        ) : (
          <Button type="button" variant="secondary" className="min-h-13 w-full rounded-[18px] text-base" onClick={() => switchTo("login")}>
            {mode === "register" ? t("haveAccount") : t("backToLogin")}
          </Button>
        )}
      </form>
    </Shell>
  );
}

/** The welcome hero on top of the form, edge to edge, with language and theme on its corner. */
function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <section className="flex flex-col gap-4.5 rounded-b-[36px] bg-hero px-6 pt-[calc(env(safe-area-inset-top)+1rem)] pb-10 text-hero-ink">
        <div className="flex justify-end">
          <Controls tone="hero" />
        </div>
        <div className="flex items-center gap-3">
          <Logo size={52} />
          <span className="text-xl font-extrabold">
            <span className="text-hero-a">Caliche</span> Balance
          </span>
        </div>
        <h1 className="text-[34px] leading-10 font-extrabold tracking-[-0.03em]">{t("auth.headline")}</h1>
        <p className="text-[15px] leading-5.5 font-semibold text-hero-muted">{t("auth.intro")}</p>
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((key) => (
            <span key={key} className="inline-flex h-7.5 items-center rounded-full bg-hero-track px-3 text-xs font-bold">
              {t(key)}
            </span>
          ))}
        </div>
      </section>
      <main className="px-6 pt-7 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        {children}
        <p className="mt-8 text-center text-sm font-semibold text-muted">{t("madeBy")}</p>
        <div className="mt-1">
          <AppVersion />
        </div>
      </main>
    </div>
  );
}
