import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { FiRefreshCw } from "react-icons/fi";
import type { ZeppStatusDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Button, Card, CopyButton, Field, PasswordField, useFormat } from "../ui.tsx";

function useZeppStatus() {
  return useQuery({ queryKey: ["zepp"], queryFn: api.zeppStatus });
}

/** Household scale settings: connect, join with a code, invite people, assign weigh-ins. */
export function ZeppCard() {
  const { t } = useI18n();
  const status = useZeppStatus();

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("zeppTitle")}</h2>
      <p className="mt-1 text-sm text-ink-2">{t("zeppIntro")}</p>
      {status.data?.role === "owner" && <Owner status={status.data} />}
      {status.data?.role === "member" && <Member status={status.data} />}
      {status.data?.role === "none" && (
        <div className="mt-5 space-y-6">
          <ConnectForm />
          <JoinForm />
        </div>
      )}
    </Card>
  );
}

function useRefreshAll() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["zepp"] });
    void queryClient.invalidateQueries({ queryKey: ["zepp-unassigned"] });
    void queryClient.invalidateQueries({ queryKey: ["measurements"] });
  };
}

function ErrorText({ error }: { error: unknown }) {
  const { te } = useI18n();
  if (!error) return null;
  return (
    <p role="alert" className="rounded-2xl bg-bad/15 px-4 py-3 text-sm text-bad">
      {te(error)}
    </p>
  );
}

function ConnectForm({ title }: { title?: string }) {
  const { t, zeppSteps } = useI18n();
  const refresh = useRefreshAll();
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const connect = useMutation({ mutationFn: () => api.zeppConnect(token, userId), onSuccess: refresh });

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        connect.mutate();
      }}
    >
      <div>
        <h3 className="font-semibold">{title ?? t("zeppConnectTitle")}</h3>
        <p className="mt-1 text-sm text-muted">{t("zeppConnectHelp")}</p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
        {zeppSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <PasswordField label={t("zeppToken")} value={token} onChange={(e) => setToken(e.target.value)} required help={t("zeppTokenNote")} />
      <Field label={t("zeppUserId")} value={userId} onChange={(e) => setUserId(e.target.value)} inputMode="numeric" required />
      <ErrorText error={connect.error} />
      <Button type="submit" disabled={connect.isPending} className="w-full">
        {connect.isPending ? "…" : t("connect")}
      </Button>
    </form>
  );
}

function JoinForm() {
  const { t } = useI18n();
  const refresh = useRefreshAll();
  const [code, setCode] = useState("");
  const join = useMutation({ mutationFn: () => api.zeppJoin(code), onSuccess: refresh });
  return (
    <form
      className="space-y-4 border-t border-line pt-6"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        join.mutate();
      }}
    >
      <div>
        <h3 className="font-semibold">{t("zeppJoinTitle")}</h3>
        <p className="mt-1 text-sm text-muted">{t("zeppJoinHelp")}</p>
      </div>
      <Field
        label={t("inviteCode")}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoCapitalize="characters"
        autoCorrect="off"
        placeholder="XXXX-XXXX"
        required
      />
      <ErrorText error={join.error} />
      <Button type="submit" variant="secondary" disabled={join.isPending} className="w-full">
        {t("join")}
      </Button>
    </form>
  );
}

function SyncRow({ status }: { status: ZeppStatusDto }) {
  const { t } = useI18n();
  const f = useFormat();
  const refresh = useRefreshAll();
  const [result, setResult] = useState<string | null>(null);
  const sync = useMutation({
    mutationFn: api.zeppSync,
    onSuccess: (r) => {
      setResult(r.status === "ok" ? t("syncedCount").replace("{n}", String(r.imported)) : null);
      refresh();
    },
  });
  const tone = status.status === "ok" ? "bg-good/15 text-good" : "bg-warn/15 text-warn";
  return (
    <div className="mt-4 space-y-3">
      <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${tone}`}>
        <p>{t(`zeppStatus.${status.status}` as MessageKey)}</p>
        {/* What Zepp or the network actually said, so a failure can be told apart from the next. */}
        {status.status !== "ok" && status.lastError && (
          <p className="mt-1 text-xs font-normal break-words opacity-90">
            {t("zeppErrorDetail")}: {status.lastError}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {t("lastSync")}: {status.lastSyncAt ? f.dateTime(status.lastSyncAt) : t("never")}
          {result && <span className="block text-ink-2">{result}</span>}
          {sync.isError && <span className="block text-bad">{(sync.error as Error).message}</span>}
        </p>
        <Button variant="secondary" disabled={sync.isPending || status.status === "invalid-token"} onClick={() => sync.mutate()} className="flex shrink-0 items-center gap-2">
          <FiRefreshCw size={16} aria-hidden className={sync.isPending ? "animate-spin" : ""} />
          {t("syncNow")}
        </Button>
      </div>
    </div>
  );
}

function Owner({ status }: { status: ZeppStatusDto }) {
  const { t } = useI18n();
  const f = useFormat();
  const refresh = useRefreshAll();
  const queryClient = useQueryClient();
  const [codes, setCodes] = useState<Record<string, string>>({});
  const unassigned = useQuery({ queryKey: ["zepp-unassigned"], queryFn: api.zeppUnassigned });
  const invite = useMutation({
    mutationFn: api.zeppInvite,
    onSuccess: (r, memberId) => {
      setCodes((c) => ({ ...c, [memberId]: r.code }));
      refresh();
    },
  });
  const unlink = useMutation({ mutationFn: api.zeppUnlink, onSuccess: refresh });
  const assign = useMutation({ mutationFn: ({ id, memberId }: { id: string; memberId: string }) => api.zeppAssign(id, memberId), onSuccess: refresh });
  const disconnect = useMutation({
    mutationFn: api.zeppDisconnect,
    onSuccess: () => {
      queryClient.setQueryData(["zepp"], { ...status, role: "none", members: [] });
      refresh();
    },
  });
  const memberName = (memberId: string) => {
    const m = status.members.find((x) => x.memberId === memberId);
    return memberId === "-1" ? `${m?.nickname ?? t("you")} (${t("you")})` : (m?.nickname ?? memberId);
  };

  return (
    <div>
      <SyncRow status={status} />
      {status.status === "invalid-token" && (
        <div className="mt-5">
          <ConnectForm />
        </div>
      )}

      <h3 className="mt-6 font-semibold">{t("household")}</h3>
      <ul className="mt-2 divide-y divide-line">
        {status.members.map((m) => (
          <li key={m.memberId} className="py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{memberName(m.memberId)}</p>
                <p className="text-sm text-muted">
                  {m.linkedUsername ? `@${m.linkedUsername}` : t("notLinked")}
                  {m.unassignedCount > 0 && ` · ${t("waitingCount").replace("{n}", String(m.unassignedCount))}`}
                </p>
              </div>
              {m.memberId !== "-1" &&
                (m.linkedUsername ? (
                  <Button
                    variant="dangerText"
                    onClick={() => {
                      if (confirm(t("unlinkConfirm"))) unlink.mutate(m.memberId);
                    }}
                  >
                    {t("unlink")}
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={invite.isPending} onClick={() => invite.mutate(m.memberId)}>
                    {t("invite")}
                  </Button>
                ))}
            </div>
            {codes[m.memberId] && (
              <div className="mt-3 rounded-2xl bg-brand/15 p-4">
                <p className="text-sm">{t("inviteShare")}</p>
                <p className="my-2 font-mono text-xl tracking-wider select-all">{codes[m.memberId]}</p>
                <CopyButton text={codes[m.memberId]!} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{t("zeppAddMembers")}</p>

      {(unassigned.data?.length ?? 0) > 0 && (
        <>
          <h3 className="mt-6 font-semibold">{t("unassignedTitle")}</h3>
          <p className="mt-1 text-sm text-muted">{t("unassignedHelp")}</p>
          <ul className="mt-2 divide-y divide-line">
            {unassigned.data!.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{f.weight(m.weightKg, "kg")}</p>
                  <p className="text-sm text-muted">
                    {f.dateTime(m.measuredAt)} · {memberName(m.memberId)}
                  </p>
                </div>
                <select
                  aria-label={t("assignTo")}
                  value=""
                  onChange={(e) => e.target.value && assign.mutate({ id: m.id, memberId: e.target.value })}
                  className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-ink"
                >
                  <option value="">{t("assignTo")}…</option>
                  {status.members.map((x) => (
                    <option key={x.memberId} value={x.memberId}>
                      {memberName(x.memberId)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}

      <Button
        variant="danger"
        className="mt-6 w-full"
        onClick={() => {
          if (confirm(t("disconnectConfirm"))) disconnect.mutate();
        }}
      >
        {t("disconnect")}
      </Button>
    </div>
  );
}

function Member({ status }: { status: ZeppStatusDto }) {
  const { t } = useI18n();
  const refresh = useRefreshAll();
  const leave = useMutation({ mutationFn: api.zeppLeave, onSuccess: refresh });
  return (
    <div>
      <p className="mt-4 font-medium">{t("memberOf").replace("{owner}", `@${status.ownerUsername ?? "?"}`)}</p>
      <SyncRow status={status} />
      <Button
        variant="danger"
        className="mt-6 w-full"
        onClick={() => {
          if (confirm(t("leaveConfirm"))) leave.mutate();
        }}
      >
        {t("leave")}
      </Button>
    </div>
  );
}

/**
 * Pulls new weigh-ins whenever the app is opened, brought back to the screen (an installed app
 * on iPhone stays alive in the background) or regains internet. The server allows one real sync
 * every 2 minutes, so frequent switching costs nothing.
 */
export function useAutoSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const sync = () => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      api
        .zeppSync()
        .then((r) => {
          if (r.imported > 0) void queryClient.invalidateQueries({ queryKey: ["measurements"] });
          void queryClient.invalidateQueries({ queryKey: ["zepp"] });
        })
        .catch(() => undefined); // Not connected, or Zepp is down: the app works without it.
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
    };
  }, [queryClient]);
}
