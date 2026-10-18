import { useQuery } from "@tanstack/react-query";
import type { MeasurementDto, MeasurementInput, ProfileInput, UserDto, ZeppStatusDto } from "../shared/schemas.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: { path: string; code: string }[] = [],
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
  if (!res.ok) throw new ApiError(res.status, data.error ?? "generic", data.fields);
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
  deleteAccount: () => call<void>("DELETE", "/me"),
  measurements: () => call<MeasurementDto[]>("GET", "/measurements?limit=1000"),
  addMeasurement: (input: MeasurementInput) => call<MeasurementDto>("POST", "/measurements", input),
  deleteMeasurement: (id: string) => call<void>("DELETE", `/measurements/${id}`),
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
    staleTime: Infinity,
  });
}

export function useMeasurements() {
  return useQuery({ queryKey: ["measurements"], queryFn: api.measurements });
}

/** Turns an API error into a message key the UI can translate. */
export function errorKey(error: unknown): string {
  // fetch rejects with a TypeError when there is no network at all.
  if (error instanceof TypeError || !navigator.onLine) return "error.offline";
  if (error instanceof ApiError) {
    if (error.code === "invalid" && error.fields[0]) return `error.${error.fields[0].code}`;
    return `error.${error.code}`;
  }
  return "error.generic";
}
