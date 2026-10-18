import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId, useState } from "react";
import type { IconType } from "react-icons";
import { FiAlertOctagon, FiAlertTriangle, FiCheckCircle, FiEye, FiEyeOff } from "react-icons/fi";
import type { Band, Classification, Status } from "../shared/reference.ts";
import { fromKilograms } from "../shared/schemas.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";

export function Card({ children, className = "", padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={`rounded-3xl border border-line bg-surface ${padded ? "p-5" : ""} ${className}`}>{children}</section>;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "dangerText" | "subtle" }) {
  const styles = {
    primary: "bg-brand text-brand-ink font-semibold",
    secondary: "bg-surface-2 text-ink font-medium",
    danger: "bg-bad/15 text-bad font-medium",
    ghost: "text-brand font-medium",
    dangerText: "text-bad text-sm font-medium",
    subtle: "text-muted text-sm font-medium",
  }[variant];
  return (
    <button
      className={`min-h-11 rounded-2xl px-4 py-2.5 transition active:scale-[0.98] disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string; error?: string | null };

export function Field({ label, help, error, trailing, ...props }: FieldProps & { trailing?: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-ink outline-none placeholder:text-muted focus:border-brand ${trailing ? "pr-14" : ""}`}
          {...props}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error ? <span className="mt-1 block text-sm text-bad">{error}</span> : help ? <span className="mt-1 block text-sm text-muted">{help}</span> : null}
    </div>
  );
}

/** Password input with a button to show or hide what is being typed. */
export function PasswordField(props: Omit<FieldProps, "type">) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <Field
      {...props}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:text-ink active:scale-95"
        >
          {visible ? <FiEyeOff size={20} aria-hidden /> : <FiEye size={20} aria-hidden />}
        </button>
      }
    />
  );
}

/** An on/off switch with its label, for settings. */
export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      <span className="text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? "bg-brand" : "bg-surface-2 ring-1 ring-line"}`}
      >
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      <select id={id} className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-ink outline-none focus:border-brand" {...props}>
        {children}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-xl px-2 text-sm font-medium transition ${o.value === value ? "bg-brand text-brand-ink" : "text-ink-2"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_ICON: Record<Status, IconType> = { good: FiCheckCircle, warn: FiAlertTriangle, bad: FiAlertOctagon };
const STATUS_COLOR: Record<Status, string> = { good: "text-good bg-good/15", warn: "text-warn bg-warn/15", bad: "text-bad bg-bad/15" };

/** A band label always carries an icon and text, so status never relies on color alone. */
export function StatusBadge({ band }: { band: Band }) {
  const { t } = useI18n();
  const StatusIcon = STATUS_ICON[band.status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold ${STATUS_COLOR[band.status]}`}>
      <StatusIcon size={14} aria-hidden />
      {t(`band.${band.key}` as MessageKey)}
      <span className="sr-only">({t(`status.${band.status}` as MessageKey)})</span>
    </span>
  );
}

const BAR_COLOR: Record<Status, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad" };

/**
 * Horizontal scale of every band with a marker at the value. Open-ended bands get a
 * width equal to their neighbour so the scale stays readable.
 */
export function RangeBar({ classification, format }: { classification: Classification; format: (n: number) => string }) {
  const { bands, value } = classification;
  const edges = bands.flatMap((b) => [b.min, b.max]).filter((n): n is number => n !== null);
  const span = Math.max(...edges) - Math.min(...edges);
  const pad = span / Math.max(bands.length - 2, 1);
  const lo = Math.min(...edges) - pad;
  const hi = Math.max(...edges) + pad;
  const pct = (n: number) => ((Math.min(Math.max(n, lo), hi) - lo) / (hi - lo)) * 100;
  return (
    <div className="mt-4" aria-hidden>
      <div className="relative">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {bands.map((b) => (
            <div key={b.key} className={`${BAR_COLOR[b.status]} opacity-70`} style={{ width: `${pct(b.max ?? hi) - pct(b.min ?? lo)}%` }} />
          ))}
        </div>
        <div
          className="absolute -top-1 h-4.5 w-4.5 -translate-x-1/2 rounded-full border-[3px] border-surface bg-ink"
          style={{ left: `${pct(value)}%` }}
        />
      </div>
      <div className="relative mt-1.5 h-4 text-xs text-muted">
        {edges.filter((e, i) => edges.indexOf(e) === i).map((e) => (
          <span key={e} className="absolute -translate-x-1/2" style={{ left: `${pct(e)}%` }}>
            {format(e)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function useFormat() {
  const { locale } = useI18n();
  const number = (n: number, digits = 1) => n.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return {
    number,
    weight: (kg: number, unit: "kg" | "lb") => `${number(fromKilograms(kg, unit))} ${unit}`,
    date: (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }),
    dateTime: (iso: string) =>
      new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
  };
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? t("copied") : t("copy")}
    </Button>
  );
}

export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/icon-192.png" alt="" width={size} height={size} className="rounded-[22%]" />;
}
