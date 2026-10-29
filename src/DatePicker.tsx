// Adapted from the DatePicker in premiummg-ui (Premium MG), recolored to Caliche green,
// sized for touch, and translated through the app's own i18n. Icons come from react-icons (Feather).
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  getMonth,
  getYear,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isValid,
  type Locale,
  parseISO,
  setMonth,
  setYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { enUS, es } from "date-fns/locale";
import { FiCalendar, FiChevronLeft, FiChevronRight, FiX } from "react-icons/fi";
import { type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n.tsx";

type View = "days" | "months" | "years";

const YEARS_PER_PAGE = 12;

function buildCalendarDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month));
  const end = endOfWeek(endOfMonth(month));
  const days: Date[] = [];
  let cur = start;
  while (cur <= end) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

function yearPageStart(year: number) {
  return Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
}

/** Closes the popover on a tap or click outside it. pointerdown also fires for taps on iPhone. */
function useOutsidePointer(ref: RefObject<HTMLElement | null>, onOutside: () => void, enabled: boolean) {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;
  useEffect(() => {
    if (!enabled) return;
    function handle(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutsideRef.current();
    }
    document.addEventListener("pointerdown", handle);
    return () => document.removeEventListener("pointerdown", handle);
  }, [ref, enabled]);
}


export interface DatePickerProps {
  label: string;
  /** "yyyy-MM-dd", or "" when empty. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  maxDate?: Date;
  minDate?: Date;
  /** Hides the clear controls for required dates. */
  required?: boolean;
  /**
   * What to show instead of the field (for example "Today"); tapping it opens the calendar. The
   * label is then only read by screen readers.
   */
  trigger?: ReactNode;
}

export function DatePicker({ label, value, onChange, disabled, placeholder, maxDate, minDate, required, trigger }: DatePickerProps) {
  const { t, lang } = useI18n();
  const locale: Locale = lang === "es" ? es : enUS;
  const id = useId();
  const [view, setView] = useState<View>("days");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const dayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(startOfWeek(new Date(2024, 0, 7)), i), "EEEEEE", { locale })),
    [locale],
  );
  const monthLabels = useMemo(() => Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), "MMM", { locale })), [locale]);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const p = value ? parseISO(value) : null;
    return p && isValid(p) ? p : new Date();
  });

  const close = () => {
    setOpen(false);
    setView("days");
  };
  // The calendar opens under the field, moved left when the field sits too far right for it to fit.
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const left = containerRef.current.getBoundingClientRect().left;
    const width = Math.min(320, window.innerWidth - 32);
    setShift(Math.min(0, window.innerWidth - 16 - (left + width)));
  }, [open]);
  useOutsidePointer(containerRef, close, open);

  const selected: Date | null = value && isValid(parseISO(value)) ? parseISO(value) : null;
  const today = new Date();
  const yearStart = yearPageStart(getYear(viewMonth));

  function isDayDisabled(day: Date) {
    if (maxDate && isAfter(startOfDay(day), startOfDay(maxDate))) return true;
    if (minDate && isBefore(startOfDay(day), startOfDay(minDate))) return true;
    return false;
  }
  function isMonthDisabled(idx: number) {
    const y = getYear(viewMonth);
    if (maxDate && (y > getYear(maxDate) || (y === getYear(maxDate) && idx > getMonth(maxDate)))) return true;
    if (minDate && (y < getYear(minDate) || (y === getYear(minDate) && idx < getMonth(minDate)))) return true;
    return false;
  }
  function isYearDisabled(year: number) {
    if (maxDate && year > getYear(maxDate)) return true;
    if (minDate && year < getYear(minDate)) return true;
    return false;
  }
  // (year, month) compared as one ordinal so the bound holds across year edges.
  const ym = (d: Date) => getYear(d) * 12 + getMonth(d);
  const nextDisabled =
    view === "days"
      ? maxDate
        ? ym(viewMonth) >= ym(maxDate)
        : false
      : view === "months"
        ? maxDate
          ? getYear(viewMonth) >= getYear(maxDate)
          : false
        : maxDate
          ? yearStart + YEARS_PER_PAGE > getYear(maxDate)
          : false;
  const prevDisabled =
    view === "days"
      ? minDate
        ? ym(viewMonth) <= ym(minDate)
        : false
      : view === "months"
        ? minDate
          ? getYear(viewMonth) <= getYear(minDate)
          : false
        : minDate
          ? yearStart <= yearPageStart(getYear(minDate))
          : false;

  function toggle() {
    if (disabled) return;
    if (open) return close();
    if (selected) setViewMonth(selected);
    setOpen(true);
  }

  function selectDay(day: Date) {
    onChange(format(day, "yyyy-MM-dd"));
    close();
  }

  function handlePrev() {
    if (view === "days") setViewMonth((m) => subMonths(m, 1));
    if (view === "months") setViewMonth((m) => setYear(m, getYear(m) - 1));
    if (view === "years") setViewMonth((m) => setYear(m, getYear(m) - YEARS_PER_PAGE));
  }

  function handleNext() {
    if (view === "days") setViewMonth((m) => addMonths(m, 1));
    if (view === "months") setViewMonth((m) => setYear(m, getYear(m) + 1));
    if (view === "years") setViewMonth((m) => setYear(m, getYear(m) + YEARS_PER_PAGE));
  }

  const calendarDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);

  const headerLabel =
    view === "days"
      ? format(viewMonth, "LLLL yyyy", { locale })
      : view === "months"
        ? format(viewMonth, "yyyy")
        : `${yearStart} - ${yearStart + YEARS_PER_PAGE - 1}`;

  const cell = (state: "disabled" | "selected" | "today" | "normal" | "outside") =>
    ({
      disabled: "text-muted/40 cursor-not-allowed",
      selected: "bg-brand text-brand-ink font-semibold shadow-sm",
      today: "text-brand font-semibold ring-1 ring-brand/50",
      normal: "text-ink hover:bg-surface-2",
      outside: "text-muted/60 hover:bg-surface-2",
    })[state];

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className={trigger ? "sr-only" : "mb-1.5 block text-sm font-medium text-ink-2"}>
        {label}
      </label>
      {trigger ? (
        <button
          id={id}
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`w-full rounded-xl px-2 py-2 text-center font-semibold transition hover:bg-surface-2 ${open ? "bg-surface-2" : ""}`}
        >
          {trigger}
        </button>
      ) : (
        <button
          id={id}
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`flex w-full items-center justify-between gap-2 rounded-2xl border bg-surface-2 px-4 py-3 text-left transition ${
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          } ${open ? "border-brand ring-2 ring-brand/20" : "border-line"}`}
        >
          <span className={`truncate ${selected ? "text-ink" : "text-muted"}`}>
            {selected ? format(selected, "PP", { locale }) : (placeholder ?? t("selectDate"))}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-muted">
            {selected && !disabled && !required && (
              <span
                role="button"
                tabIndex={0}
                aria-label={t("clear")}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                onKeyDown={(e) => e.key === "Enter" && onChange("")}
                className="rounded-lg p-1 transition hover:text-ink"
              >
                <FiX size={14} aria-hidden />
              </span>
            )}
            <FiCalendar size={18} aria-hidden />
          </span>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={label}
          style={{ left: shift }}
          className="absolute z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={prevDisabled}
              aria-label={t("previous")}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              <FiChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === "days" ? "months" : "years"))}
              className="rounded-xl px-3 py-2 font-semibold text-ink capitalize transition select-none hover:bg-surface-2 hover:text-brand"
            >
              {headerLabel}
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={nextDisabled}
              aria-label={t("next")}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              <FiChevronRight size={18} aria-hidden />
            </button>
          </div>

          {view === "days" && (
            <div className="px-3 pb-3">
              <div className="mb-1 grid grid-cols-7">
                {dayLabels.map((d) => (
                  <div key={d} className="py-1 text-center text-[11px] font-semibold tracking-wide text-muted uppercase">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-1">
                {calendarDays.map((day) => {
                  const isDisabled = isDayDisabled(day);
                  const state = isDisabled
                    ? "disabled"
                    : selected && isSameDay(day, selected)
                      ? "selected"
                      : isSameDay(day, today)
                        ? "today"
                        : isSameMonth(day, viewMonth)
                          ? "normal"
                          : "outside";
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => selectDay(day)}
                      aria-label={format(day, "PPPP", { locale })}
                      aria-pressed={state === "selected"}
                      className={`mx-auto flex h-10 w-10 items-center justify-center rounded-xl text-sm font-medium transition ${cell(state)}`}
                    >
                      {format(day, "d")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {view === "months" && (
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              {monthLabels.map((monthLabel, idx) => {
                const isDisabled = isMonthDisabled(idx);
                const monthDate = setMonth(viewMonth, idx);
                const state = isDisabled
                  ? "disabled"
                  : selected && isSameMonth(selected, monthDate)
                    ? "selected"
                    : isSameMonth(today, monthDate)
                      ? "today"
                      : "normal";
                return (
                  <button
                    key={monthLabel}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      setViewMonth((m) => setMonth(m, idx));
                      setView("days");
                    }}
                    className={`rounded-xl py-2.5 text-sm font-medium capitalize transition ${cell(state)}`}
                  >
                    {monthLabel}
                  </button>
                );
              })}
            </div>
          )}

          {view === "years" && (
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearStart + i).map((year) => {
                const isDisabled = isYearDisabled(year);
                const state = isDisabled
                  ? "disabled"
                  : selected && getYear(selected) === year
                    ? "selected"
                    : getYear(today) === year
                      ? "today"
                      : "normal";
                return (
                  <button
                    key={year}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      setViewMonth((m) => setYear(m, year));
                      setView("months");
                    }}
                    className={`rounded-xl py-2.5 text-sm font-medium transition ${cell(state)}`}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line px-4 py-2">
            {required ? (
              <span />
            ) : (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  close();
                }}
                className="min-h-10 text-sm text-muted transition hover:text-ink"
              >
                {t("clear")}
              </button>
            )}
            {!isDayDisabled(today) && (
              <button type="button" onClick={() => selectDay(today)} className="min-h-10 text-sm font-semibold text-brand transition hover:opacity-80">
                {t("today")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
