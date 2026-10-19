import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { useSyncExternalStore } from "react";
import type { MeasurementDto } from "../shared/schemas.ts";

/**
 * What the app keeps on the device so it can be opened without internet: the profile, the
 * weigh-ins of the last three months and the badges (keyed under "measurements"). The service
 * worker caches only the app itself.
 */

export const OFFLINE_DAYS = 90;
const KEY = "caliche-balance-offline";
/** Bump when the shape of stored data changes; older copies are discarded. */
export const OFFLINE_VERSION = "2"; // 2: the user now carries goals
export const OFFLINE_MAX_AGE_MS = OFFLINE_DAYS * 24 * 60 * 60 * 1000;
export const PERSISTED_QUERIES = new Set(["me", "measurements"]);

/**
 * Keeps the last three months, plus the newest weigh-in and the newest one with body composition
 * so Home still has something to show after a long gap. Input is newest first, as the API returns it.
 */
export function keepForOffline(measurements: MeasurementDto[], now = Date.now()): MeasurementDto[] {
  const cutoff = now - OFFLINE_MAX_AGE_MS;
  const newestFull = measurements.find((m) => m.bodyFatPct !== null);
  return measurements.filter((m, i) => i === 0 || m === newestFull || new Date(m.measuredAt).getTime() >= cutoff);
}

function trim(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) =>
        query.queryKey[0] === "measurements" && Array.isArray(query.state.data)
          ? { ...query, state: { ...query.state, data: keepForOffline(query.state.data as MeasurementDto[]) } }
          : query,
      ),
    },
  };
}

export const offlinePersister = createAsyncStoragePersister({
  key: KEY,
  // IndexedDB: unlike localStorage it does not block the page and has room for months of data.
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value: string) => set(key, value),
    removeItem: (key) => del(key),
  },
  serialize: (client) => JSON.stringify(trim(client)),
  throttleTime: 2000,
});

/** Called on sign-out and account deletion: no health data stays on the device. */
export function clearOfflineData(): Promise<void> {
  return del(KEY).catch(() => undefined);
}

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
