import { useState } from "react";
import { STREAK_UNLOCKS } from "../shared/achievements.ts";

/** The app's main color. Green is always there; gold and diamond are unlocked by streaks. */
export type Accent = "green" | "gold" | "diamond";

export const ACCENTS: { accent: Accent; unlockDays: number | null }[] = [
  { accent: "green", unlockDays: null },
  { accent: "gold", unlockDays: STREAK_UNLOCKS.gold },
  { accent: "diamond", unlockDays: STREAK_UNLOCKS.diamond },
];

const STORAGE_KEY = "accent";

function saved(): Accent {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "gold" || value === "diamond" ? value : "green";
  } catch {
    return "green";
  }
}

/** Remembered on this device; index.html applies it before the first paint. */
export function useAccent(): [Accent, (accent: Accent) => void] {
  const [accent, setState] = useState<Accent>(saved);
  const set = (next: Accent) => {
    try {
      if (next === "green") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the change still applies for this visit.
    }
    if (next === "green") delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = next;
    setState(next);
  };
  return [accent, set];
}
