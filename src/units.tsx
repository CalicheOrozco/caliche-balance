import { useState } from "react";
import { CM_PER_IN, LB_PER_KG } from "../shared/schemas.ts";
import { useI18n } from "./i18n.tsx";

/*
 * The units a value is typed in. The profile's unit sets how the app shows weights and waists;
 * what is typed can use either unit (a scale or a tape often has both), and the server converts
 * whatever arrives. Each pick is remembered on this device.
 */

export type WaistUnit = "cm" | "in";
export type WeightUnit = "kg" | "lb";

function useRemembered<T extends string>(key: string, options: readonly T[], initial: T): [T, (value: T) => void] {
  const [value, setState] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return options.includes(saved as T) ? (saved as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    try {
      localStorage.setItem(key, next);
    } catch {
      // Private mode: the change still applies for this visit.
    }
    setState(next);
  };
  return [value, set];
}

/** The unit the waist is typed in: inches for people who weigh in pounds, centimeters otherwise, until they pick. */
export function useWaistUnit(profileUnit: WeightUnit): [WaistUnit, (unit: WaistUnit) => void] {
  return useRemembered("waist-unit", ["cm", "in"] as const, profileUnit === "lb" ? "in" : "cm");
}

/** The unit a weigh-in is typed in: the profile's, until the person picks the other one. */
export function useWeightUnit(profileUnit: WeightUnit): [WeightUnit, (unit: WeightUnit) => void] {
  return useRemembered("weight-input-unit", ["kg", "lb"] as const, profileUnit);
}

/** Typed text moved to another unit; text that is not a number, or is empty, stays as it is. */
function convert(value: string, factor: number): string {
  const n = Number(value.trim().replace(",", "."));
  if (value.trim() === "" || !Number.isFinite(n)) return value;
  return (n * factor).toFixed(1);
}

/** "96" cm becomes "37.8" in, and back. */
export function convertWaist(value: string, from: WaistUnit, to: WaistUnit): string {
  return from === to ? value : convert(value, to === "in" ? 1 / CM_PER_IN : CM_PER_IN);
}

/** "100.7" kg becomes "222.0" lb, and back. */
export function convertWeight(value: string, from: WeightUnit, to: WeightUnit): string {
  return from === to ? value : convert(value, to === "lb" ? LB_PER_KG : 1 / LB_PER_KG);
}

/** "cm | in" or "kg | lb": a small switch for a unit, sized to sit inside a field or under a title. */
export function UnitToggle<T extends string>({ unit, units, label, onChange }: { unit: T; units: readonly [T, T]; label: string; onChange: (unit: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-xl bg-surface-2 p-0.5">
      {units.map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={unit === u}
          onClick={() => onChange(u)}
          className={`h-9 min-w-11 rounded-[10px] px-2.5 text-sm transition ${unit === u ? "bg-surface font-extrabold text-ink shadow-pill" : "font-bold text-ink-2"}`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

export function WaistUnitToggle({ unit, onChange }: { unit: WaistUnit; onChange: (unit: WaistUnit) => void }) {
  const { t } = useI18n();
  return <UnitToggle unit={unit} units={["cm", "in"] as const} label={t("add.waistUnit")} onChange={onChange} />;
}

export function WeightUnitToggle({ unit, onChange }: { unit: WeightUnit; onChange: (unit: WeightUnit) => void }) {
  const { t } = useI18n();
  return <UnitToggle unit={unit} units={["kg", "lb"] as const} label={t("add.weightUnit")} onChange={onChange} />;
}
