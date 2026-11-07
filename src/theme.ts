import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
/** What the person picked in Settings: a fixed theme, or follow the system. */
export type ThemeChoice = Theme | "system";

const STORAGE_KEY = "theme";
const BACKGROUND: Record<Theme, string> = { light: "#f2f5f3", dark: "#050807" };

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BACKGROUND[theme]);
}

/**
 * Light, dark or the system's. Follows the system until the person picks one; the pick is
 * remembered on this device. index.html applies the same rule before the first paint.
 * Returns the theme in use, the choice behind it and a setter for the choice.
 */
export function useTheme(): [Theme, (choice: ThemeChoice) => void, ThemeChoice] {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => savedTheme() ?? "system");
  const [theme, setThemeState] = useState<Theme>(() => savedTheme() ?? systemTheme());

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (!savedTheme()) {
        const next = systemTheme();
        apply(next);
        setThemeState(next);
      }
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  const setChoice = (next: ThemeChoice) => {
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the change still applies for this visit.
    }
    const resolved = next === "system" ? systemTheme() : next;
    apply(resolved);
    setThemeState(resolved);
    setChoiceState(next);
  };

  return [theme, setChoice, choice];
}
