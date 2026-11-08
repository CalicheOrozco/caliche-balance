import type { ReactNode } from "react";
import { FiChevronRight, FiDownload, FiTrendingUp } from "react-icons/fi";
import { Link } from "react-router";
import { metabolicAge } from "../../shared/bodyAge.ts";
import { bodyFatOf, compositionOf } from "../../shared/composition.ts";
import { toCsv } from "../../shared/csv.ts";
import { scoreOf } from "../../shared/score.ts";
import { ageAt, type Band, healthyWeightRange, type Status } from "../../shared/reference.ts";
import { type ReadingReport, type ReportItem, readingReport } from "../../shared/report.ts";
import { CM_PER_IN, fromKilograms, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Avatar, Callout, Card, IconButton, PageHeader, Rings, SectionHeader, STATUS_SOFT, TabPills, useFormat } from "../ui.tsx";

const DAY = 24 * 60 * 60 * 1000;

/** A weigh-in with body composition (bare feet), not just weight. */
export function isFull(m: MeasurementDto): boolean {
  return m.bodyFatPct !== null || m.impedance !== null;
}

/** "hoy 7:02", "ayer 21:10" or "4 nov, 7:02". */
export function useWhen() {
  const { tf } = useI18n();
  const f = useFormat();
  return (iso: string) => {
    const at = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today.getTime() - DAY);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(at, today)) return tf("body.todayAt", { time: f.time(iso) });
    if (same(at, yesterday)) return tf("body.yesterdayAt", { time: f.time(iso) });
    return f.dateTime(iso);
  };
}

/** "142 pesadas desde el 14 de marzo": the subtitle of Trends and Weigh-ins. */
export function useCountSince(measurements: MeasurementDto[]): string | null {
  const { tf, locale } = useI18n();
  const first = measurements[measurements.length - 1];
  if (!first) return null;
  const date = new Date(first.measuredAt);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return tf("body.countSince", {
    n: measurements.length,
    date: date.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" }),
  });
}

/** The header and the Summary / Trends / Weigh-ins pills shared by the three Body tabs. */
export function BodyTop({ subtitle, children }: { subtitle?: ReactNode; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("nav.body")} subtitle={subtitle}>
        {children}
        <Avatar to="/yo" />
      </PageHeader>
      <TabPills
        label={t("body.views")}
        tabs={[
          { to: "/cuerpo", label: t("body.tabSummary") },
          { to: "/cuerpo/tendencias", label: t("body.tabTrends") },
          { to: "/cuerpo/pesadas", label: t("body.tabWeighIns") },
        ]}
      />
    </>
  );
}

/**
 * Downloads every weigh-in as a CSV file for a spreadsheet: our North American recalculation
 * next to Xiaomi's own values, the waist and the note. Built on the phone, so it works offline.
 */
export function ExportButton({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf } = useI18n();
  const round = (n: number | null | undefined, digits = 1) => (n == null ? null : Number(n.toFixed(digits)));
  const pad = (n: number) => String(n).padStart(2, "0");
  const download = () => {
    const header = [
      t("body.csv.date"),
      t("body.csv.time"),
      tf("body.csv.weight", { unit: profile.unit }),
      t("body.csv.fat"),
      t("body.csv.fatMass"),
      t("body.csv.muscle"),
      t("body.csv.water"),
      t("body.csv.bmr"),
      t("body.csv.score"),
      t("body.csv.xiaomiFat"),
      t("body.csv.xiaomiMuscle"),
      t("body.csv.xiaomiWater"),
      t("body.csv.bone"),
      t("body.csv.visceral"),
      t("body.csv.impedance"),
      t("body.csv.waist"),
      t("body.csv.source"),
      t("body.csv.note"),
    ];
    // Oldest first, the way a spreadsheet chart reads.
    const rows = [...measurements].reverse().map((m) => {
      const d = new Date(m.measuredAt);
      const comp = compositionOf(profile, m);
      const fat = bodyFatOf(profile, m);
      const full = isFull(m);
      return [
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        round(fromKilograms(m.weightKg, profile.unit)),
        full ? round(fat?.value) : null,
        comp ? round(comp.fatMassKg) : null,
        comp ? round(comp.skeletalMuscleKg) : null,
        comp ? round(comp.bodyWaterPct) : null,
        comp ? round(comp.bmrKcal, 0) : null,
        full ? scoreOf(profile, m).score : null,
        m.bodyFatPct,
        m.muscleKg,
        m.waterPct,
        m.boneKg,
        m.visceralFat,
        m.impedance,
        m.waistCm,
        m.source,
        m.note ?? null,
      ];
    });
    const blob = new Blob([toCsv([header, ...rows])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date();
    a.href = url;
    a.download = `${t("body.csvFile")}-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <IconButton label={t("body.export")} onClick={download} disabled={measurements.length === 0}>
      <FiDownload size={20} strokeWidth={2} aria-hidden />
    </IconButton>
  );
}

/** How to show one rated measure: its value, unit and a one-line hint about its range. */
export function useItemText(profile: ProfileDto) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const waistUnit = profile.unit === "lb" ? "in" : "cm";
  const healthy = healthyWeightRange(profile.heightCm);
  return (item: ReportItem, report: ReadingReport) => {
    const label = t(`reportItem.${item.key}` as MessageKey);
    if (item.key === "bodyFat") {
      return {
        label,
        value: f.number(item.value),
        unit: "%",
        hint: tf("body.hintFat", { min: f.number(report.fatRange.min, 0), max: f.number(report.fatRange.max, 0) }),
      };
    }
    if (item.key === "bmi") {
      return {
        label,
        value: f.number(item.value),
        unit: "",
        hint: tf("body.hintBmi", { min: f.weight(healthy.min, profile.unit), max: f.weight(healthy.max, profile.unit) }),
      };
    }
    if (item.key === "muscleIndex") {
      return { label, value: f.number(item.value), unit: "kg/m²", hint: t("body.hintMuscleIndex") };
    }
    const cm = report.waist?.cm ?? 0;
    return {
      label,
      value: f.number(item.value, 2),
      unit: "",
      hint: tf("body.hintWaist", { waist: waistUnit === "in" ? `${f.number(cm / CM_PER_IN)} in` : `${f.number(cm, 0)} cm` }),
    };
  };
}

const MARK: Record<Status, string> = { good: "border-brand", warn: "border-warn", bad: "border-bad" };

/** The thin scale under a row of "Your measures": the healthy band in green and a marker at the value. */
function MiniScale({ value, bands, status }: { value: number; bands: Band[]; status: Status }) {
  const edges = bands.flatMap((b) => [b.min, b.max]).filter((n): n is number => n !== null);
  const span = Math.max(...edges) - Math.min(...edges);
  const pad = span / Math.max(bands.length - 2, 1);
  const lo = Math.min(...edges) - pad;
  const hi = Math.max(...edges) + pad;
  const pct = (n: number) => ((Math.min(Math.max(n, lo), hi) - lo) / (hi - lo)) * 100;
  return (
    <div className="relative h-3" aria-hidden>
      <div className="absolute inset-x-0 top-1 flex h-1 gap-0.75">
        {bands.map((b) => (
          <span key={b.key} className={`rounded-full ${b.status === "good" ? "bg-good-band" : "bg-track"}`} style={{ width: `${pct(b.max ?? hi) - pct(b.min ?? lo)}%` }} />
        ))}
      </div>
      <span className={`absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full border-[3px] bg-surface ${MARK[status]}`} style={{ left: `${pct(value)}%` }} />
    </div>
  );
}

/** One row of "Your measures". A null status is a reference value with no published range. */
function MeasureRow({
  to,
  label,
  value,
  unit,
  pill,
  status,
  scale,
  hint,
}: {
  to: string;
  label: string;
  value: string;
  unit: string;
  pill: string;
  status: Status | null;
  scale?: ReactNode;
  hint: string;
}) {
  return (
    <Link to={to} className="flex flex-col gap-2 border-t border-line px-4 py-3.5 text-ink first:border-t-0">
      <div className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1 text-[15px] font-bold">{label}</span>
        <span className="text-base font-extrabold whitespace-nowrap">
          {value}
          {unit && <span className="text-xs font-bold text-muted"> {unit}</span>}
        </span>
        <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] font-extrabold ${status ? STATUS_SOFT[status] : "bg-surface-2 text-ink-2"}`}>{pill}</span>
      </div>
      {scale}
      <span className="text-xs font-semibold text-muted">{hint}</span>
    </Link>
  );
}

/** What the weight is made of, and how fat and muscle moved over about three months. */
function CompositionCard({ profile, reading, measurements }: { profile: ProfileDto; reading: MeasurementDto; measurements: MeasurementDto[] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const unit = profile.unit;
  const mass = (kg: number) => `${f.number(fromKilograms(kg, unit))} ${unit}`;
  const comp = compositionOf(profile, reading);
  const fat = bodyFatOf(profile, reading);
  if (!fat) return null;
  const fatKg = (reading.weightKg * fat.value) / 100;
  const muscleKg = comp?.skeletalMuscleKg ?? null;
  const otherKg = reading.weightKg - fatKg - (muscleKg ?? 0);
  const parts = [
    { key: "fat", kg: fatKg, color: "bg-warn", label: t("body.partFat"), sub: `${f.number(fat.value)} %` },
    ...(muscleKg !== null ? [{ key: "muscle", kg: muscleKg, color: "bg-brand", label: t("body.partMuscle"), sub: t("body.partMuscleSub") }] : []),
    {
      key: "other",
      kg: otherKg,
      color: "bg-good-band",
      label: muscleKg !== null ? t("body.partOther") : t("body.partLean"),
      sub: muscleKg !== null ? t("body.partOtherSub") : t("body.partLeanSub"),
    },
  ];

  // The newest full weigh-in about three months before this one (at least six weeks back).
  const at = new Date(reading.measuredAt).getTime();
  const earlier = measurements
    .filter((m) => isFull(m) && compositionOf(profile, m) && at - new Date(m.measuredAt).getTime() >= 42 * DAY)
    .sort((a, b) => Math.abs(at - new Date(a.measuredAt).getTime() - 90 * DAY) - Math.abs(at - new Date(b.measuredAt).getTime() - 90 * DAY))[0];
  const before = earlier ? compositionOf(profile, earlier) : null;
  let recomposition: string | null = null;
  if (comp && before && earlier) {
    const months = Math.max(1, Math.round((at - new Date(earlier.measuredAt).getTime()) / (30 * DAY)));
    const period = months === 1 ? t("body.oneMonth") : tf("body.nMonths", { n: months });
    const fatDelta = comp.fatMassKg - before.fatMassKg;
    const muscleDelta = comp.skeletalMuscleKg - before.skeletalMuscleKg;
    const abs = (kg: number) => mass(Math.abs(kg));
    recomposition =
      fatDelta < -0.05 && muscleDelta > 0.05
        ? tf("body.recomp", { period, fat: abs(fatDelta), muscle: abs(muscleDelta) })
        : tf("body.compChange", {
            period,
            fat: `${fatDelta < 0 ? "−" : "+"}${abs(fatDelta)}`,
            muscle: `${muscleDelta < 0 ? "−" : "+"}${abs(muscleDelta)}`,
          });
  }

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-bold text-ink-2">{t("body.madeOf")}</p>
        <span className="text-[15px] font-extrabold">{mass(reading.weightKg)}</span>
      </div>
      <div role="img" aria-label={parts.map((p) => `${p.label} ${mass(p.kg)}`).join(", ")} className="flex h-11 gap-1">
        {parts.map((p, i) => (
          <span
            key={p.key}
            className={`${p.color} ${i === 0 ? "rounded-l-xl rounded-r-sm" : i === parts.length - 1 ? "rounded-l-sm rounded-r-xl" : "rounded-sm"}`}
            style={{ flex: Math.max(p.kg, 0) }}
          />
        ))}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0, 1fr))` }}>
        {parts.map((p) => (
          <div key={p.key} className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-2">
              <span className={`h-2 w-2 rounded-[3px] ${p.color}`} />
              {p.label}
            </span>
            <span className="text-lg font-extrabold">{mass(p.kg)}</span>
            <span className="text-xs font-semibold text-muted">{p.sub}</span>
          </div>
        ))}
      </div>
      {recomposition && <Callout icon={FiTrendingUp}>{recomposition}</Callout>}
    </Card>
  );
}

/** The Caliche score with its three parts. */
function ScoreCard({ report, reading }: { report: ReadingReport; reading: MeasurementDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const score = report.score;
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-center gap-4">
        <Rings rings={[{ fraction: score.score / 100, className: "stroke-brand" }]} size={88} stroke={9}>
          <span className="text-[26px] font-extrabold">{score.score}</span>
        </Rings>
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-extrabold">{t("bodyScoreTitle")}</p>
          <p className="text-[13px] font-semibold text-ink-2">
            {reading.bodyScore !== null ? tf("body.scoreXiaomi", { score: f.number(reading.bodyScore, 0) }) : t("body.scoreOurs")}
          </p>
        </div>
      </div>
      {score.parts.map((p) => {
        const max = Math.round(p.weight * 100);
        const got = Math.round(p.score * p.weight);
        return (
          <div key={p.part} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[13px] font-bold">
              <span className="text-ink-2">
                {t(`scorePart.${p.part}` as MessageKey)} <span className="text-muted">· {max} %</span>
              </span>
              <span>
                {got} <span className="text-muted">/ {max}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-track">
              <div className="h-full rounded-full bg-brand" style={{ width: `${(got / (max || 1)) * 100}%` }} />
            </div>
          </div>
        );
      })}
      {score.parts.length === 1 && <p className="text-[13px] font-semibold text-muted">{t("bodyScoreNoImpedance")}</p>}
    </Card>
  );
}

export function BodyPage({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const when = useWhen();
  const itemText = useItemText(profile);
  const reading = measurements.find(isFull) ?? measurements[0];

  if (!reading) {
    return (
      <div className="flex flex-col gap-3.5">
        <BodyTop />
        <Card className="text-center">
          <h2 className="text-lg font-extrabold">{t("noMeasurements")}</h2>
          <p className="mt-2 text-sm font-semibold text-ink-2">{t("noMeasurementsBody")}</p>
          <Link to="/agregar" className="mt-4 flex min-h-12 items-center justify-center rounded-2xl bg-brand px-4 font-extrabold text-brand-ink">
            {t("addManually")}
          </Link>
        </Card>
      </div>
    );
  }

  const report = readingReport(profile, reading, measurements);
  const comp = report.composition;
  const to = `/medicion/${reading.id}`;
  const watch = report.items.filter((i) => i.band.status !== "good").length;
  const realAge = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date());
  const fatAge = report.bodyFat ? metabolicAge({ fatPct: report.bodyFat.value, weightKg: reading.weightKg, age: report.age, sex: profile.sex }) : null;
  const fatAgeText = fatAge
    ? fatAge.kind === "over"
      ? tf("bodyAgeOver", { age: fatAge.age })
      : fatAge.kind === "under"
        ? tf("bodyAgeUnder", { age: fatAge.age })
        : tf("bodyAgeYears", { age: fatAge.age })
    : null;
  const unit = profile.unit;

  const rows = report.items.map((item) => {
    const text = itemText(item, report);
    // Skeletal muscle reads better in kg; its status comes from the muscle index.
    const muscle = item.key === "muscleIndex" && comp;
    return (
      <MeasureRow
        key={item.key}
        to={to}
        label={muscle ? t("skeletalMuscle") : text.label}
        value={muscle ? f.number(fromKilograms(comp.skeletalMuscleKg, unit)) : text.value}
        unit={muscle ? unit : text.unit}
        pill={t(`band.${item.band.key}` as MessageKey)}
        status={item.band.status}
        scale={<MiniScale value={item.value} bands={item.bands} status={item.band.status} />}
        hint={muscle ? tf("body.hintMuscle", { index: f.number(item.value) }) : text.hint}
      />
    );
  });
  const reference = comp
    ? [
        { key: "water", label: t("bodyWater"), value: f.number(comp.bodyWaterPct), unit: "%", pill: t("body.reference"), hint: t("body.hintWater") },
        { key: "ffm", label: t("fatFreeMass"), value: f.number(fromKilograms(comp.fatFreeMassKg, unit)), unit, pill: t("body.reference"), hint: t("body.hintFfm") },
        { key: "bmr", label: t("bmr"), value: f.number(comp.bmrKcal, 0), unit: "kcal", pill: t("body.reference"), hint: t("body.hintBmr") },
        ...(comp.proteinPct !== null
          ? [{ key: "protein", label: t("body.protein"), value: f.number(comp.proteinPct), unit: "%", pill: t("body.experimental"), hint: t("body.hintProtein") }]
          : []),
      ]
    : [];

  return (
    <div className="flex flex-col gap-3.5">
      <BodyTop subtitle={tf(isFull(reading) ? "body.lastFull" : "body.lastWeighIn", { when: when(reading.measuredAt) })} />

      <CompositionCard profile={profile} reading={reading} measurements={measurements} />
      <ScoreCard report={report} reading={reading} />

      <SectionHeader title={t("body.yourMeasures")} aside={watch > 0 ? tf("body.toWatch", { n: watch }) : t("body.allInRange")} />
      <Card padded={false}>
        {rows}
        {reference.map((r) => (
          <MeasureRow key={r.key} to={to} label={r.label} value={r.value} unit={r.unit} pill={r.pill} status={null} hint={r.hint} />
        ))}
        {!report.waist && (
          <Link to="/agregar" className="flex min-h-16 items-center gap-3 border-t border-line px-4 py-3 text-ink">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-bold">{t("reportItem.waist")}</span>
              <span className="text-xs font-semibold text-muted">{t("body.waistWhy")}</span>
            </span>
            <span className="inline-flex h-8.5 shrink-0 items-center rounded-full bg-brand px-3.5 text-[13px] font-extrabold text-brand-ink">{t("body.measure")}</span>
          </Link>
        )}
      </Card>

      {fatAge && fatAgeText && (
        <Link to="/yo" className="flex items-center gap-3.5 rounded-3xl border border-line bg-surface p-4 text-ink shadow-card">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[17px] font-extrabold ${fatAge.age > realAge ? "bg-warn-soft text-warn-text" : "bg-good-soft text-good-text"}`}
          >
            {fatAge.age}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-extrabold">{tf("body.fatAgeTitle", { value: fatAgeText })}</span>
            <span className="text-[13px] font-semibold text-muted">{tf("body.fatAgeSub", { age: realAge })}</span>
          </span>
          <FiChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
        </Link>
      )}
    </div>
  );
}
