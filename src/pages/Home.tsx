import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import type { IconType } from "react-icons";
import { FiActivity, FiAward, FiBarChart2, FiCalendar, FiChevronRight, FiClock, FiDroplet, FiMoon, FiPieChart, FiTarget } from "react-icons/fi";
import { Link } from "react-router";
import { type BodyFatAge, bodyFatAge } from "../../shared/bodyAge.ts";
import { assessWaist, WHTR_BANDS } from "../../shared/waist.ts";
import { api, useAchievementsQuery } from "../api.ts";
import { ageAt, assess, basalMetabolicRate, bmi, bodyFatBands, healthyWeightRange, type SourceId } from "../../shared/reference.ts";
import { lossPlan, SAFE_LOSS_KG_PER_WEEK } from "../../shared/fatLoss.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { StreakCard, useNewLevels } from "../achievements.tsx";
import { useCompareXiaomi } from "../compare.ts";
import { bmiPercentile } from "../../shared/percentiles.ts";
import { scoreOf } from "../../shared/score.ts";
import {
  daysToReach,
  dailyTrend,
  estimateEta,
  goalProgress,
  maintainBands,
  maintainRange,
  maintainSide,
  nextBodyFatGoal,
  nextWeightGoal,
} from "../../shared/goals.ts";
import { CM_PER_IN, fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Button, Card, Field, RangeBar, StatusBadge, signed, useFormat } from "../ui.tsx";

/** "less than a day", "9 days" or "14 weeks": how long a goal took. */
function useTook() {
  const { tf, t } = useI18n();
  return (setAt: string, reachedAt: string) => {
    const days = daysToReach(new Date(setAt), new Date(reachedAt));
    return days === 0 ? t("tookLessThanDay") : days < 14 ? tf("tookDays", { n: days }) : tf("tookWeeks", { n: Math.round(days / 7) });
  };
}

/** One goal: progress bar, distance left, starting point and the estimate at the recent pace. */
function GoalRow({
  label,
  start,
  current,
  target,
  setAt,
  reachedAt,
  points,
  format,
  children,
}: {
  label: string;
  start: number | null;
  current: number;
  target: number;
  setAt: string;
  reachedAt: string | null;
  points: { time: number; value: number }[];
  format: (n: number) => string;
  /** What comes next once the goal is reached. */
  children?: ReactNode;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const took = useTook();
  const progress = goalProgress(start, current, target);
  const eta = estimateEta(progress, dailyTrend(points));
  // != also covers goals cached offline by a version that did not have reachedAt yet.
  const reached = progress.reached || reachedAt != null;
  const etaText =
    eta.kind === "weeks"
      ? tf("goalEtaWeeks", { n: eta.weeks })
      : eta.kind === "wrong-way"
        ? t("goalEtaWrongWay")
        : eta.kind === "unknown"
          ? t("goalEtaUnknown")
          : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{label}</p>
        <p className="text-sm text-ink-2">{tf("goalOf", { target: format(target) })}</p>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.fraction * 100)}
        className="mt-2 h-3 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(progress.fraction * 100, 2)}%` }} />
      </div>
      {reached && reachedAt ? (
        <p className="mt-2 flex items-center gap-2 text-lg font-bold text-good">
          <FiAward size={20} aria-hidden /> {tf("goalReachedOn", { date: f.date(reachedAt), took: took(setAt, reachedAt) })}
        </p>
      ) : (
        <p className="mt-2 text-lg font-bold">
          {progress.reached ? t("goalReached") : tf("goalRemaining", { value: format(progress.remaining) })}
          <span className="ml-2 text-sm font-medium text-muted">{Math.round(progress.fraction * 100)} %</span>
        </p>
      )}
      {start !== null && <p className="text-sm text-muted">{tf("goalFrom", { start: format(start), date: f.date(setAt) })}</p>}
      {!reached && etaText && <p className="mt-1 text-sm text-ink-2">{etaText}</p>}
      {reached && children}
    </div>
  );
}

/** A suggested next step after a goal: a button with a one-line reason. */
function NextStep({ label, hint, onClick, disabled }: { label: string; hint: string; onClick: () => void; disabled: boolean }) {
  return (
    <div>
      <Button variant="secondary" className="w-full" onClick={onClick} disabled={disabled}>
        {label}
      </Button>
      <p className="mt-1 px-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function MaintainRow({ maintain, currentKg, unit }: { maintain: NonNullable<GoalsDto["maintain"]>; currentKg: number; unit: ProfileDto["unit"] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const side = maintainSide(maintain, currentKg);
  const bands = maintainBands(maintain, (kg) => fromKilograms(kg, unit));
  const band = bands.find((b) => b.key === (side === "above" ? "maintain-above" : side === "below" ? "maintain-below" : "maintain-in"))!;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{t("maintainTitle")}</p>
          <p className="text-sm text-ink-2">
            {tf("maintainRange", { min: f.weight(maintain.minKg, unit), max: f.weight(maintain.maxKg, unit), center: f.weight(maintain.centerKg, unit) })}
          </p>
        </div>
        <StatusBadge band={band} />
      </div>
      <RangeBar classification={{ value: fromKilograms(currentKg, unit), bands }} format={(n) => f.number(n)} />
      <p className="mt-3 font-semibold">
        {tf("maintainNow", { weight: f.weight(currentKg, unit) })}{" "}
        {side === "above" && tf("maintainAbove", { amount: f.weight(currentKg - maintain.maxKg, unit) })}
        {side === "below" && tf("maintainBelow", { amount: f.weight(maintain.minKg - currentKg, unit) })}
      </p>
      <p className="mt-1 text-sm text-muted">{t("maintainSource")}</p>
    </div>
  );
}

function GoalsCard({ goals, measurements, profile }: { goals: GoalsDto; measurements: MeasurementDto[]; profile: ProfileDto }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const unit = profile.unit;
  const latest = measurements[0];
  // Body fat everywhere is the North American recalculation when the reading allows it.
  const fats = measurements.flatMap((m) => {
    const fat = bodyFatOf(profile, m);
    return fat ? [{ time: new Date(m.measuredAt).getTime(), value: fat.value }] : [];
  });
  const save = useMutation({
    mutationFn: api.saveGoals,
    onSuccess: (saved) => queryClient.setQueryData(["me"], saved),
  });
  // Changing one goal keeps the other as it is.
  const fatInput = goals.bodyFat?.targetPct ?? null;
  const weightInput = goals.weight ? { value: goals.weight.targetKg, unit: "kg" as const } : null;
  const editLink = (
    <Link to="/ajustes#metas" className="text-sm font-medium text-brand">
      {t("editGoals")}
    </Link>
  );

  if (!goals.weight && !goals.bodyFat && !goals.maintain) {
    return (
      <Card className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">{t("goalNone")}</p>
        <Link to="/ajustes#metas" className="shrink-0 rounded-2xl bg-surface-2 px-4 py-2.5 text-sm font-medium">
          {t("setGoal")}
        </Link>
      </Card>
    );
  }

  const healthy = healthyWeightRange(profile.heightCm);
  const nextWeight = latest ? nextWeightGoal(latest.weightKg, healthy.max) : null;
  const center = latest ? Math.round(latest.weightKg * 10) / 10 : null;
  const age = latest ? ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(latest.measuredAt)) : 0;
  const fatMax = bodyFatBands(profile.sex, age).find((b) => b.key === "healthy")!.max!;
  const nextFat = fats[0] ? nextBodyFatGoal(fats[0].value, fatMax) : null;

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("goalsTitle")}</h2>
        {editLink}
      </div>
      {goals.weight && latest && (
        <GoalRow
          label={t("weight")}
          start={goals.weight.startKg === null ? null : fromKilograms(goals.weight.startKg, unit)}
          current={fromKilograms(latest.weightKg, unit)}
          target={fromKilograms(goals.weight.targetKg, unit)}
          setAt={goals.weight.setAt}
          reachedAt={goals.weight.reachedAt}
          points={measurements.map((m) => ({ time: new Date(m.measuredAt).getTime(), value: fromKilograms(m.weightKg, unit) }))}
          format={(n) => `${f.number(n)} ${unit}`}
        >
          <div className="mt-4 space-y-3 rounded-2xl bg-surface-2/60 p-3">
            <p className="text-sm font-semibold">{t("goalNextTitle")}</p>
            {nextWeight !== null && (
              <NextStep
                label={tf("goalNextWeight", { value: f.weight(nextWeight, unit) })}
                hint={nextWeight <= Math.round(healthy.max * 10) / 10 ? t("goalNextWeightHealthy") : t("goalNextWeightHint")}
                disabled={save.isPending}
                onClick={() => save.mutate({ weight: { value: nextWeight, unit: "kg" }, bodyFatPct: fatInput, maintain: null })}
              />
            )}
            {center !== null && (
              <NextStep
                label={tf("goalMaintainButton", { value: f.weight(center, unit) })}
                hint={tf("goalMaintainHint", { min: f.weight(maintainRange(center).minKg, unit), max: f.weight(maintainRange(center).maxKg, unit) })}
                disabled={save.isPending}
                onClick={() => save.mutate({ weight: null, bodyFatPct: fatInput, maintain: { value: center, unit: "kg" } })}
              />
            )}
          </div>
        </GoalRow>
      )}
      {goals.maintain && latest && <MaintainRow maintain={goals.maintain} currentKg={latest.weightKg} unit={unit} />}
      {goals.bodyFat && fats[0] && (
        <GoalRow
          label={t("bodyFat")}
          start={goals.bodyFat.startPct}
          current={fats[0].value}
          target={goals.bodyFat.targetPct}
          setAt={goals.bodyFat.setAt}
          reachedAt={goals.bodyFat.reachedAt}
          points={fats}
          format={(n) => `${f.number(n)} %`}
        >
          {nextFat !== null && (
            <div className="mt-4 space-y-3 rounded-2xl bg-surface-2/60 p-3">
              <p className="text-sm font-semibold">{t("goalNextTitle")}</p>
              <NextStep
                label={tf("goalNextFat", { value: f.number(nextFat, 0) })}
                hint={t("goalNextFatHint")}
                disabled={save.isPending}
                onClick={() => save.mutate({ weight: weightInput, bodyFatPct: nextFat })}
              />
            </div>
          )}
        </GoalRow>
      )}
      {save.error && <p className="text-sm text-bad">{te(save.error)}</p>}
    </Card>
  );
}

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

/** Shown when there is weight or body fat to lose: a personal plan, then general evidence-based tips. */
function TipsCard({ profile, measurements, goals }: { profile: ProfileDto; measurements: MeasurementDto[]; goals: GoalsDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const latest = measurements[0];
  if (!latest) return null;
  const comp = measurements.find((m) => m.bodyFatPct !== null || m.impedance !== null) ?? null;
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(latest.measuredAt));
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
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("tipsTitle")}</h2>
      <p className="mt-2 text-sm font-medium text-ink">
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
      {plan && <p className="mt-2 text-sm text-ink-2">{tf("tipsEnergy", { bmr: f.number(bmr, 0), slow: pace.slow })}</p>}
      <ul className="mt-4 space-y-3">
        {TIPS.map(({ key, Icon }) => (
          <li key={key} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand" aria-hidden>
              <Icon size={18} />
            </span>
            <div>
              <p className="font-semibold">{t(`tip.${key}.title` as MessageKey)}</p>
              <p className="text-sm text-ink-2">{t(`tip.${key}.body` as MessageKey)}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-muted">{t("tipsNote")}</p>
    </Card>
  );
}

function HomeStreak({ username }: { username: string }) {
  const a = useAchievementsQuery().data;
  const { fresh } = useNewLevels(username, a);
  return a ? <StreakCard a={a} fresh={fresh} /> : null;
}

/** Caliche Balance's own 0 to 100 score, first thing on Home, with every part visible. */
function BodyScoreCard({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
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
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-2">{t("bodyScoreTitle")}</p>
          <p className="mt-1 text-5xl font-bold tracking-tight">
            {result.score}
            <span className="text-2xl font-medium text-muted"> / 100</span>
          </p>
          {delta !== null && (
            <p className="mt-1 text-sm text-ink-2">
              {delta === 0 ? t("bodyScoreSame") : tf("bodyScoreDelta", { delta: signed(delta, (n) => f.number(n, 0)) })}
            </p>
          )}
        </div>
        <svg viewBox="0 0 36 36" className="h-20 w-20 shrink-0 -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface-2)" strokeWidth="3.5" />
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${result.score} 100`}
            pathLength={100}
          />
        </svg>
      </div>
      <ul className="mt-4 space-y-3">
        {result.parts.map((p) => (
          <li key={p.part}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">
                {t(`scorePart.${p.part}` as MessageKey)} <span className="text-muted">· {partFormat(p.part, p.value)}</span>
              </span>
              <span className="text-ink-2">
                <strong className="text-ink">{Math.round(p.score)}</strong>/100 · {tf("scorePartWeight", { weight: Math.round(p.weight * 100) })}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(p.score, 2)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {result.parts.length === 1 && <p className="mt-3 text-sm text-ink-2">{t("bodyScoreNoImpedance")}</p>}
      {compare && latest.bodyScore !== null && (
        <p className="mt-3 text-sm text-ink-2">{tf("bodyScoreXiaomi", { score: f.number(latest.bodyScore, 0) })}</p>
      )}
      <p className="mt-3 text-sm text-muted">
        {t("bodyScoreNote")}
        {latest !== measurements[0] && ` ${tf("bodyScoreFrom", { date: f.date(latest.measuredAt) })}`}
      </p>
      <Link
        to={`/medicion/${latest.id}`}
        className="mt-3 flex min-h-11 items-center justify-center gap-1 rounded-2xl bg-surface-2 px-4 py-2.5 font-medium text-ink"
      >
        {t("seeDetail")} <FiChevronRight size={18} aria-hidden />
      </Link>
    </Card>
  );
}

/** Where the person's BMI falls among US adults of the same sex and age (CDC NHANES tables). */
function PercentileCard({ profile, latest }: { profile: ProfileDto; latest: MeasurementDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const age = ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(latest.measuredAt));
  const value = bmi(latest.weightKg, profile.heightCm);
  const groups = (["us", "mexican-american"] as const).flatMap((g) => {
    const r = bmiPercentile(value, profile.sex, age, g);
    return r ? [r] : [];
  });
  if (groups.length === 0) return null;
  const who = profile.sex === "male" ? t("percentileMale") : t("percentileFemale");
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("percentileTitle")}</h2>
      <p className="mt-1 text-sm text-ink-2">{t("percentileIntro")}</p>
      <div className="mt-4 space-y-5">
        {groups.map((r) => {
          const ages = r.ageTo === null ? tf("percentileAgesOver", { from: r.ageFrom }) : tf("percentileAges", { from: r.ageFrom, to: r.ageTo });
          const sentence =
            r.beyond === "above"
              ? tf("percentileAbove95", { who, ages, bmi: f.number(value) })
              : r.beyond === "below"
                ? tf("percentileBelow5", { who, ages, bmi: f.number(value) })
                : tf("percentileHigher", { n: Math.round(r.percentile), who, ages, bmi: f.number(value) });
          return (
            <div key={r.group}>
              <p className="text-sm font-semibold">{t(`percentileGroup.${r.group}` as MessageKey)}</p>
              <p className="mt-1 text-ink">{sentence}</p>
              <div className="relative mt-3 h-2.5 rounded-full bg-gradient-to-r from-surface-2 via-brand/40 to-surface-2" aria-hidden>
                <div
                  className="absolute -top-1 h-4.5 w-4.5 -translate-x-1/2 rounded-full border-[3px] border-surface bg-ink"
                  style={{ left: `${r.percentile}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-muted">
                <span>{f.number(r.p5)}</span>
                <span>{tf("percentileMedian", { p50: f.number(r.p50) })}</span>
                <span>{f.number(r.p95)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted">{t("percentileNote")}</p>
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
      className="mt-4 flex items-end gap-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex-1">
        <Field label={`${t("waist")} (${unit})`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required />
      </div>
      <Button type="submit" disabled={save.isPending}>
        {t("save")}
      </Button>
    </form>
  );

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("waistTitle")}</h2>
      {a && withWaist ? (
        <>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-3xl font-bold">{show(a.waistCm)}</p>
              <p className="text-sm text-ink-2">
                {t("waistRatio")}: <strong className="text-ink">{f.number(a.ratio, 2)}</strong>
              </p>
            </div>
            <StatusBadge band={a.band} />
          </div>
          <RangeBar classification={{ value: a.ratio, bands: WHTR_BANDS }} format={(n) => f.number(n, 1)} />
          <ul className="mt-4 space-y-1 text-sm text-ink-2">
            <li>
              {tf("waistUsCanada", { cutoff: show(a.usCanada.cutoffCm) })} <strong className="text-ink">{a.usCanada.above ? t("waistAbove") : t("waistBelow")}</strong>
            </li>
            <li>
              {tf("waistMexico", { cutoff: show(a.mexico.cutoffCm) })} <strong className="text-ink">{a.mexico.above ? t("waistAbove") : t("waistBelow")}</strong>
            </li>
          </ul>
          <p className="mt-2 text-sm text-muted">{tf("waistFrom", { date: f.date(withWaist.measuredAt) })}</p>
          {editing ? form : (
            <Button variant="secondary" className="mt-3 w-full" onClick={() => setEditing(true)}>
              {t("waistUpdate")}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">{t("waistIntro")}</p>
          <p className="mt-2 text-sm text-ink-2">{t("waistHowTo")}</p>
          {form}
        </>
      )}
      {save.error && <p className="mt-2 text-sm text-bad">{te(save.error)}</p>}
      <p className="mt-3 text-sm text-muted">{t("waistSources")}</p>
    </Card>
  );
}

/** Age at which the typical North American of the same sex has this body fat (NHANES DXA medians). */
function BodyAgeCard({ profile, reading }: { profile: ProfileDto; reading: MeasurementDto }) {
  const { t, tf } = useI18n();
  const [compare] = useCompareXiaomi();
  const fat = bodyFatOf(profile, reading);
  if (!fat) return null;
  const text = (r: BodyFatAge) =>
    r.kind === "over" ? tf("bodyAgeOver", { age: r.age }) : r.kind === "under" ? tf("bodyAgeUnder", { age: r.age }) : tf("bodyAgeYears", { age: r.age });
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("bodyAgeTitle")}</h2>
      <p className="mt-1 text-sm text-ink-2">{t("bodyAgeIntro")}</p>
      <dl className="mt-3 space-y-2">
        {(["mexican-american", "white"] as const).map((g) => (
          <div key={g} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-ink-2">{t(`bodyAgeGroup.${g}` as MessageKey)}</dt>
            <dd className="text-xl font-semibold">{text(bodyFatAge(fat.value, profile.sex, g))}</dd>
          </div>
        ))}
      </dl>
      {compare && reading.bodyAge !== null && <p className="mt-3 text-sm text-ink-2">{tf("bodyAgeXiaomi", { age: reading.bodyAge })}</p>}
      <p className="mt-3 text-sm text-muted">{t("bodyAgeNote")}</p>
    </Card>
  );
}

/** The same weigh-in computed by Caliche Balance and by Xiaomi, side by side with the difference. */
function ComparisonCard({ profile, reading }: { profile: ProfileDto; reading: MeasurementDto }) {
  const { t, locale } = useI18n();
  const f = useFormat();
  const na = compositionOf(profile, reading)!;
  const x = xiaomiComparable(reading);
  const unit = profile.unit;
  const rows: { label: string; c: number; x: number | null; format: (n: number) => string }[] = [
    { label: `${t("bodyFat")} (%)`, c: na.bodyFatPct, x: x.bodyFatPct, format: (n) => f.number(n) },
    {
      label: `${t("fatFreeMass")} (${unit})`,
      c: fromKilograms(na.fatFreeMassKg, unit),
      x: x.fatFreeMassKg === null ? null : fromKilograms(x.fatFreeMassKg, unit),
      format: (n) => f.number(n),
    },
    { label: `${t("bodyWater")} (%)`, c: na.bodyWaterPct, x: x.bodyWaterPct, format: (n) => f.number(n) },
    { label: `${t("bmr")} (kcal)`, c: na.bmrKcal, x: x.bmrKcal, format: (n) => f.number(n, 0) },
    {
      label: `${t("leanSoftMass")} (${unit})`,
      c: fromKilograms(na.leanSoftKg, unit),
      x: x.muscleKg === null ? null : fromKilograms(x.muscleKg, unit),
      format: (n) => f.number(n),
    },
    ...(na.proteinPct === null ? [] : [{ label: `${t("proteinExperimental")} (%)`, c: na.proteinPct, x: x.proteinPct, format: (n: number) => f.number(n) }]),
  ];
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("compareTitle")}</h2>
      <p className="mt-1 text-sm text-ink-2">
        {t("compareIntro")} {new Date(reading.measuredAt).toLocaleDateString(locale, { day: "numeric", month: "short" })}
      </p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 font-medium">{t("measure")}</th>
            <th className="py-1 pl-2 text-right font-medium whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[var(--series)]" aria-hidden />
                Caliche
              </span>
            </th>
            <th className="py-1 pl-2 text-right font-medium whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[var(--series-2)]" aria-hidden />
                Xiaomi
              </span>
            </th>
            <th className="py-1 pl-2 text-right font-medium whitespace-nowrap">{t("difference")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2 text-ink-2">{r.label}</td>
              <td className="py-2 pl-2 text-right font-semibold">{r.format(r.c)}</td>
              <td className="py-2 pl-2 text-right">{r.x === null ? "-" : r.format(r.x)}</td>
              <td className="py-2 pl-2 text-right font-medium">{r.x === null ? "-" : signed(r.c - r.x, r.format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-muted">{t("naCompositionNote")}</p>
    </Card>
  );
}

export function HomePage({
  profile,
  measurements,
  username,
  goals,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  username: string;
  goals: GoalsDto;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const [compare] = useCompareXiaomi();
  const latest = measurements[0];
  const name = profile.displayName ?? username;

  if (!latest) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">
          {t("hello")}, {name}
        </h1>
        <Card className="text-center">
          <h2 className="text-lg font-semibold">{t("noMeasurements")}</h2>
          <p className="mt-2 text-ink-2">{t("noMeasurementsBody")}</p>
          <div className="mt-5 flex flex-col gap-3">
            <Link to="/ajustes" className="rounded-2xl bg-brand px-4 py-3 font-semibold text-brand-ink">
              {t("connectScale")}
            </Link>
            <Link to="/agregar" className="rounded-2xl bg-surface-2 px-4 py-3 font-medium">
              {t("addManually")}
            </Link>
          </div>
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
    { sex: profile.sex, birthDate: new Date(`${profile.birthDate}T00:00:00Z`), heightCm: profile.heightCm },
    { measuredAt: new Date(latest.measuredAt), weightKg: latest.weightKg, bodyFatPct: fat?.value ?? null },
  );
  const sources: SourceId[] = ["who-bmi", ...(compare ? (["who-asian-bmi"] as const) : []), ...(na ? [] : (["mifflin-st-jeor"] as const))];
  if (result.bodyFat) sources.splice(1, 0, "gallagher-2000", "ace");
  if (na) sources.splice(1, 0, "sun-2003", "janssen", "katch-mcardle");
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
  const compNote = comp && comp.id !== latest.id ? t("compositionFrom").replace("{date}", f.date(comp.measuredAt)) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {t("hello")}, {name}
        </h1>
        <p className="text-ink-2">
          {t("lastMeasurement")}: {f.dateTime(latest.measuredAt)}
        </p>
      </div>

      <BodyScoreCard profile={profile} measurements={measurements} />

      <HomeStreak username={username} />

      {result.notes.map((note) => (
        <p key={note} className="rounded-2xl bg-warn/15 px-4 py-3 text-sm text-ink">
          {t(`note.${note}` as MessageKey)}
        </p>
      ))}

      <Card>
        <p className="text-sm font-medium text-ink-2">{t("weight")}</p>
        <p className="mt-1 text-5xl font-bold tracking-tight">{f.weight(latest.weightKg, profile.unit)}</p>
        <p className="mt-3 text-sm text-ink-2">
          {t("healthyWeight")}: {f.weight(result.healthyWeight.min, profile.unit)} {t("rangeTo")} {f.weight(result.healthyWeight.max, profile.unit)}
        </p>
      </Card>

      <PercentileCard profile={profile} latest={latest} />

      <GoalsCard goals={goals} measurements={measurements} profile={profile} />

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-2">{t("bmi")}</p>
            <p className="mt-1 text-3xl font-bold">{f.number(result.bmi.value)}</p>
          </div>
          <StatusBadge band={result.bmi.band} />
        </div>
        <RangeBar classification={result.bmi} format={(n) => f.number(n)} />
        {compare && (
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {t("asianComparison")} <StatusBadge band={result.bmiAsian.band} />
          </p>
        )}
      </Card>

      {compNote && <p className="px-1 text-sm text-muted">{compNote}</p>}

      {result.bodyFat && result.bodyFatAce && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink-2">{t("bodyFat")}</p>
              <p className="mt-1 text-3xl font-bold">{f.number(result.bodyFat.value)} %</p>
            </div>
            <StatusBadge band={result.bodyFat.band} />
          </div>
          <p className="mt-1 text-sm text-muted">{fat?.source === "north-america" ? t("fatSourceNA") : t("fatSourceXiaomi")}</p>
          <RangeBar classification={result.bodyFat} format={(n) => `${f.number(n, 0)}%`} />
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {t("aceCategory")} <StatusBadge band={result.bodyFatAce.band} />
          </p>
          {compare && fat?.source === "north-america" && comp?.bodyFatPct != null && (
            <p className="mt-3 text-sm text-ink-2">
              {t("xiaomiSays")} <strong className="text-ink">{f.number(comp.bodyFatPct)} %</strong>
            </p>
          )}
        </Card>
      )}

      {na && comp && compare && <ComparisonCard profile={profile} reading={comp} />}

      {na && (
        <Card>
          <h2 className="text-lg font-semibold">{t("naCompositionTitle")}</h2>
          <p className="mt-1 text-sm text-ink-2">{t("naCompositionIntro")}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {[
              { label: t("fatFreeMass"), value: f.weight(na.fatFreeMassKg, profile.unit) },
              { label: t("fatMass"), value: f.weight(na.fatMassKg, profile.unit) },
              { label: t("bodyWater"), value: `${f.number(na.bodyWaterL)} L · ${f.number(na.bodyWaterPct, 0)} %` },
              { label: t("skeletalMuscle"), value: f.weight(na.skeletalMuscleKg, profile.unit) },
              { label: t("muscleIndex"), value: `${f.number(na.skeletalMuscleIndex)} kg/m²` },
              { label: t("leanSoftMass"), value: f.weight(na.leanSoftKg, profile.unit) },
              ...(na.proteinKg === null || na.proteinPct === null
                ? []
                : [{ label: t("proteinExperimental"), value: `${f.weight(na.proteinKg, profile.unit)} · ${f.number(na.proteinPct)} %` }]),
            ].map((x) => (
              <div key={x.label} className="rounded-2xl bg-surface-2 p-3">
                <dt className="text-sm text-ink-2">{x.label}</dt>
                <dd className="text-xl font-semibold">{x.value}</dd>
              </div>
            ))}
          </dl>
          {na.muscleClass ? (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
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
            <p className="mt-3 text-sm text-muted">{t("muscleIndexNote")}</p>
          )}
          <p className="mt-2 text-sm text-muted">{t("naCompositionNote")}</p>
          {na.proteinPct !== null && <p className="mt-2 text-sm text-muted">{t("proteinNote")}</p>}
        </Card>
      )}

      {comp && <BodyAgeCard profile={profile} reading={comp} />}

      <WaistCard profile={profile} measurements={measurements} />

      <TipsCard profile={profile} measurements={measurements} goals={goals} />

      <Card>
        <p className="text-sm font-medium text-ink-2">{t("bmr")}</p>
        <p className="mt-1 text-3xl font-bold">
          {f.number(na ? na.bmrKcal : result.bmrKcal, 0)} <span className="text-lg font-medium text-ink-2">{t("kcalDay")}</span>
        </p>
        <p className="mt-1 text-sm text-muted">{na ? t("bmrSourceNA") : t("bmrSourceFormula")}</p>
        {compare && comp?.bmrKcal != null && (
          <p className="mt-2 text-sm text-ink-2">{tf("reportXiaomi", { value: `${f.number(comp.bmrKcal, 0)} kcal` })}</p>
        )}
      </Card>

      {compare && xiaomi.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">{t("xiaomiValues")}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {xiaomi.map((x) => (
              <div key={x.label} className="rounded-2xl bg-surface-2 p-3">
                <dt className="text-sm text-ink-2">{x.label}</dt>
                <dd className="text-xl font-semibold">{x.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">{t("xiaomiNote")}</p>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">{t("sources")}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-2">
          {sources.map((s) => (
            <li key={s}>{t(`source.${s}` as MessageKey)}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t("disclaimer")}</p>
      </Card>
    </div>
  );
}
