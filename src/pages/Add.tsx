import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type PointerEvent as ReactPointerEvent, useId, useRef, useState } from "react";
import { FiChevronDown, FiMinus, FiPlus, FiX } from "react-icons/fi";
import { Link, useNavigate } from "react-router";
import { CM_PER_IN, fromKilograms, NOTE_MAX_LENGTH, parseDecimal, type ProfileDto, toKilograms } from "../../shared/schemas.ts";
import { api, useMeasurements } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { convertWaist, convertWeight, useWaistUnit, useWeightUnit, WaistUnitToggle, WeightUnitToggle } from "../units.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { Button, Field, Segmented, useFormat } from "../ui.tsx";

/** Current local date ("yyyy-MM-dd") and time ("HH:mm"). */
function nowLocal(): { date: string; time: string } {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

const optional = (s: string) => (s.trim() === "" ? null : s);

/** Mass fields are typed in the unit picked for the weigh-in and sent in kilograms. */
function massInKg(s: string, unit: "kg" | "lb"): unknown {
  const n = parseDecimal(optional(s));
  return typeof n === "number" ? toKilograms(n, unit) : n;
}

/** "96,0" and "96.0" both read as 96. NaN when the text is not a number. */
function readNumber(s: string): number {
  return Number(s.trim().replace(",", "."));
}

const RULER_WIDTH = 320;
const TICK_GAP = 7.6;
const TICKS_EACH_SIDE = 20;

/**
 * The big number with minus and plus buttons and a ruler under it: typing, tapping or dragging the
 * ruler all change the same value. The ruler is centered on the value; every tick is one step and
 * every tenth tick is labeled.
 */
function ValueDial({
  id,
  label,
  value,
  onChange,
  unit,
  step,
  digits,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit: string;
  step: number;
  digits: number;
  hint?: string;
}) {
  const { tf, locale } = useI18n();
  const f = useFormat();
  const n = readNumber(value);
  const valid = Number.isFinite(n) && n > 0;
  const set = (next: number) => onChange(next > 0 ? next.toFixed(digits) : value);
  const nudge = (direction: 1 | -1) => valid && set(Math.round((n + direction * step) / step) * step);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!valid) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: n };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    // Dragging left brings the larger numbers to the center, like a real scale dial.
    const steps = Math.round((drag.current.x - e.clientX) / TICK_GAP);
    set(Math.round((drag.current.start + steps * step) / step) * step);
  };
  // The number gets smaller as it gets longer ("96.0", "100.7", "250.5"), so it always fits next to
  // the buttons on a phone, and the field is exactly as wide as what is typed.
  const chars = Math.max(value.length, (0).toFixed(digits).length);
  const fontSize = chars <= 4 ? 64 : chars === 5 ? 52 : 44;
  const center = RULER_WIDTH / 2;
  const base = valid ? Math.round(n / step) : 0;
  const ticks = valid
    ? Array.from({ length: TICKS_EACH_SIDE * 2 + 1 }, (_, i) => {
        const index = base - TICKS_EACH_SIDE + i;
        const x = center + (index * step - n) * (TICK_GAP / step);
        return { index, x, major: index % 10 === 0 };
      }).filter((tick) => tick.x >= 4 && tick.x <= RULER_WIDTH - 4)
    : [];
  return (
    <section className="flex flex-col items-center gap-1.5 rounded-[28px] border border-line bg-surface px-5 pt-6 pb-4.5 shadow-card">
      <label htmlFor={id} className="text-sm font-bold text-ink-2">
        {label}
      </label>
      <div className="flex max-w-full items-center gap-2.5">
        <button
          type="button"
          aria-label={tf("add.minus", { step: f.number(step, digits), unit })}
          onClick={() => nudge(-1)}
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink transition active:scale-95"
        >
          <FiMinus size={22} strokeWidth={2.6} aria-hidden />
        </button>
        <div className="flex min-w-0 items-baseline gap-1">
          <input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            required
            placeholder={(0).toLocaleString(locale, { minimumFractionDigits: digits })}
            style={{ width: `${chars * 0.62 + 0.1}em`, fontSize, lineHeight: "70px" }}
            className="min-w-0 bg-transparent p-0 text-center font-extrabold tracking-[-0.04em] text-ink outline-none placeholder:text-track"
          />
          <span className="text-[22px] font-bold text-muted">{unit}</span>
        </div>
        <button
          type="button"
          aria-label={tf("add.plus", { step: f.number(step, digits), unit })}
          onClick={() => nudge(1)}
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink transition active:scale-95"
        >
          <FiPlus size={22} strokeWidth={2.6} aria-hidden />
        </button>
      </div>
      <svg
        width={RULER_WIDTH}
        height={56}
        viewBox={`0 0 ${RULER_WIDTH} 56`}
        aria-hidden
        className="mt-1.5 block max-w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {ticks.map((tick) => (
          <g key={tick.index}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={tick.major ? 16 : 26}
              y2={40}
              strokeWidth={tick.major ? 2 : 1.5}
              strokeLinecap="round"
              className="stroke-line-strong"
            />
            {tick.major && (
              <text x={tick.x} y={54} textAnchor="middle" fontSize={11} fontWeight={700} className="fill-muted">
                {f.number(tick.index * step, 0)}
              </text>
            )}
          </g>
        ))}
        <line x1={center} x2={center} y1={10} y2={40} strokeWidth={4} strokeLinecap="round" className="stroke-brand" />
        <path d={`M${center - 7} 0 L${center + 7} 0 L${center} 8 Z`} className="fill-brand" />
      </svg>
      {hint && <p className="mt-1 text-center text-[13px] font-semibold text-muted">{hint}</p>}
    </section>
  );
}

/** The error under a form, in the redesign's soft red. */
function ErrorText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-2xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-text">
      {text}
    </p>
  );
}

/** The save button pinned to the bottom of the screen, above the home indicator. */
function SaveBar({ label, disabled, form }: { label: string; disabled: boolean; form: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <div className="mx-auto max-w-md">
        <Button type="submit" form={form} disabled={disabled} className="min-h-14 w-full rounded-[18px] text-[17px]">
          {label}
        </Button>
      </div>
    </div>
  );
}

function WeighInForm({ profile }: { profile: ProfileDto }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const latest = useMeasurements().data?.[0];
  const [date, setDate] = useState(() => nowLocal().date);
  const [time, setTime] = useState(() => nowLocal().time);
  // Typed in kg or lb, whichever the scale shows; starts in the profile's unit.
  const [unit, setUnit] = useWeightUnit(profile.unit);
  // Starts at the last weigh-in, so a small change is a tap or two on minus and plus.
  const [weight, setWeight] = useState(() => (latest ? fromKilograms(latest.weightKg, unit).toFixed(1) : ""));
  const [bodyFat, setBodyFat] = useState("");
  const [muscle, setMuscle] = useState("");
  const [water, setWater] = useState("");
  const [bone, setBone] = useState("");
  const [visceral, setVisceral] = useState("");
  const [waist, setWaist] = useState("");
  const [more, setMore] = useState(false);
  const [waistUnit, setWaistUnit] = useWaistUnit(profile.unit);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    // Numbers go as text; the shared schema parses decimal commas and converts units once.
    mutationFn: () =>
      api.addMeasurement({
        measuredAt: new Date(`${date}T${time}`).toISOString(),
        weight,
        weightUnit: unit,
        bodyFatPct: optional(bodyFat),
        muscleKg: massInKg(muscle, unit),
        waterPct: optional(water),
        boneKg: massInKg(bone, unit),
        visceralFat: optional(visceral),
        waist: optional(waist),
        waistUnit,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["measurements"] });
      navigate("/");
    },
    onError: (e) => setError(te(e)),
  });

  const hint = [latest ? tf("add.last", { weight: f.weight(latest.weightKg, unit), when: f.dateTime(latest.measuredAt) }) : null, t("add.commaHint")]
    .filter(Boolean)
    .join(" · ");

  return (
    <form
      id="add-weigh-in"
      className="flex flex-col gap-4.5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div className="flex justify-center">
        <WeightUnitToggle
          unit={unit}
          onChange={(u) => {
            // Everything already typed moves to the new unit, so nothing is saved in the wrong one.
            setWeight(convertWeight(weight, unit, u));
            setMuscle(convertWeight(muscle, unit, u));
            setBone(convertWeight(bone, unit, u));
            setUnit(u);
          }}
        />
      </div>
      <ValueDial id="add-weight" label={t("weight")} value={weight} onChange={setWeight} unit={unit} step={0.1} digits={1} hint={hint} />
      {/* Fixed shares: an "auto" column grows to iOS Safari's wide native time input and overflows. */}
      <div className="grid grid-cols-2 gap-2.5">
        <DatePicker label={t("measuredAt")} value={date} onChange={setDate} maxDate={new Date()} required />
        <Field label={t("time")} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
      </div>
      <section className="rounded-3xl border border-line bg-surface p-4">
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <span className="flex flex-col">
            <span className="text-[15px] font-extrabold">{t("add.scaleTitle")}</span>
            <span className="text-xs font-semibold text-muted">{t("add.scaleHint")}</span>
          </span>
          <FiChevronDown size={20} strokeWidth={2.4} className={`shrink-0 text-muted transition ${more ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {more && (
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <Field label={`${t("bodyFat")} (%)`} inputMode="decimal" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} />
            <Field label={`${t("muscle")} (${unit})`} inputMode="decimal" value={muscle} onChange={(e) => setMuscle(e.target.value)} />
            <Field label={`${t("water")} (%)`} inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} />
            <Field label={`${t("bone")} (${unit})`} inputMode="decimal" value={bone} onChange={(e) => setBone(e.target.value)} />
            <Field label={t("visceral")} inputMode="decimal" value={visceral} onChange={(e) => setVisceral(e.target.value)} />
            <div className="col-span-2 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={`${t("waist")} (${waistUnit})`} inputMode="decimal" value={waist} onChange={(e) => setWaist(e.target.value)} />
              </div>
              <div className="pb-1.5">
                <WaistUnitToggle
                  unit={waistUnit}
                  onChange={(u) => {
                    setWaist(convertWaist(waist, waistUnit, u));
                    setWaistUnit(u);
                  }}
                />
              </div>
            </div>
            <p className="col-span-2 text-[13px] font-semibold text-muted">{t("waistHowTo")}</p>
          </div>
        )}
      </section>
      <ErrorText text={error} />
      <SaveBar form="add-weigh-in" label={t("add.saveWeighIn")} disabled={save.isPending} />
    </form>
  );
}

/** Adds the waist to the latest weigh-in, the same as the pencil on a weigh-in's detail. */
function WaistForm({ profile }: { profile: ProfileDto }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const measurements = useMeasurements().data ?? [];
  const latest = measurements[0];
  const [unit, setUnit] = useWaistUnit(profile.unit);
  const lastWaist = measurements.find((m) => m.waistCm !== null)?.waistCm ?? null;
  const [value, setValue] = useState(() => (lastWaist === null ? "" : (unit === "in" ? lastWaist / CM_PER_IN : lastWaist).toFixed(1)));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.setWaist(latest!.id, value, unit),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["measurements"] });
      navigate("/");
    },
    onError: (e) => setError(te(e)),
  });

  if (!latest) {
    return <p className="rounded-3xl border border-line bg-surface p-5 text-[15px] font-semibold text-ink-2">{t("add.waistNeedsWeighIn")}</p>;
  }
  return (
    <form
      id="add-waist"
      className="flex flex-col gap-4.5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div className="flex justify-center">
        <WaistUnitToggle
          unit={unit}
          onChange={(u) => {
            setValue(convertWaist(value, unit, u));
            setUnit(u);
          }}
        />
      </div>
      <ValueDial
        id="add-waist-value"
        label={t("waist")}
        value={value}
        onChange={setValue}
        unit={unit}
        step={0.5}
        digits={1}
        hint={tf("add.waistGoesTo", { when: f.dateTime(latest.measuredAt), weight: f.weight(latest.weightKg, profile.unit) })}
      />
      <p className="px-1 text-[13px] leading-4.75 font-semibold text-muted">{t("waistHowTo")}</p>
      <ErrorText text={error} />
      <SaveBar form="add-waist" label={t("add.saveWaist")} disabled={save.isPending || !(readNumber(value) > 0)} />
    </form>
  );
}

/**
 * A note on the latest weigh-in (late dinner, a hard workout...), so a jump in the chart has a
 * reason next to it. It shows on the weigh-in's detail and in the list of weigh-ins.
 */
function NoteForm({ profile }: { profile: ProfileDto }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const latest = (useMeasurements().data ?? [])[0];
  const [value, setValue] = useState(() => latest?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.setNote(latest!.id, value.trim() || null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["measurements"] });
      navigate(`/medicion/${latest!.id}`);
    },
    onError: (e) => setError(te(e)),
  });

  if (!latest) {
    return <p className="rounded-3xl border border-line bg-surface p-5 text-[15px] font-semibold text-ink-2">{t("add.noteNeedsWeighIn")}</p>;
  }
  return (
    <form
      id="add-note"
      className="flex flex-col gap-4.5"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <section className="flex flex-col gap-2 rounded-[28px] border border-line bg-surface p-5 shadow-card">
        <label htmlFor={id} className="text-sm font-bold text-ink-2">
          {t("add.noteLabel")}
        </label>
        <textarea
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, NOTE_MAX_LENGTH))}
          maxLength={NOTE_MAX_LENGTH}
          rows={5}
          placeholder={t("add.notePlaceholder")}
          className="w-full resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 font-semibold text-ink outline-none placeholder:font-medium placeholder:text-muted focus:border-2 focus:border-brand"
        />
        <div className="flex justify-between gap-3 text-[13px] font-semibold text-muted">
          <span>{tf("add.noteGoesTo", { when: f.dateTime(latest.measuredAt), weight: f.weight(latest.weightKg, profile.unit) })}</span>
          <span className="shrink-0">{tf("add.noteCount", { n: value.length, max: NOTE_MAX_LENGTH })}</span>
        </div>
      </section>
      <p className="px-1 text-[13px] leading-4.75 font-semibold text-muted">{tf("add.noteHelp", { max: NOTE_MAX_LENGTH })}</p>
      <ErrorText text={error} />
      <SaveBar form="add-note" label={t("add.saveNote")} disabled={save.isPending} />
    </form>
  );
}

export function AddPage({ profile }: { profile: ProfileDto }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"weighIn" | "waist" | "note">("weighIn");
  return (
    <div className="flex flex-col gap-4.5 pb-28">
      <div className="flex items-center justify-between">
        <Link
          to="/"
          aria-label={t("close")}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-ink transition active:scale-95"
        >
          <FiX size={20} strokeWidth={2.4} aria-hidden />
        </Link>
        <h1 className="text-[17px] font-extrabold">{t("nav.add")}</h1>
        <span className="w-11" aria-hidden />
      </div>
      <Segmented
        label={t("add.what")}
        value={kind}
        onChange={setKind}
        options={[
          { value: "weighIn", label: t("add.tabWeighIn") },
          { value: "waist", label: t("waist") },
          { value: "note", label: t("add.tabNote") },
        ]}
      />
      {kind === "weighIn" ? <WeighInForm profile={profile} /> : kind === "waist" ? <WaistForm profile={profile} /> : <NoteForm profile={profile} />}
    </div>
  );
}
