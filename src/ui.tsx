import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useEffect, useId, useState } from "react";
import type { IconType } from "react-icons";
import { FiAlertOctagon, FiAlertTriangle, FiArrowDown, FiArrowUp, FiCheck, FiChevronLeft, FiChevronRight, FiEye, FiEyeOff, FiX } from "react-icons/fi";
import { Link, NavLink } from "react-router";
import type { Band, Classification, Status } from "../shared/reference.ts";
import { fromKilograms } from "../shared/schemas.ts";
import { useMe } from "./api.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";

/*
 * Building blocks of the 2026 redesign. Cards have 24 to 28 px corners, a hairline border and a
 * soft shadow that disappears in dark mode; text is Manrope with tabular figures.
 */

export function Card({ children, className = "", padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-[28px] border border-line bg-surface shadow-card ${padded ? "p-5" : "overflow-hidden"} ${className}`}>
      {children}
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "dangerText" | "subtle" }) {
  const styles = {
    primary: "bg-brand text-brand-ink font-extrabold",
    secondary: "bg-surface-2 text-ink font-bold",
    danger: "bg-bad-soft text-bad-text font-bold",
    ghost: "text-brand-text font-bold",
    dangerText: "text-bad-text font-bold",
    subtle: "text-muted text-sm font-bold",
  }[variant];
  return (
    <button
      className={`min-h-12 rounded-2xl px-4 py-2.5 text-[15px] transition active:scale-[0.98] disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string; error?: string | null };

export function Field({ label, help, error, trailing, ...props }: FieldProps & { trailing?: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-bold text-ink-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={`h-13.5 w-full min-w-0 rounded-2xl border border-line bg-surface px-4 font-semibold text-ink outline-none placeholder:font-medium placeholder:text-muted focus:border-2 focus:border-brand ${trailing ? "pr-14" : ""}`}
          {...props}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error ? (
        <span className="mt-1 block text-sm font-semibold text-bad-text">{error}</span>
      ) : help ? (
        <span className="mt-1 block text-sm text-muted">{help}</span>
      ) : null}
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

/** The bare 52 by 32 switch, for rows that lay out their own label. */
export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-13 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? "bg-brand" : "bg-line-strong"}`}
    >
      <span className={`absolute top-0.75 h-6.5 w-6.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-all ${checked ? "left-5.75" : "left-0.75"}`} />
    </button>
  );
}

/** An on/off switch with its label, for settings. */
export function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-bold text-ink">{label}</span>
        {hint && <span className="text-xs font-semibold text-muted">{hint}</span>}
      </span>
      <Toggle label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const PILL_ON = "bg-surface text-ink font-extrabold shadow-pill";
const PILL_OFF = "text-ink-2 font-bold";

/** A pill-shaped choice between a few options (a radio group). */
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
          className={`h-9 min-w-0 flex-1 rounded-xl px-2 text-sm transition ${o.value === value ? PILL_ON : PILL_OFF}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The same pills as Segmented, but each one is a link to a page (Body's Summary, Trends, Weigh-ins). */
export function TabPills({ label, tabs }: { label: string; tabs: { to: string; label: string }[] }) {
  return (
    <nav aria-label={label} className="flex rounded-2xl bg-surface-2 p-1">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          replace
          className={({ isActive }) => `flex h-9.5 min-w-0 flex-1 items-center justify-center rounded-xl text-sm transition ${isActive ? PILL_ON : PILL_OFF}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

const STATUS_ICON: Record<Status, IconType> = { good: FiCheck, warn: FiAlertTriangle, bad: FiAlertOctagon };
export const STATUS_SOFT: Record<Status, string> = {
  good: "bg-good-soft text-good-text",
  warn: "bg-warn-soft text-warn-text",
  bad: "bg-bad-soft text-bad-text",
};

/** A small pill with an icon and a label, so a status never relies on color alone. */
export function StatusPill({ status, children }: { status: Status; children: ReactNode }) {
  const { t } = useI18n();
  const StatusIcon = STATUS_ICON[status];
  return (
    <span className={`inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-extrabold ${STATUS_SOFT[status]}`}>
      <StatusIcon size={13} strokeWidth={2.6} aria-hidden />
      {children}
      <span className="sr-only">({t(`status.${status}` as MessageKey)})</span>
    </span>
  );
}

/** A band label always carries an icon and text, so status never relies on color alone. */
export function StatusBadge({ band }: { band: Band }) {
  const { t } = useI18n();
  return <StatusPill status={band.status}>{t(`band.${band.key}` as MessageKey)}</StatusPill>;
}

/** "▼ 0.4": a change in a soft pill, green when it goes the right way and amber when not. */
export function DeltaPill({ value, good, children, size = "md" }: { value: number; good: boolean; children: ReactNode; size?: "sm" | "md" }) {
  const Arrow = value < 0 ? FiArrowDown : FiArrowUp;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-extrabold ${good ? "bg-good-soft text-good-text" : "bg-warn-soft text-warn-text"} ${size === "sm" ? "h-6.5 px-2.5 text-xs" : "h-7.5 px-2.5 text-sm"}`}
    >
      {Math.abs(value) >= 0.05 && <Arrow size={size === "sm" ? 12 : 14} strokeWidth={2.6} aria-hidden />}
      {children}
    </span>
  );
}

const BAND_FILL: Record<Status, string> = { good: "bg-good-band", warn: "bg-warn-band", bad: "bg-bad-band" };
const MARK_BORDER: Record<Status, string> = { good: "border-brand", warn: "border-warn", bad: "border-bad" };

/**
 * Horizontal scale of every band with a marker at the value. Open-ended bands get a
 * width equal to their neighbour so the scale stays readable.
 */
export function RangeBar({
  classification,
  format,
  labels = "edges",
}: {
  classification: Pick<Classification, "value" | "bands">;
  format: (n: number) => string;
  /** "edges" prints the numbers where the bands meet; "names" prints each band's name under it. */
  labels?: "edges" | "names" | "none";
}) {
  const { t } = useI18n();
  const { bands, value } = classification;
  const edges = bands.flatMap((b) => [b.min, b.max]).filter((n): n is number => n !== null);
  const span = Math.max(...edges) - Math.min(...edges);
  const pad = span / Math.max(bands.length - 2, 1);
  const lo = Math.min(...edges) - pad;
  const hi = Math.max(...edges) + pad;
  const pct = (n: number) => ((Math.min(Math.max(n, lo), hi) - lo) / (hi - lo)) * 100;
  const current = bands.find((b) => (b.min === null || value >= b.min) && (b.max === null || value < b.max)) ?? bands[bands.length - 1]!;
  return (
    <div className="mt-3" aria-hidden>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1.5 flex h-2 gap-0.75">
          {bands.map((b) => (
            <div key={b.key} className={`rounded-full ${BAND_FILL[b.status]}`} style={{ width: `${pct(b.max ?? hi) - pct(b.min ?? lo)}%` }} />
          ))}
        </div>
        <div
          className={`absolute top-0 h-5 w-5 -translate-x-1/2 rounded-full border-[5px] bg-surface ${MARK_BORDER[current.status]}`}
          style={{ left: `${pct(value)}%` }}
        />
      </div>
      {labels === "edges" && (
        <div className="relative mt-1 h-4 text-[11px] font-bold text-muted">
          {edges
            .filter((e, i) => edges.indexOf(e) === i)
            .map((e) => (
              <span key={e} className="absolute -translate-x-1/2" style={{ left: `${pct(e)}%` }}>
                {format(e)}
              </span>
            ))}
        </div>
      )}
      {labels === "names" && (
        <div className="mt-1 flex text-[10px] font-bold text-muted">
          {bands.map((b) => (
            <span key={b.key} className="truncate pr-1" style={{ width: `${pct(b.max ?? hi) - pct(b.min ?? lo)}%` }}>
              {t(`band.${b.key}` as MessageKey)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Concentric progress rings (Today's balance, Apple's activity rings). Each ring is a fraction
 * from 0 to 1; anything over 1 is drawn full. Tailwind stroke classes set the colors.
 */
export function Rings({
  rings,
  size,
  stroke,
  gap = 4,
  trackClass = "stroke-track",
  label,
  children,
}: {
  rings: { fraction: number; className: string }[];
  size: number;
  stroke: number;
  gap?: number;
  trackClass?: string;
  label?: string;
  children?: ReactNode;
}) {
  const c = size / 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="-rotate-90">
        {rings.map((ring, i) => {
          const r = c - stroke / 2 - i * (stroke + gap);
          const length = 2 * Math.PI * r;
          const f = Math.min(Math.max(ring.fraction, 0), 1);
          return (
            <g key={i}>
              <circle cx={c} cy={c} r={r} fill="none" strokeWidth={stroke} className={trackClass} />
              {f > 0 && (
                <circle
                  cx={c}
                  cy={c}
                  r={r}
                  fill="none"
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${f * length} ${length}`}
                  className={ring.className}
                />
              )}
            </g>
          );
        })}
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>}
    </div>
  );
}

/** A thin horizontal progress bar. */
export function Progress({ fraction, className = "bg-brand", label, height = 6 }: { fraction: number; className?: string; label?: string; height?: number }) {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  return (
    <div
      role={label ? "progressbar" : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? pct : undefined}
      className="overflow-hidden rounded-full bg-track"
      style={{ height }}
    >
      <div className={`h-full rounded-full transition-all ${className}`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

/** The person's initial in a brand-colored circle; a link to their profile when `to` is given. */
export function Avatar({ size = 44, to }: { size?: number; to?: string }) {
  const { t } = useI18n();
  const me = useMe().data;
  const name = me?.profile?.displayName ?? me?.username ?? "";
  const initial = name.trim().charAt(0).toUpperCase() || "·";
  const className = "flex shrink-0 items-center justify-center rounded-full bg-brand font-extrabold text-brand-ink";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  return to ? (
    <Link to={to} aria-label={t("nav.profile")} className={`${className} transition active:scale-95`} style={style}>
      {initial}
    </Link>
  ) : (
    <span className={className} style={style} aria-hidden>
      {initial}
    </span>
  );
}

/** A 44 px round button with a hairline border, for header actions. */
export function IconButton({ label, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition hover:text-ink active:scale-95 disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** The same 44 px round button as IconButton, as a link. */
export function IconLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-2 transition hover:text-ink active:scale-95"
    >
      {children}
    </Link>
  );
}

/** A tab's title with a line under it and the actions (settings, avatar) on the right. */
export function PageHeader({ title, subtitle, eyebrow, children }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 px-1">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {eyebrow && <p className="text-[13px] font-semibold text-muted">{eyebrow}</p>}
        <h1 className="text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="text-[13px] font-semibold text-muted">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

/** "‹ Today": the way back from a page that has no tab of its own. */
export function BackLink({ to, label, children }: { to: string; label: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <Link to={to} className="-ml-1 inline-flex min-h-11 items-center gap-0.5 pr-3 text-base font-bold text-brand-text">
        <FiChevronLeft size={22} strokeWidth={2.4} aria-hidden />
        {label}
      </Link>
      {children}
    </div>
  );
}

/** "Para hoy · 2 de 4": a section title between cards, with an optional note on the right. */
export function SectionHeader({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex items-baseline justify-between gap-3 px-1 pt-2.5">
      <h2 className="text-xl font-extrabold tracking-[-0.01em]">{title}</h2>
      {aside && <span className="shrink-0 text-[13px] font-bold text-muted">{aside}</span>}
    </div>
  );
}

/** "PARA VIGILAR": a small uppercase label over a group of rows. */
export function GroupLabel({ children, className = "text-muted" }: { children: ReactNode; className?: string }) {
  return <h2 className={`mx-1 mt-2.5 text-[13px] font-extrabold tracking-[0.06em] uppercase ${className}`}>{children}</h2>;
}

/** A row of a list card that leads somewhere: content on the left, a chevron on the right. */
export function RowLink({ to, children, className = "" }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`flex min-h-16 items-center gap-3 border-t border-line px-4 py-3 text-ink first:border-t-0 ${className}`}>
      {children}
      <FiChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
    </Link>
  );
}

/** A tip or explanation inside a card: an icon and a sentence on a soft background. */
export function Callout({ icon: Icon, children, tone = "neutral" }: { icon: IconType; children: ReactNode; tone?: "neutral" | "brand" | "hero" }) {
  const styles = {
    neutral: { box: "bg-surface-2 text-ink-2", icon: "text-brand-text" },
    brand: { box: "bg-brand-soft text-ink", icon: "text-brand-text" },
    hero: { box: "bg-hero-track text-hero-ink", icon: "text-hero-ink" },
  }[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[13px] leading-4.75 font-semibold ${styles.box}`}>
      <Icon size={18} strokeWidth={2.2} className={`mt-px shrink-0 ${styles.icon}`} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** "+1.6" / "−0.4": a difference always shows its sign (a real minus sign, not a hyphen). */
export function signed(n: number, format: (n: number) => string): string {
  if (Math.abs(n) < 0.05) return format(0);
  return `${n > 0 ? "+" : "−"}${format(Math.abs(n))}`;
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
    /** "7:02". */
    time: (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }),
    /** "viernes 6 de noviembre" / "Friday, November 6". */
    longDay: (date: Date) => date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }),
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

/** The app's mark: a "C" with a balance line, on the dark green of the hero cards. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[30%] bg-hero-a text-hero" style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 6.5A7 7 0 1 0 17 17.5" />
        <path d="M9 12h12" />
        <circle cx="21" cy="12" r="0.5" />
      </svg>
    </span>
  );
}

/** Which build of the app this is, to tell whether an installed copy (PWA) has updated. */
export function AppVersion() {
  const { t, tf } = useI18n();
  const f = useFormat();
  // The dev server always runs the code as it is now; a commit would be the one it started on.
  const text = __APP_VERSION__ === "local" ? t("appVersionLocal") : tf("appVersion", { version: __APP_VERSION__, when: f.dateTime(__APP_BUILT_AT__) });
  return <p className="text-center text-xs font-semibold text-muted">{text}</p>;
}

/**
 * A small window over the page: closes with its button, a tap outside it, or Escape, and gives
 * the focus back to whatever opened it.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const titleId = useId();
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      back?.focus();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-[28px] border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-extrabold">
            {title}
          </h2>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2 hover:text-ink"
          >
            <FiX size={18} aria-hidden />
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
