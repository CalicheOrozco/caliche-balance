import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

/* Data shared by the Food page and its card on Today. */

/** The device's local day as YYYY-MM-DD. */
export const localIso = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
export const shiftDay = (iso: string, by: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** Entries of the last 30 days up to `to`, newest day last. */
export function useFood(to: string, enabled = true) {
  return useQuery({ queryKey: ["food", to], queryFn: () => api.food(shiftDay(to, -29), to), enabled });
}

/** Calories spent on a day per Apple Health (active plus resting), or null without them. */
export function spentOf(day: { activeKcal: number | null; restingKcal: number | null } | undefined): number | null {
  if (!day || (day.activeKcal == null && day.restingKcal == null)) return null;
  return Math.round((day.activeKcal ?? 0) + (day.restingKcal ?? 0));
}

