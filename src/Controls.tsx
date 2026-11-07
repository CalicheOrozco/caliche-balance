import { useQueryClient } from "@tanstack/react-query";
import { FiMoon, FiSun } from "react-icons/fi";
import type { UserDto } from "../shared/schemas.ts";
import { api } from "./api.ts";
import { type Language, useI18n } from "./i18n.tsx";
import { useTheme } from "./theme.ts";

/**
 * Changes the app language. When signed in with a profile, the language is also saved to the
 * profile so it follows the person to other devices.
 */
export function useChangeLanguage(): (next: Language) => void {
  const { lang, setLang } = useI18n();
  const queryClient = useQueryClient();
  return (next) => {
    if (next === lang) return;
    setLang(next);
    const user = queryClient.getQueryData<UserDto | null>(["me"]);
    if (user?.profile) {
      const profile = { ...user.profile, language: next, displayName: user.profile.displayName ?? undefined };
      api.saveProfile(profile).then((saved) => queryClient.setQueryData(["me"], saved), () => undefined);
    }
  };
}

/**
 * Language and theme switches for the screens without Settings (signing in, the first profile).
 * "hero" sits on the dark green welcome card; "plain" on the page background.
 */
export function Controls({ tone = "plain" }: { tone?: "plain" | "hero" }) {
  const { t, lang } = useI18n();
  const [theme, setTheme] = useTheme();
  const changeLanguage = useChangeLanguage();
  const nextTheme = theme === "dark" ? "light" : "dark";
  const box = tone === "hero" ? "bg-hero-track text-hero-ink" : "bg-surface-2 text-ink-2";
  const on = tone === "hero" ? "bg-hero-a text-hero" : "bg-surface text-ink shadow-pill";

  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label={t("language")} className={`flex rounded-full p-1 text-xs font-extrabold ${box}`}>
        {(["es", "en"] as const).map((code) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={lang === code}
            onClick={() => changeLanguage(code)}
            className={`min-h-8 rounded-full px-2.5 transition ${lang === code ? on : ""}`}
          >
            {code.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        aria-label={nextTheme === "dark" ? t("darkMode") : t("lightMode")}
        title={nextTheme === "dark" ? t("darkMode") : t("lightMode")}
        className={`flex h-10 w-10 items-center justify-center rounded-full transition active:scale-95 ${box}`}
      >
        {theme === "dark" ? <FiSun size={18} aria-hidden /> : <FiMoon size={18} aria-hidden />}
      </button>
    </div>
  );
}
