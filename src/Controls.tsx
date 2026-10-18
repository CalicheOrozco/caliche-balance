import { useQueryClient } from "@tanstack/react-query";
import { FiMoon, FiSun } from "react-icons/fi";
import type { UserDto } from "../shared/schemas.ts";
import { api } from "./api.ts";
import { type Language, useI18n } from "./i18n.tsx";
import { useTheme } from "./theme.ts";

/**
 * Language and theme switches shown on every screen. When signed in with a profile, the
 * language is also saved to the profile so it follows the person to other devices.
 */
export function Controls() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useTheme();
  const queryClient = useQueryClient();

  const changeLanguage = (next: Language) => {
    if (next === lang) return;
    setLang(next);
    const user = queryClient.getQueryData<UserDto | null>(["me"]);
    if (user?.profile) {
      const profile = { ...user.profile, language: next, displayName: user.profile.displayName ?? undefined };
      api.saveProfile(profile).then((saved) => queryClient.setQueryData(["me"], saved), () => undefined);
    }
  };

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label={t("language")} className="flex rounded-full bg-surface-2 p-0.5 text-xs font-semibold">
        {(["es", "en"] as const).map((code) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={lang === code}
            onClick={() => changeLanguage(code)}
            className={`min-h-8 rounded-full px-2.5 transition ${lang === code ? "bg-brand text-brand-ink" : "text-ink-2"}`}
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
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 transition hover:text-ink active:scale-95"
      >
        {theme === "dark" ? <FiSun size={18} aria-hidden /> : <FiMoon size={18} aria-hidden />}
      </button>
    </div>
  );
}
