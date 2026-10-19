import { useQuery } from "@tanstack/react-query";
import type { Achievements } from "../shared/achievements.ts";
import type { GoalsInput, MeasurementDto, NotificationPrefs, MeasurementInput, ProfileInput, UserDto, ZeppStatusDto } from "../shared/schemas.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: { path: string; code: string }[] = [],
    /** Extra facts the server sends with an error, like attempts left. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "generic", data.fields, data);
  return data as T;
}

export const api = {
  me: () => call<UserDto>("GET", "/me"),
  register: (username: string, password: string) =>
    call<{ user: UserDto; recoveryCode: string }>("POST", "/auth/register", { username, password }),
  login: (username: string, password: string) => call<{ user: UserDto }>("POST", "/auth/login", { username, password }),
  recover: (username: string, recoveryCode: string, newPassword: string) =>
    call<{ user: UserDto; recoveryCode: string }>("POST", "/auth/recover", { username, recoveryCode, newPassword }),
  logout: () => call<void>("POST", "/auth/logout"),
  saveProfile: (profile: ProfileInput) => call<UserDto>("PUT", "/me/profile", profile),
  saveGoals: (goals: GoalsInput) => call<UserDto>("PUT", "/me/goals", goals),
  saveNotifications: (prefs: NotificationPrefs) => call<UserDto>("PUT", "/me/notifications", prefs),
  pushKey: () => call<{ publicKey: string }>("GET", "/push/key"),
  pushSubscribe: (subscription: PushSubscriptionJSON) => call<void>("POST", "/push/subscribe", subscription),
  pushUnsubscribe: (endpoint: string) => call<void>("DELETE", "/push/subscribe", { endpoint }),
  pushTest: () => call<{ sent: number }>("POST", "/push/test"),
  deleteAccount: () => call<void>("DELETE", "/me"),
  measurements: () => call<MeasurementDto[]>("GET", "/measurements?limit=1000"),
  saveStreakReward: (reward: { text: string; days: number }) => call<UserDto>("PUT", "/me/streak-reward", reward),
  removeStreakReward: () => call<UserDto>("DELETE", "/me/streak-reward"),
  achievements: (timeZone: string) => call<Achievements>("GET", `/me/achievements?tz=${encodeURIComponent(timeZone)}`),
  addMeasurement: (input: MeasurementInput) => call<MeasurementDto>("POST", "/measurements", input),
  deleteMeasurement: (id: string) => call<void>("DELETE", `/measurements/${id}`),
  setWaist: (id: string, waist: string | null, waistUnit: "cm" | "in") =>
    call<MeasurementDto>("PATCH", `/measurements/${id}/waist`, { waist, waistUnit }),
  zeppStatus: () => call<ZeppStatusDto>("GET", "/zepp"),
  zeppConnect: (appToken: string, zeppUserId: string) =>
    call<ZeppStatusDto & { imported: number }>("POST", "/zepp/connect", { appToken, zeppUserId }),
  zeppSync: () => call<{ imported: number; status: string; skipped?: boolean }>("POST", "/zepp/sync"),
  zeppDisconnect: () => call<void>("DELETE", "/zepp"),
  zeppInvite: (memberId: string) => call<{ code: string; expiresInDays: number }>("POST", `/zepp/members/${encodeURIComponent(memberId)}/invite`),
  zeppUnlink: (memberId: string) => call<void>("DELETE", `/zepp/members/${encodeURIComponent(memberId)}/link`),
  zeppJoin: (code: string) => call<ZeppStatusDto>("POST", "/zepp/join", { code }),
  zeppLeave: () => call<ZeppStatusDto>("POST", "/zepp/leave"),
  zeppUnassigned: () => call<(MeasurementDto & { memberId: string })[]>("GET", "/zepp/unassigned"),
  zeppAssign: (id: string, memberId: string) => call<void>("POST", `/zepp/unassigned/${id}/assign`, { memberId }),
  notMine: (id: string) => call<void>("POST", `/measurements/${id}/not-mine`),
};

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () =>
      api.me().catch((error) => {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }),
    // Re-checked every time the app opens: a session can expire or start elsewhere.
    // Offline, the saved copy stays on screen.
    refetchOnMount: "always",
  });
}

export function useMeasurements() {
  return useQuery({ queryKey: ["measurements"], queryFn: api.measurements });
}

/**
 * Badges and challenges, computed by the server over the whole history. The key sits under
 * "measurements" so every place that refreshes weigh-ins (adding, deleting, a Zepp sync) also
 * refreshes these.
 */
export function useAchievementsQuery() {
  return useQuery({
    queryKey: ["measurements", "achievements"],
    queryFn: () => api.achievements(Intl.DateTimeFormat().resolvedOptions().timeZone),
  });
}

export interface ErrorDescription {
  key: string;
  vars: Record<string, string | number>;
}

/** Turns any failure into a message key plus the values the message mentions. */
export function describeError(error: unknown): ErrorDescription {
  // fetch rejects with a TypeError when there is no network at all.
  if (error instanceof TypeError || !navigator.onLine) return { key: "error.offline", vars: {} };
  if (!(error instanceof ApiError)) return { key: "error.generic", vars: {} };
  if (error.status >= 500) return { key: "error.server", vars: {} };
  if (error.code === "invalid" && error.fields[0]) return { key: `error.${error.fields[0].code}`, vars: {} };
  const d = error.details;
  const vars: Record<string, string | number> = {};
  if (typeof d.attemptsLeft === "number") vars.n = d.attemptsLeft;
  if (typeof d.username === "string") vars.username = d.username;
  if (typeof d.retryAfterSeconds === "number") vars.minutes = Math.ceil(d.retryAfterSeconds / 60);
  return { key: `error.${error.code}`, vars };
}
