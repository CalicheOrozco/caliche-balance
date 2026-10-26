import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FiAward, FiChevronRight } from "react-icons/fi";
import { Link } from "react-router";
import { api, useAchievementsQuery } from "../api.ts";
import { ageAt, assess, bodyFatBands, type Classification, healthyWeightRange } from "../../shared/reference.ts";
import { bodyFatOf } from "../../shared/composition.ts";
import { StreakCard, useNewLevels } from "../achievements.tsx";
import { ReportCard, TrendLine } from "../reports.tsx";
import { ActivityGlanceCard } from "../appleHealth.tsx";
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
import { fromKilograms, type GoalsDto, type StreakReward, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Button, Card, RangeBar, StatusBadge, signed, useFormat } from "../ui.tsx";

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

function HomeStreak({ username, reward }: { username: string; reward: StreakReward | null }) {
  const a = useAchievementsQuery().data;
  const { fresh } = useNewLevels(username, a);
  return a ? <StreakCard a={a} fresh={fresh} reward={reward} /> : null;
}

/** A heading that splits Home into parts, so the page reads in order instead of as one long list. */
function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="px-1 pt-4 text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>;
}

/** The first card: weight, body fat and the score side by side, with the healthy range and trend. */
function SummaryCard({
  profile,
  measurements,
  healthyWeight,
  bodyFat,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  healthyWeight: { min: number; max: number };
  bodyFat: Classification | null;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const latest = measurements[0]!;
  const previous = measurements[1];
  const change = previous ? fromKilograms(latest.weightKg, profile.unit) - fromKilograms(previous.weightKg, profile.unit) : null;
  const scored = measurements.filter((m) => m.bodyFatPct !== null || m.impedance !== null);
  const score = scoreOf(profile, scored[0] ?? latest).score;
  return (
    <Card>
      <p className="text-sm font-medium text-ink-2">{t("weight")}</p>
      <p className="text-4xl font-bold tracking-tight">{f.weight(latest.weightKg, profile.unit)}</p>
      {change !== null && (
        <p className="text-sm text-ink-2">{tf("summaryChange", { delta: signed(change, (n) => `${f.number(n)} ${profile.unit}`) })}</p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-xs text-ink-2">{t("bodyFat")}</p>
          <p className="text-2xl font-bold">{bodyFat ? `${f.number(bodyFat.value)} %` : "-"}</p>
          {bodyFat && (
            <div className="mt-1">
              <StatusBadge band={bodyFat.band} />
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-xs text-ink-2">{t("bodyScoreTitle")}</p>
          <p className="text-2xl font-bold">
            {score}
            <span className="text-base font-medium text-muted"> / 100</span>
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-2">
        {t("healthyWeight")}: {f.weight(healthyWeight.min, profile.unit)} {t("rangeTo")} {f.weight(healthyWeight.max, profile.unit)}
      </p>
      <TrendLine measurements={measurements} unit={profile.unit} />
      <Link
        to={`/medicion/${latest.id}`}
        className="mt-3 flex min-h-11 items-center justify-center gap-1 rounded-2xl bg-surface-2 px-4 py-2.5 font-medium text-ink"
      >
        {t("seeDetail")} <FiChevronRight size={18} aria-hidden />
      </Link>
    </Card>
  );
}

export function HomePage({
  profile,
  measurements,
  username,
  goals,
  streakReward,
  appleHealthConnected,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  username: string;
  goals: GoalsDto;
  streakReward: StreakReward | null;
  appleHealthConnected: boolean;
}) {
  const { t } = useI18n();
  const f = useFormat();
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
  const result = assess(
    { sex: profile.sex, birthDate: new Date(`${profile.birthDate}T00:00:00Z`), heightCm: profile.heightCm },
    { measuredAt: new Date(latest.measuredAt), weightKg: latest.weightKg, bodyFatPct: fat?.value ?? null },
  );

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

      {result.notes.map((note) => (
        <p key={note} className="rounded-2xl bg-warn/15 px-4 py-3 text-sm text-ink">
          {t(`note.${note}` as MessageKey)}
        </p>
      ))}

      {/* The essentials first: where you are today and your streak; then goals and the week. */}
      <SummaryCard profile={profile} measurements={measurements} healthyWeight={result.healthyWeight} bodyFat={result.bodyFat} />

      <HomeStreak username={username} reward={streakReward} />

      <SectionTitle>{t("homeSectionProgress")}</SectionTitle>
      <GoalsCard goals={goals} measurements={measurements} profile={profile} />
      <ReportCard
        profile={profile}
        measurements={measurements}
        days={7}
        unlock="weekly"
        title={t("weeklyTitle")}
        intro={t("weeklyIntro")}
      />

      {appleHealthConnected && (
        <>
          <SectionTitle>{t("homeSectionHealth")}</SectionTitle>
          <ActivityGlanceCard connected={appleHealthConnected} />
        </>
      )}
    </div>
  );
}
