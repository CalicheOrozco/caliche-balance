import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, errorKey } from "../api.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Controls } from "../Controls.tsx";
import { Button, Card, CopyButton, Field, Logo, PasswordField } from "../ui.tsx";

type Mode = "login" | "register" | "recover";

export function AuthPage() {
  const { t } = useI18n();
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
      setError(t(errorKey(e) as MessageKey));
    } finally {
      setBusy(false);
    }
  }

  if (newCode) {
    return (
      <Shell>
        <Card>
          <h2 className="text-xl font-bold">{t("recoveryTitle")}</h2>
          <p className="mt-2 text-ink-2">{t("recoveryBody")}</p>
          <p className="my-5 rounded-2xl bg-surface-2 p-4 text-center font-mono text-xl tracking-wider select-all">{newCode.code}</p>
          <div className="flex gap-3">
            <CopyButton text={newCode.code} />
            <Button className="flex-1" onClick={newCode.finish}>
              {t("recoverySaved")}
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <Shell>
      <Card>
        <h2 className="text-xl font-bold">{t(mode)}</h2>
        <form onSubmit={submit} className="mt-5 space-y-4">
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
            <p role="alert" className="rounded-2xl bg-bad/15 px-4 py-3 text-sm text-bad">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {t(mode)}
          </Button>
        </form>
        <div className="mt-4 flex flex-col items-center gap-1">
          {mode === "login" ? (
            <>
              <Button variant="ghost" onClick={() => switchTo("register")}>
                {t("noAccount")}
              </Button>
              <Button variant="subtle" onClick={() => switchTo("recover")}>
                {t("forgot")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => switchTo("login")}>
              {mode === "register" ? t("haveAccount") : t("backToLogin")}
            </Button>
          )}
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-10">
      <div className="mb-4 flex justify-end">
        <Controls />
      </div>
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size={72} />
        <h1 className="mt-4 text-3xl font-bold">
          <span className="text-brand">Caliche</span> Balance
        </h1>
        <p className="mt-2 text-ink-2">{t("tagline")}</p>
      </div>
      {children}
      <p className="mt-8 text-center text-sm text-muted">{t("madeBy")}</p>
    </main>
  );
}
