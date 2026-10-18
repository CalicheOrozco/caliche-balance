import { lazy, type ReactNode, Suspense, useEffect } from "react";
import type { IconType } from "react-icons";
import { FiHome, FiPlusCircle, FiSettings, FiTrendingUp } from "react-icons/fi";
import { NavLink, Navigate, Route, Routes } from "react-router";
import type { UserDto } from "../shared/schemas.ts";
import { useMe, useMeasurements } from "./api.ts";
import { Controls } from "./Controls.tsx";
import { useOnline } from "./offline.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { AddPage } from "./pages/Add.tsx";
import { AuthPage } from "./pages/Auth.tsx";
import { HomePage } from "./pages/Home.tsx";
import { ProfileForm, SettingsPage } from "./pages/Settings.tsx";
import { useAutoSync } from "./pages/Zepp.tsx";
import { Card, Logo } from "./ui.tsx";

// The chart library is large, so History loads only when it is opened.
const HistoryPage = lazy(() => import("./pages/History.tsx").then((m) => ({ default: m.HistoryPage })));

const NAV: { to: string; key: MessageKey; Icon: IconType }[] = [
  { to: "/", key: "nav.home", Icon: FiHome },
  { to: "/historial", key: "nav.history", Icon: FiTrendingUp },
  { to: "/agregar", key: "nav.add", Icon: FiPlusCircle },
  { to: "/ajustes", key: "nav.settings", Icon: FiSettings },
];

function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const online = useOnline();
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      <header className="flex items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-2">
        <Logo size={28} />
        <span className="flex-1 font-bold">
          <span className="text-brand">Caliche</span> Balance
        </span>
        <Controls />
      </header>
      <main className="px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+6rem)]">
        {!online && <p className="mb-4 rounded-2xl bg-warn/15 px-4 py-3 text-sm text-ink">{t("offlineBanner")}</p>}
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-md">
          {NAV.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${isActive ? "text-brand" : "text-muted"}`
                }
              >
                <item.Icon size={22} aria-hidden />
                {t(item.key)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function SignedIn({ user }: { user: UserDto }) {
  const { t } = useI18n();
  const measurements = useMeasurements();
  const profile = user.profile;
  useAutoSync();

  if (!profile) {
    return (
      <main className="mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-10">
        <div className="mb-6 flex justify-end">
          <Controls />
        </div>
        <div className="mb-6 flex items-center gap-3">
          <Logo size={44} />
          <div>
            <h1 className="text-2xl font-bold">{t("profileTitle")}</h1>
            <p className="text-ink-2">{t("profileIntro")}</p>
          </div>
        </div>
        <Card>
          <ProfileForm user={user} />
        </Card>
      </main>
    );
  }

  const list = measurements.data ?? [];
  return (
    <Shell>
      {measurements.isPending ? (
        <p className="py-10 text-center text-muted">…</p>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage profile={profile} measurements={list} username={user.username} />} />
          <Route
            path="/historial"
            element={
              <Suspense fallback={<p className="py-10 text-center text-muted">…</p>}>
                <HistoryPage profile={profile} measurements={list} />
              </Suspense>
            }
          />
          <Route path="/agregar" element={<AddPage profile={profile} />} />
          <Route path="/ajustes" element={<SettingsPage user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </Shell>
  );
}

export function App() {
  const me = useMe();
  const { t, lang, setLang } = useI18n();
  const online = useOnline();
  const profileLang = me.data?.profile?.language;

  // The saved profile language wins over the device language once signed in.
  useEffect(() => {
    if (profileLang && profileLang !== lang) setLang(profileLang);
  }, [profileLang]);

  if (me.isPending) {
    // Offline with nothing saved yet: say so instead of showing a blank screen.
    return online ? null : (
      <main className="mx-auto flex min-h-dvh max-w-md items-center px-6 text-center text-ink-2">
        <p>{t("offlineNoData")}</p>
      </main>
    );
  }
  if (!me.data) return <AuthPage />;
  return <SignedIn user={me.data} />;
}
