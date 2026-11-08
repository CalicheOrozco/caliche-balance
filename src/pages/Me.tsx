import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiBarChart2, FiCalendar, FiChevronDown, FiClock, FiDroplet, FiMoon, FiPieChart, FiTarget, FiTrendingDown } from "react-icons/fi";
import { Link } from "react-router";
import { type AgeGroup, type BodyFatAge, metabolicAge } from "../../shared/bodyAge.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { lossPlan, SAFE_LOSS_KG_PER_WEEK } from "../../shared/fatLoss.ts";
import { bmiPercentile, type PercentileResult } from "../../shared/percentiles.ts";
import { ageAt, assess, basalMetabolicRate, bmi, bodyFatBands, healthyWeightRange, type SourceId } from "../../shared/reference.ts";
import { CM_PER_IN, fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { scoreOf } from "../../shared/score.ts";
import { assessWaist, WHTR_BANDS } from "../../shared/waist.ts";
import { api, useMe } from "../api.ts";
import { useCompareXiaomi } from "../compare.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Avatar, BackLink, Button, Callout, Card, Field, Progress, RangeBar, Rings, SectionHeader, StatusBadge, signed, useFormat } from "../ui.tsx";

const TIPS: { key: string; Icon: IconType }[] = [
  { key: "calories", Icon: FiBarChart2 },
  { key: "protein", Icon: FiTarget },
  { key: "plate", Icon: FiPieChart },
  { key: "drinks", Icon: FiDroplet },
  { key: "strength", Icon: FiActivity },
  { key: "move", Icon: FiClock },
  { key: "sleep", Icon: FiMoon },
  { key: "weigh", Icon: FiCalendar },
];

/** How many tip cards show before "See all". */
const TIPS_SHOWN = 3;

const birthOf = (profile: ProfileDto) => new Date(`${profile.birthDate}T00:00:00Z`);

/** A card's small gray title over its headline, as in every card of the profile. */
function CardTitle({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-bold text-ink-2">{children}</p>;
}

/** "1.80 m", or "5 ft 11 in" for people who weigh in pounds. */
function useHeightText() {
  const { tf } = useI18n();
  const f = useFormat();
  return (profile: ProfileDto) => {
    if (profile.unit === "kg") return `${f.number(profile.heightCm / 100, 2)} m`;
    const inches = Math.round(profile.heightCm / CM_PER_IN);
    return tf("me.heightFtIn", { ft: Math.floor(inches / 12), in: inches % 12 });
  };
}

/** Avatar, name, the profile facts and three chips about the whole history. */
function Identity({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const heightText = useHeightText();
  const me = useMe().data?.username ?? "";
  const age = ageAt(birthOf(profile), new Date());
  const latest = measurements[0];
  const first = measurements[measurements.length - 1];
  const change = latest && first && latest !== first ? fromKilograms(latest.weightKg, profile.unit) - fromKilograms(first.weightKg, profile.unit) : null;
  // A loss is shown in green only while it moves toward the healthy range.
  const goodChange = change !== null && change < 0 && latest!.weightKg > healthyWeightRange(profile.heightCm).min;
  const chip = "inline-flex h-7.5 items-center rounded-full px-3 text-xs";
  return (
    <div className="flex flex-col items-center gap-2 pt-1 pb-2 text-center">
      <Avatar size={88} />
      <h1 className="text-[26px] font-extrabold tracking-[-0.02em]">{profile.displayName ?? me}</h1>
      <p className="text-sm font-semibold text-ink-2">
        {t(`sex.${profile.sex}` as MessageKey)} · {tf("me.years", { n: age })} · {heightText(profile)}
      </p>
      {first && (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <span className={`${chip} border border-line bg-surface font-bold text-ink-2`}>{tf("me.weighIns", { n: measurements.length.toLocaleString(locale) })}</span>
          <span className={`${chip} border border-line bg-surface font-bold text-ink-2`}>
            {tf("me.since", { when: new Date(first.measuredAt).toLocaleDateString(locale, { month: "long", year: "numeric" }) })}
          </span>
          {change !== null && (
            <span className={`${chip} font-extrabold ${goodChange ? "bg-brand-soft text-brand-text" : "border border-line bg-surface text-ink-2"}`}>
              {signed(change, (n) => `${f.number(n)} ${profile.unit}`)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** "44 años", "65 años o más" or "menos de 20 años". */
function useAgeText() {
  const { tf } = useI18n();
  return (r: BodyFatAge) =>
    r.kind === "over" ? tf("bodyAgeOver", { age: r.age }) : r.kind === "under" ? tf("bodyAgeUnder", { age: r.age }) : tf("bodyAgeYears", { age: r.age });
}

/** Age at which the typical North American of the same sex has this body fat (NHANES DXA medians). */
function BodyAgeCard({ profile, reading }: { profile: ProfileDto; reading: MeasurementDto }) {
  const { t, tf } = useI18n();
  const ageText = useAgeText();
  const [compare] = useCompareXiaomi();
  const fat = bodyFatOf(profile, reading);
  if (!fat) return null;
  const age = ageAt(birthOf(profile), new Date(reading.measuredAt));
  const groups: Record<AgeGroup, BodyFatAge> = {
    "mexican-american": metabolicAge({ fatPct: fat.value, weightKg: reading.weightKg, age, sex: profile.sex, group: "mexican-american" }),
    white: metabolicAge({ fatPct: fat.value, weightKg: reading.weightKg, age, sex: profile.sex, group: "white" }),
  };
  const main = groups["mexican-american"];
  const diff = main.age - age;
  const older = main.kind !== "under" && diff > 0;
  const versus =
    main.kind === "age" ? (diff > 0 ? tf("me.ageMore", { n: diff }) : diff < 0 ? tf("me.ageLess", { n: -diff }) : t("me.ageSame")) : null;
  // The scale runs over the adult ages of the reference tables.
  const lo = 20;
  const hi = Math.max(70, age + 5, main.age + 5);
  const pos = (n: number) => `${((Math.min(Math.max(n, lo), hi) - lo) / (hi - lo)) * 100}%`;
  const left = Math.min(age, main.age);
  const right = Math.max(age, main.age);
  const fatAt = (Math.min(Math.max(main.age, lo), hi) - lo) / (hi - lo);
  const fatEdge = fatAt < 0.18 ? "left" : fatAt > 0.82 ? "right" : null;
  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-0.5">
        <CardTitle>{t("bodyAgeTitle")}</CardTitle>
        <p className="text-[30px] leading-8.5 font-extrabold tracking-[-0.02em]">{ageText(main)}</p>
        <p className="text-[13px] font-semibold text-muted">
          {[versus, compare && reading.bodyAge !== null ? tf("me.ageXiaomi", { n: reading.bodyAge }) : null].filter(Boolean).join(" · ") ||
            t("bodyAgeIntro")}
        </p>
      </div>
      <div className="relative h-16" aria-hidden>
        <div className="absolute inset-x-0 top-6.5 h-2.5 rounded-full bg-track" />
        <div
          className={`absolute top-6.5 h-2.5 ${older ? "bg-warn-band" : "bg-good-band"}`}
          style={{ left: pos(left), width: `calc(${pos(right)} - ${pos(left)})` }}
        />
        <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5" style={{ left: pos(age) }}>
          <span className="text-[11px] font-extrabold whitespace-nowrap text-ink-2">{tf("me.ageYou", { n: age })}</span>
          <span className="h-4 w-1 rounded-sm bg-ink" />
        </div>
        <span
          className={`absolute top-5.25 h-5 w-5 -translate-x-1/2 rounded-full border-[5px] bg-surface ${older ? "border-warn" : "border-brand"}`}
          style={{ left: pos(main.age) }}
        />
        {/* Near either end the label is pinned to that end and takes the place of the end's number, so they never overlap. */}
        <span
          className={`absolute top-11 text-[11px] font-extrabold whitespace-nowrap ${fatEdge === "left" ? "left-0" : fatEdge === "right" ? "right-0" : "-translate-x-1/2"} ${older ? "text-warn-text" : "text-good-text"}`}
          style={fatEdge ? undefined : { left: pos(main.age) }}
        >
          {tf("me.ageFat", { n: main.age })}
        </span>
        {fatEdge !== "left" && <span className="absolute top-11 left-0 text-[11px] font-bold text-muted">{lo}</span>}
        {fatEdge !== "right" && <span className="absolute top-11 right-0 text-[11px] font-bold text-muted">{hi}</span>}
      </div>
      <p className="text-xs font-semibold text-muted">
        {tf("me.ageCompared", { mx: ageText(groups["mexican-american"]), white: ageText(groups.white) })} {t("bodyAgeNote")}
      </p>
    </Card>
  );
}

/** Where the person's BMI falls among US adults of the same sex and age (CDC NHANES tables). */
function PercentileCard({ profile, latest }: { profile: ProfileDto; latest: MeasurementDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const age = ageAt(birthOf(profile), new Date(latest.measuredAt));
  const value = bmi(latest.weightKg, profile.heightCm);
  const groups = (["us", "mexican-american"] as const).flatMap((g) => {
    const r = bmiPercentile(value, profile.sex, age, g);
    return r ? [r] : [];
  });
  const main = groups[0];
  if (!main) return null;
  const who = profile.sex === "male" ? t("percentileMale") : t("percentileFemale");
  const agesOf = (r: PercentileResult) =>
    r.ageTo === null ? tf("percentileAgesOver", { from: r.ageFrom }) : tf("percentileAges", { from: r.ageFrom, to: r.ageTo });
  const sentence =
    main.beyond === "above"
      ? tf("percentileAbove95", { who, ages: agesOf(main), bmi: f.number(value) })
      : main.beyond === "below"
        ? tf("percentileBelow5", { who, ages: agesOf(main), bmi: f.number(value) })
        : tf("percentileHigher", { n: Math.round(main.percentile), who, ages: agesOf(main), bmi: f.number(value) });
  const tile = (r: PercentileResult) =>
    r.beyond === "above" ? t("me.percentileOver95") : r.beyond === "below" ? t("me.percentileUnder5") : tf("me.percentile", { n: Math.round(r.percentile) });
  // Twenty bars of five people each: the filled ones have a lower BMI than yours.
  const mine = Math.min(Math.floor(main.percentile / 5), 19);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <CardTitle>{t("percentileTitle")}</CardTitle>
        <p className="text-base font-extrabold">{sentence}</p>
      </div>
      <div role="img" aria-label={tf("me.percentileBars", { n: Math.round(main.percentile) })} className="flex h-12 items-end gap-0.75">
        {Array.from({ length: 20 }, (_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t-[3px] ${i === mine ? "h-12 bg-brand" : i < mine ? "h-8 bg-good-band" : "h-8 bg-track"}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] font-bold text-muted">
        <span>{f.number(main.p5)}</span>
        <span>{tf("percentileMedian", { p50: f.number(main.p50) })}</span>
        <span>{f.number(main.p95)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {groups.map((r) => (
          <div key={r.group} className="flex flex-col rounded-2xl bg-surface-2 p-3">
            <span className="text-xs font-bold text-ink-2">{t(`percentileGroup.${r.group}` as MessageKey)}</span>
            <span className="text-[22px] font-extrabold">{tile(r)}</span>
          </div>
        ))}
      </div>
      <p className="text-xs font-semibold text-muted">
        {tf("me.percentileSource", { who: who.charAt(0).toUpperCase() + who.slice(1), ages: agesOf(main) })} {t("percentileNote")}
      </p>
    </Card>
  );
}

/** Waist-based visceral fat risk; the waist can be added to the latest weigh-in right here. */
function WaistCard({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const unit = profile.unit === "lb" ? "in" : "cm";
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const withWaist = measurements.find((m) => m.waistCm !== null);
  const latest = measurements[0]!;
  const save = useMutation({
    mutationFn: () => api.setWaist(latest.id, value, unit),
    onSuccess: () => {
      setValue("");
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ["measurements"] });
    },
  });
  const show = (cm: number) => (unit === "in" ? `${f.number(cm / CM_PER_IN)} in` : `${f.number(cm, 0)} cm`);
  const a = withWaist ? assessWaist(withWaist.waistCm!, profile.heightCm, profile.sex) : null;

  const form = (
    <form
      className="flex items-end gap-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex-1">
        <Field label={`${t("waist")} (${unit})`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required />
      </div>
      <Button type="submit" disabled={save.isPending} className="min-h-13.5">
        {t("save")}
      </Button>
    </form>
  );

  return (
    <Card className="flex flex-col gap-3">
      {a && withWaist ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <CardTitle>{t("waistTitle")}</CardTitle>
              <p className="text-[26px] leading-7.5 font-extrabold">
                {f.number(a.ratio, 2)} <span className="text-sm text-muted">· {show(a.waistCm)}</span>
              </p>
            </div>
            <StatusBadge band={a.band} />
          </div>
          <RangeBar classification={{ value: a.ratio, bands: WHTR_BANDS }} format={(n) => f.number(n, 1)} />
          <p className="text-[13px] font-semibold text-ink-2">
            {tf("waistFrom", { date: f.date(withWaist.measuredAt) })}{" "}
            {a.ratio >= 0.5 && tf("me.waistToLow", { amount: show(a.waistCm - profile.heightCm * 0.5) })}
          </p>
          <ul className="space-y-1 text-[13px] font-semibold text-ink-2">
            <li>
              {tf("waistUsCanada", { cutoff: show(a.usCanada.cutoffCm) })} <strong className="text-ink">{a.usCanada.above ? t("waistAbove") : t("waistBelow")}</strong>
            </li>
            <li>
              {tf("waistMexico", { cutoff: show(a.mexico.cutoffCm) })} <strong className="text-ink">{a.mexico.above ? t("waistAbove") : t("waistBelow")}</strong>
            </li>
          </ul>
          {editing ? (
            form
          ) : (
            <Button variant="secondary" className="w-full" onClick={() => setEditing(true)}>
              {t("me.measureAgain")}
            </Button>
          )}
        </>
      ) : (
        <>
          <CardTitle>{t("waistTitle")}</CardTitle>
          <p className="text-[15px] font-bold">{t("waistIntro")}</p>
          <p className="text-[13px] font-semibold text-ink-2">{t("waistHowTo")}</p>
          {form}
        </>
      )}
      {save.error && <p className="text-sm font-semibold text-bad-text">{te(save.error)}</p>}
      <p className="text-xs font-semibold text-muted">{t("waistSources")}</p>
    </Card>
  );
}

/** The same weigh-in computed by Caliche Balance and by Xiaomi, side by side. */
function ComparisonCard({ profile, reading }: { profile: ProfileDto; reading: MeasurementDto }) {
  const { t, locale } = useI18n();
  const f = useFormat();
  const na = compositionOf(profile, reading);
  if (!na) return null;
  const x = xiaomiComparable(reading);
  const unit = profile.unit;
  const fatAge = metabolicAge({ fatPct: na.bodyFatPct, weightKg: reading.weightKg, age: ageAt(birthOf(profile), new Date(reading.measuredAt)), sex: profile.sex });
  const rows: { label: string; c: string; x: string | null }[] = [
    { label: t("bodyFat"), c: `${f.number(na.bodyFatPct)} %`, x: x.bodyFatPct === null ? null : `${f.number(x.bodyFatPct)} %` },
    { label: t("fatFreeMass"), c: f.weight(na.fatFreeMassKg, unit), x: x.fatFreeMassKg === null ? null : f.weight(x.fatFreeMassKg, unit) },
    { label: t("bodyWater"), c: `${f.number(na.bodyWaterPct)} %`, x: x.bodyWaterPct === null ? null : `${f.number(x.bodyWaterPct)} %` },
    { label: t("bmr"), c: f.number(na.bmrKcal, 0), x: x.bmrKcal === null ? null : f.number(x.bmrKcal, 0) },
    { label: t("leanSoftMass"), c: f.weight(na.leanSoftKg, unit), x: x.muscleKg === null ? null : f.weight(x.muscleKg, unit) },
    ...(na.proteinPct === null
      ? []
      : [{ label: t("proteinExperimental"), c: `${f.number(na.proteinPct)} %`, x: x.proteinPct === null ? null : `${f.number(x.proteinPct)} %` }]),
    ...(reading.bodyAge === null ? [] : [{ label: t("me.age"), c: fatAge.kind === "over" ? `${fatAge.age}+` : fatAge.kind === "under" ? `<${fatAge.age}` : String(fatAge.age), x: f.number(reading.bodyAge, 0) }]),
  ];
  const grid = "grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2";
  return (
    <Card className="pt-1.5 pb-3.5">
      <p className="mt-3.5 mb-1 text-base font-extrabold">{t("compareTitle")}</p>
      <p className="text-xs font-semibold text-muted">
        {t("compareIntro")} {new Date(reading.measuredAt).toLocaleDateString(locale, { day: "numeric", month: "short" })}
      </p>
      <div className={`${grid} py-2 text-xs font-extrabold text-muted`}>
        <span />
        <span className="inline-flex items-center justify-end gap-1.5">
          <span className="h-0.75 w-2.5 rounded-sm bg-series" aria-hidden />
          Caliche
        </span>
        <span className="inline-flex items-center justify-end gap-1.5">
          <span className="h-0.75 w-2.5 rounded-sm bg-series-2" aria-hidden />
          Xiaomi
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className={`${grid} min-h-11 border-t border-line text-sm font-bold`}>
          <span className="text-ink-2">{r.label}</span>
          <span className="text-right font-extrabold">{r.c}</span>
          <span className="text-right text-ink-2">{r.x ?? "-"}</span>
        </div>
      ))}
      <p className="mt-2 text-xs font-semibold text-muted">{t("naCompositionNote")}</p>
    </Card>
  );
}

/** Shown when there is weight or body fat to lose: a personal plan, then general evidence-based tips. */
function Tips({ profile, measurements, goals }: { profile: ProfileDto; measurements: MeasurementDto[]; goals: GoalsDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const [all, setAll] = useState(false);
  const latest = measurements[0];
  if (!latest) return null;
  const comp = measurements.find((m) => m.bodyFatPct !== null || m.impedance !== null) ?? null;
  const age = ageAt(birthOf(profile), new Date(latest.measuredAt));
  const fat = comp ? bodyFatOf(profile, comp) : null;
  const fatMax = bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!.max!;
  const fatHigh = fat !== null && fat.value > fatMax;
  const plan = lossPlan(latest.weightKg, healthyWeightRange(profile.heightCm).max, goals.weight?.targetKg ?? null);
  if (!plan && !fatHigh) return null;
  const na = comp ? compositionOf(profile, comp) : null;
  const bmr = na ? na.bmrKcal : basalMetabolicRate(latest.weightKg, profile.heightCm, age, profile.sex);
  // 0.45 to 0.9 kg is 1 to 2 lb: shown exactly, since the weeks are computed from these values.
  const paceText = (kg: number) => `${f.number(fromKilograms(kg, profile.unit), profile.unit === "kg" ? 2 : 0)} ${profile.unit}`;
  const pace = { slow: paceText(SAFE_LOSS_KG_PER_WEEK.min), fast: paceText(SAFE_LOSS_KG_PER_WEEK.max) };
  const shown = all ? TIPS : TIPS.slice(0, TIPS_SHOWN);
  return (
    <>
      <SectionHeader title={t("tipsTitle")} />
      <Callout icon={FiTrendingDown} tone="brand">
        <p>
          {plan
            ? tf(`tipsPlan.${plan.target}`, {
                target: f.weight(plan.targetKg, profile.unit),
                amount: f.weight(plan.toLoseKg, profile.unit),
                ...pace,
                weeksFast: plan.weeksFast,
                weeksSlow: plan.weeksSlow,
              })
            : t("tipsFatOnly")}
        </p>
        {plan && <p className="mt-1.5 text-ink-2">{tf("tipsEnergy", { bmr: f.number(bmr, 0), slow: pace.slow })}</p>}
      </Callout>
      {shown.map(({ key, Icon }) => (
        <section key={key} className="flex items-start gap-3.5 rounded-[22px] border border-line bg-surface p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-brand-soft text-brand" aria-hidden>
            <Icon size={20} strokeWidth={2.2} />
          </span>
          <span className="flex flex-col gap-0.75">
            <span className="text-[15px] font-extrabold">{t(`tip.${key}.title` as MessageKey)}</span>
            <span className="text-[13px] leading-4.75 font-semibold text-ink-2">{t(`tip.${key}.body` as MessageKey)}</span>
          </span>
        </section>
      ))}
      {!all && (
        <button type="button" onClick={() => setAll(true)} className="min-h-11 self-center text-sm font-bold text-brand-text">
          {tf("tipsSeeAll", { n: TIPS.length })}
        </button>
      )}
      <p className="px-1 text-xs font-semibold text-muted">{t("tipsNote")}</p>
    </>
  );
}

/** Caliche Balance's own 0 to 100 score with every part visible. */
function ScoreBlock({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const [compare] = useCompareXiaomi();
  // The newest full weigh-in (with body fat) scores best; weight-only ones fall back to BMI alone.
  const scored = measurements.filter((m) => m.bodyFatPct !== null || m.impedance !== null);
  const latest = scored[0] ?? measurements[0];
  if (!latest) return null;
  const result = scoreOf(profile, latest);
  const previous = scored[1] ? scoreOf(profile, scored[1]).score : null;
  const delta = previous === null ? null : result.score - previous;
  const partFormat = (part: string, v: number) => (part === "bodyFat" ? `${f.number(v)} %` : part === "muscle" ? `${f.number(v)} kg/m²` : f.number(v));
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-4">
        <Rings rings={[{ fraction: result.score / 100, className: "stroke-brand" }]} size={88} stroke={9}>
          <span className="text-[26px] font-extrabold">{result.score}</span>
        </Rings>
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-extrabold">{t("bodyScoreTitle")}</p>
          {delta !== null && (
            <p className="text-[13px] font-semibold text-ink-2">
              {delta === 0 ? t("bodyScoreSame") : tf("bodyScoreDelta", { delta: signed(delta, (n) => f.number(n, 0)) })}
            </p>
          )}
          {compare && latest.bodyScore !== null && <p className="text-[13px] font-semibold text-ink-2">{tf("bodyScoreXiaomi", { score: f.number(latest.bodyScore, 0) })}</p>}
        </div>
      </div>
      {result.parts.map((p) => (
        <div key={p.part} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-3 text-[13px] font-bold">
            <span className="text-ink-2">
              {t(`scorePart.${p.part}` as MessageKey)} <span className="text-muted">· {partFormat(p.part, p.value)}</span>
            </span>
            <span>
              {Math.round(p.score)} <span className="text-muted">/ 100 · {tf("scorePartWeight", { weight: Math.round(p.weight * 100) })}</span>
            </span>
          </div>
          <Progress fraction={p.score / 100} height={8} />
        </div>
      ))}
      {result.parts.length === 1 && <p className="text-[13px] font-semibold text-ink-2">{t("bodyScoreNoImpedance")}</p>}
      <p className="text-xs font-semibold text-muted">
        {t("bodyScoreNote")}
        {latest !== measurements[0] && ` ${tf("bodyScoreFrom", { date: f.date(latest.measuredAt) })}`}
      </p>
      <Link to={`/medicion/${latest.id}`} className="flex min-h-12 items-center justify-center rounded-2xl bg-surface-2 text-[15px] font-bold text-ink">
        {t("seeDetail")}
      </Link>
    </div>
  );
}

/** A collapsible card for reference material: useful, but not something to read every day. */
function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-[28px] border border-line bg-surface p-5 shadow-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-base font-extrabold [&::-webkit-details-marker]:hidden">
        {title} <FiChevronDown size={20} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </details>
  );
}

/** One labeled value on a soft tile. */
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <dt className="text-xs font-bold text-ink-2">{label}</dt>
      <dd className="text-lg font-extrabold">{value}</dd>
    </div>
  );
}

/** Perfil: who you are and how you compare with North America, opened from the avatar. */
export function MePage({ profile, measurements, goals }: { profile: ProfileDto; measurements: MeasurementDto[]; goals: GoalsDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const [compare] = useCompareXiaomi();
  const latest = measurements[0];
  const top = (
    <BackLink to="/" label={t("nav.home")}>
      <Link to="/ajustes" className="inline-flex min-h-11 items-center pl-3 text-base font-bold text-brand-text">
        {t("me.edit")}
      </Link>
    </BackLink>
  );
  if (!latest) {
    return (
      <div className="flex flex-col gap-3.5">
        {top}
        <Identity profile={profile} measurements={measurements} />
        <Card>
          <p className="font-semibold text-ink-2">{t("noMeasurementsBody")}</p>
        </Card>
      </div>
    );
  }

  // Weigh-ins without bare feet only have weight; body composition comes from the newest full one.
  const comp = measurements.find((m) => m.bodyFatPct !== null || m.impedance !== null) ?? null;
  // Recalculated from impedance with North American equations; Xiaomi's value only as a fallback.
  const fat = comp ? bodyFatOf(profile, comp) : null;
  const na = comp ? compositionOf(profile, comp) : null;
  const result = assess(
    { sex: profile.sex, birthDate: birthOf(profile), heightCm: profile.heightCm },
    { measuredAt: new Date(latest.measuredAt), weightKg: latest.weightKg, bodyFatPct: fat?.value ?? null },
  );
  const sources: SourceId[] = ["who-bmi", ...(compare ? (["who-asian-bmi"] as const) : []), ...(na ? [] : (["mifflin-st-jeor"] as const))];
  if (result.bodyFat) sources.splice(1, 0, "gallagher-2000", "ace");
  if (na) sources.splice(1, 0, "jaffrin-2011", "sun-2003", "janssen", "mifflin-st-jeor");
  const v = (n: number | null | undefined) => n !== null && n !== undefined;
  const xiaomi = comp
    ? [
        v(comp.muscleKg) && { label: t("muscle"), value: f.weight(comp.muscleKg!, profile.unit) },
        v(comp.waterPct) && { label: t("water"), value: `${f.number(comp.waterPct!)} %` },
        v(comp.boneKg) && { label: t("bone"), value: f.weight(comp.boneKg!, profile.unit) },
        v(comp.visceralFat) && { label: t("visceral"), value: f.number(comp.visceralFat!, 0) },
        v(comp.proteinPct) && { label: t("protein"), value: `${f.number(comp.proteinPct!)} %` },
        v(comp.bmrKcal) && { label: t("bmrZepp"), value: `${f.number(comp.bmrKcal!, 0)} kcal` },
        v(comp.bodyAge) && { label: t("bodyAge"), value: f.number(comp.bodyAge!, 0) },
        v(comp.idealWeightKg) && { label: t("idealWeight"), value: f.weight(comp.idealWeightKg!, profile.unit) },
        v(comp.impedance) && { label: t("impedance"), value: `${f.number(comp.impedance!, 0)} Ω` },
      ].filter((x) => x !== false)
    : [];
  const compNote = comp && comp.id !== latest.id ? tf("compositionFrom", { date: f.date(comp.measuredAt) }) : null;

  return (
    <div className="flex flex-col gap-3.5">
      {top}
      <Identity profile={profile} measurements={measurements} />
      {compNote && <p className="px-1 text-[13px] font-semibold text-muted">{compNote}</p>}

      {comp && <BodyAgeCard profile={profile} reading={comp} />}
      <PercentileCard profile={profile} latest={latest} />
      <WaistCard profile={profile} measurements={measurements} />
      {comp && na && <ComparisonCard profile={profile} reading={comp} />}

      <Tips profile={profile} measurements={measurements} goals={goals} />

      <SectionHeader title={t("me.moreTitle")} />
      <Details title={t("me.compositionDetail")}>
        <ScoreBlock profile={profile} measurements={measurements} />
        {result.bodyFat && result.bodyFatAce && (
          <div className="flex flex-col gap-1 border-t border-line pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{t("bodyFat")}</CardTitle>
                <p className="text-[26px] font-extrabold">{f.number(result.bodyFat.value)} %</p>
              </div>
              <StatusBadge band={result.bodyFat.band} />
            </div>
            <p className="text-xs font-semibold text-muted">{fat?.source === "north-america" ? t("fatSourceNA") : t("fatSourceXiaomi")}</p>
            <RangeBar classification={result.bodyFat} format={(n) => `${f.number(n, 0)}%`} />
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink-2">
              {t("aceCategory")} <StatusBadge band={result.bodyFatAce.band} />
            </p>
            {compare && fat?.source === "north-america" && comp?.bodyFatPct != null && (
              <p className="text-[13px] font-semibold text-ink-2">
                {t("xiaomiSays")} <strong className="text-ink">{f.number(comp.bodyFatPct)} %</strong>
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1 border-t border-line pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{t("bmi")}</CardTitle>
              <p className="text-[26px] font-extrabold">{f.number(result.bmi.value)}</p>
            </div>
            <StatusBadge band={result.bmi.band} />
          </div>
          <RangeBar classification={result.bmi} format={(n) => f.number(n)} />
          {compare && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink-2">
              {t("asianComparison")} <StatusBadge band={result.bmiAsian.band} />
            </p>
          )}
        </div>
        {na && (
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <div>
              <p className="text-base font-extrabold">{t("naCompositionTitle")}</p>
              <p className="text-[13px] font-semibold text-ink-2">{t("naCompositionIntro")}</p>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <Tile label={t("fatFreeMass")} value={f.weight(na.fatFreeMassKg, profile.unit)} />
              <Tile label={t("fatMass")} value={f.weight(na.fatMassKg, profile.unit)} />
              <Tile label={t("bodyWater")} value={`${f.number(na.bodyWaterL)} L · ${f.number(na.bodyWaterPct, 0)} %`} />
              <Tile label={t("skeletalMuscle")} value={f.weight(na.skeletalMuscleKg, profile.unit)} />
              <Tile label={t("muscleIndex")} value={`${f.number(na.skeletalMuscleIndex)} kg/m²`} />
              <Tile label={t("leanSoftMass")} value={f.weight(na.leanSoftKg, profile.unit)} />
              {na.proteinKg !== null && na.proteinPct !== null && (
                <Tile label={t("proteinExperimental")} value={`${f.weight(na.proteinKg, profile.unit)} · ${f.number(na.proteinPct)} %`} />
              )}
            </dl>
            {na.muscleClass ? (
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink-2">
                {t("muscleIndex")}:{" "}
                <StatusBadge
                  band={{
                    key: na.muscleClass,
                    min: null,
                    max: null,
                    status: na.muscleClass === "normal" ? "good" : na.muscleClass === "low" ? "bad" : "warn",
                  }}
                />
              </p>
            ) : (
              <p className="text-xs font-semibold text-muted">{t("muscleIndexNote")}</p>
            )}
            <p className="text-xs font-semibold text-muted">{t("naCompositionNote")}</p>
            {na.proteinPct !== null && <p className="text-xs font-semibold text-muted">{t("proteinNote")}</p>}
          </div>
        )}
        <div className="flex flex-col gap-1 border-t border-line pt-5">
          <CardTitle>{t("bmr")}</CardTitle>
          <p className="text-[26px] font-extrabold">
            {f.number(na ? na.bmrKcal : result.bmrKcal, 0)} <span className="text-base font-bold text-muted">{t("kcalDay")}</span>
          </p>
          <p className="text-xs font-semibold text-muted">{na ? t("bmrSourceNA") : t("bmrSourceFormula")}</p>
          {compare && comp?.bmrKcal != null && (
            <p className="text-[13px] font-semibold text-ink-2">{tf("reportXiaomi", { value: `${f.number(comp.bmrKcal, 0)} kcal` })}</p>
          )}
        </div>
      </Details>

      <Details title={t("homeMoreInfo")}>
        {compare && xiaomi.length > 0 && (
          <div>
            <p className="text-base font-extrabold">{t("xiaomiValues")}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {xiaomi.map((x) => (
                <Tile key={x.label} label={x.label} value={x.value} />
              ))}
            </dl>
            <p className="mt-3 text-xs font-semibold text-muted">{t("xiaomiNote")}</p>
          </div>
        )}
        <div>
          <p className="text-base font-extrabold">{t("sources")}</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] font-semibold text-ink-2">
            {sources.map((s) => (
              <li key={s}>{t(`source.${s}` as MessageKey)}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs font-semibold text-muted">{t("disclaimer")}</p>
        </div>
      </Details>
    </div>
  );
}
