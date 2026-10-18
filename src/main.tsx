import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import { I18nProvider } from "./i18n.tsx";
import { OFFLINE_MAX_AGE_MS, OFFLINE_VERSION, PERSISTED_QUERIES, offlinePersister } from "./offline.ts";
import "./index.css";

// Installs the service worker; a new version takes over on the next open.
registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    // Restored data must not be garbage-collected before the screens use it. Infinity (no cleanup)
    // rather than 90 days: browser timers overflow past ~24.8 days and would fire immediately.
    // Expiry of saved data is handled by maxAge below.
    queries: { retry: 1, refetchOnWindowFocus: true, gcTime: Infinity },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: offlinePersister,
        maxAge: OFFLINE_MAX_AGE_MS,
        buster: OFFLINE_VERSION,
        dehydrateOptions: {
          // Keep whatever data a query has even if its last refresh failed (offline, server down);
          // saving only successful queries would overwrite the stored copy with nothing.
          // "Signed out" (null) is never saved, so a stale copy cannot hide a valid session.
          shouldDehydrateQuery: (query) => query.state.data != null && PERSISTED_QUERIES.has(String(query.queryKey[0])),
        },
      }}
    >
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
