import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { FiActivity, FiPlus, FiSun } from "react-icons/fi";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import type { UserDto } from "../shared/schemas.ts";
import { useMe, useMeasurements } from "./api.ts";
import { Controls } from "./Controls.tsx";
import { MedalIcon, ScaleIcon } from "./icons.tsx";
import { useOnline } from "./offline.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { AddPage } from "./pages/Add.tsx";
import { AuthPage } from "./pages/Auth.tsx";
import { BodyPage } from "./pages/Body.tsx";
import { HomePage } from "./pages/Home.tsx";
import { MePage } from "./pages/Me.tsx";
import { ReadingPage } from "./pages/Reading.tsx";
import { AchievementsPage } from "./pages/Achievements.tsx";
import { ProfileForm, SettingsPage } from "./pages/Settings.tsx";
import { useAutoSync } from "./pages/Zepp.tsx";
import { Card, Logo } from "./ui.tsx";

// The chart library is large, so the pages with charts load only when they are opened.
const TrendsPage = lazy(() => import("./pages/History.tsx").then((m) => ({ default: m.TrendsPage })));
const WeighInsPage = lazy(() => import("./pages/History.tsx").then((m) => ({ default: m.WeighInsPage })));
const ActivityPage = lazy(() => import("./pages/Activity.tsx").then((m) => ({ default: m.ActivityPage })));

type Tab = { to: string; key: MessageKey; Icon: (props: { size?: number; strokeWidth?: number }) => ReactNode };

// Four tabs with Add in the middle; the profile is the avatar in each header and Settings is
// reached from Today and the profile.
const TABS_LEFT: Tab[] = [
  { to: "/", key: "nav.home", Icon: FiSun },
  { to: "/cuerpo", key: "nav.body", Icon: ScaleIcon },
];
const TABS_RIGHT: Tab[] = [
  { to: "/actividad", key: "nav.activity", Icon: FiActivity },
  { to: "/logros", key: "nav.achievements", Icon: MedalIcon },
];

/** Pages opened from somewhere else: they have a way back instead of the tab bar. */
const PUSHED = ["/agregar", "/medicion/", "/yo", "/ajustes"];

function TabLink({ tab }: { tab: Tab }) {
  const { t } = useI18n();
  return (
    <NavLink
      to={tab.to}
      end={tab.to === "/"}
      className={({ isActive }) =>
        `flex h-14 min-w-14 flex-col items-center justify-center gap-0.75 text-[11px] font-extrabold transition active:scale-95 ${isActive ? "text-brand" : "text-muted"}`
      }
    >
      <tab.Icon size={22} strokeWidth={2.2} />
      {t(tab.key)}
    </NavLink>
  );
}

function TabBar() {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("nav.main")}
      className="fixed inset-x-4 bottom-[max(env(safe-area-inset-bottom),12px)] z-30 mx-auto flex h-18 max-w-99.5 items-center justify-around rounded-[36px] border border-line bg-(--tab-bg) px-2 shadow-(--tab-shadow) backdrop-blur-xl"
    >
      {TABS_LEFT.map((tab) => (
        <TabLink key={tab.to} tab={tab} />
      ))}
      <Link
        to="/agregar"
        aria-label={t("nav.addMeasurement")}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-ink shadow-(--fab-shadow) transition active:scale-95"
      >
        <FiPlus size={26} strokeWidth={2.6} aria-hidden />
      </Link>
      {TABS_RIGHT.map((tab) => (
        <TabLink key={tab.to} tab={tab} />
      ))}
    </nav>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const online = useOnline();
  const { pathname } = useLocation();
  const pushed = PUSHED.some((p) => pathname.startsWith(p));
  return (
    <div className="mx-auto min-h-dvh max-w-md">
      {/*
        iOS 26 blurs whatever sits right under the status bar in a home-screen app. A solid strip there
        gives the blur a plain color, and the page starts below it so it never looks cut off.
      */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] bg-bg" aria-hidden />
      <main
        className={`px-4 ${pushed ? "pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+3rem)]" : "pt-[calc(env(safe-area-inset-top)+1.75rem)] pb-[calc(env(safe-area-inset-bottom)+8rem)]"}`}
      >
        {!online && <p className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn-text">{t("offlineBanner")}</p>}
        {children}
      </main>
      {!pushed && <TabBar />}
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
      <main className="mx-auto max-w-md px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-10">
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
          <Route
            path="/"
            element={
              // streakReward is missing on an account cached offline by an older version of the app.
              <HomePage profile={profile} measurements={list} username={user.username} goals={user.goals} streakReward={user.streakReward ?? null}
                // Missing on an account cached offline by an older version of the app.
                appleHealthConnected={user.appleHealth != null}
              />
            }
          />
          <Route
            path="/logros"
            element={<AchievementsPage user={user} profile={profile} />}
          />
          <Route path="/cuerpo" element={<BodyPage profile={profile} measurements={list} />} />
          <Route
            path="/cuerpo/tendencias"
            element={
              <Suspense fallback={<p className="py-10 text-center text-muted">…</p>}>
                <TrendsPage profile={profile} measurements={list} goals={user.goals} />
              </Suspense>
            }
          />
          <Route
            path="/cuerpo/pesadas"
            element={
              <Suspense fallback={<p className="py-10 text-center text-muted">…</p>}>
                <WeighInsPage profile={profile} measurements={list} goals={user.goals} />
              </Suspense>
            }
          />
          <Route path="/historial" element={<Navigate to="/cuerpo/tendencias" replace />} />
          <Route
            path="/actividad"
            element={
              <Suspense fallback={<p className="py-10 text-center text-muted">…</p>}>
                <ActivityPage user={user} />
              </Suspense>
            }
          />
          <Route path="/yo" element={<MePage profile={profile} measurements={list} goals={user.goals} />} />
          <Route path="/medicion/:id" element={<ReadingPage profile={profile} measurements={list} />} />
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
