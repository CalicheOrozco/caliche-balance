import { useEffect } from "react";
import { useLocation } from "react-router";
import type { MessageKey } from "./i18n.tsx";

/*
 * Where a weigh-in's page goes back to. A weigh-in opens from Today (the days, Detail), from
 * Body (Summary, Weigh-ins) or from the profile, so its back link returns to whichever page
 * opened it. The arrows to the previous and next weigh-in keep the same way back.
 */
let lastPage: string | null = null;

/** Remembers the last page that is not a weigh-in; App calls it on every navigation. */
export function useRememberPage() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!pathname.startsWith("/medicion/")) lastPage = pathname;
  }, [pathname]);
}

/** The page to go back to and its name. Opened directly (a reload, a shared link): Body. */
export function backFromReading(): { to: string; label: MessageKey } {
  const page = lastPage ?? "/cuerpo";
  if (page.startsWith("/cuerpo")) return { to: page, label: "nav.body" };
  if (page === "/yo") return { to: page, label: "nav.profile" };
  if (page === "/actividad") return { to: page, label: "nav.activity" };
  if (page === "/logros") return { to: page, label: "nav.achievements" };
  // Today, and Add (after saving a note the weigh-in opens; going back to the form makes no sense).
  return { to: "/", label: "nav.home" };
}
