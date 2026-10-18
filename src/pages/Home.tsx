import { Link } from "react-router";
import { assess, type SourceId } from "../../shared/reference.ts";
import { bodyFatOf, compositionOf, xiaomiComparable } from "../../shared/composition.ts";
import { useCompareXiaomi } from "../compare.ts";
import { dailyTrend, estimateEta, goalProgress } from "../../shared/goals.ts";
import { fromKilograms, type GoalsDto, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Card, RangeBar, StatusBadge, signed, useFormat } from "../ui.tsx";

/** One goal: progress bar, distance left, starting point and the estimate at the recent pace. */
function GoalRow({
  label,
  start,
  current,
  target,
  setAt,
  points,
  format,
}: {
  label: string;
  start: number | null;
  current: number;
  target: number;
  setAt: string;
  points: { time: number; value: number }[];
  format: (n: number) => string;
}) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const progress = goalProgress(start, current, target);
  const eta = estimateEta(progress, dailyTrend(points));
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
      <p className="mt-2 text-lg font-bold">
        {progress.reached ? t("goalReached") : tf("goalRemaining", { value: format(progress.remaining) })}
        <span className="ml-2 text-sm font-medium text-muted">{Math.round(progress.fraction * 100)} %</span>
      </p>
      {start !== null && <p className="text-sm text-muted">{tf("goalFrom", { start: format(start), date: f.date(setAt) })}</p>}
      {etaText && <p className="mt-1 text-sm text-ink-2">{etaText}</p>}
    </div>
  );
}

function GoalsCard({ goals, measurements, profile }: { goals: GoalsDto; measurements: MeasurementDto[]; profile: ProfileDto }) {
  const { t } = useI18n();
  const f = useFormat();
  const unit = profile.unit;
  const latest = measurements[0];
  // Body fat everywhere is the North American recalculation when the reading allows it.
  const fats = measurements.flatMap((m) => {
    const fat = bodyFatOf(profile, m);
    return fat ? [{ time: new Date(m.measuredAt).getTime(), value: fat.value }] : [];
  });
  const editLink = (
    <Link to="/ajustes#metas" className="text-sm font-medium text-brand">
      {t("editGoals")}
    </Link>
  );

  if (!goals.weight && !goals.bodyFat) {
    return (
      <Card className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">{t("goalNone")}</p>
        <Link to="/ajustes#metas" className="shrink-0 rounded-2xl bg-surface-2 px-4 py-2.5 text-sm font-medium">
          {t("setGoal")}
        </Link>
      </Card>
    );
  }

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
          points={measurements.map((m) => ({ time: new Date(m.measuredAt).getTime(), value: fromKilograms(m.weightKg, unit) }))}
          format={(n) => `${f.number(n)} ${unit}`}
        />
      )}
      {goals.bodyFat && fats[0] && (
        <GoalRow
          label={t("bodyFat")}
          start={goals.bodyFat.startPct}
          current={fats[0].value}
          target={goals.bodyFat.targetPct}
          setAt={goals.bodyFat.setAt}
          points={fats}
          format={(n) => `${f.number(n)} %`}
        />
      )}
    </Card>
  );
}

/** Zepp's 0 to 100 body score, first thing on Home, with the change since the previous score. */
function BodyScoreCard({ measurements }: { measurements: MeasurementDto[] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const scored = measurements.filter((m) => m.bodyScore !== null);
  const latest = scored[0];
  if (!latest) return null;
  const score = latest.bodyScore!;
  const previous = scored[1]?.bodyScore ?? null;
  const delta = previous === null ? null : score - previous;
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink-2">{t("bodyScoreTitle")}</p>
          <p className="mt-1 text-5xl font-bold tracking-tight">
            {f.number(score, 0)}
            <span className="text-2xl font-medium text-muted"> / 100</span>
          </p>
          {delta !== null && (
            <p className="mt-1 text-sm text-ink-2">{tf("bodyScoreDelta", { delta: signed(delta, (n) => f.number(n, 0)) })}</p>
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
            strokeDasharray={`${Math.min(Math.max(score, 0), 100)} 100`}
            pathLength={100}
          />
        </svg>
      </div>
      <p className="mt-3 text-sm text-muted">
        {t("bodyScoreNote")}
        {latest !== measurements[0] && ` ${tf("bodyScoreFrom", { date: f.date(latest.measuredAt) })}`}
      </p>
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
  const { t } = useI18n();
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
  const sources: SourceId[] = ["who-bmi", "who-asian-bmi", "mifflin-st-jeor"];
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

      <BodyScoreCard measurements={measurements} />

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
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {t("asianComparison")} <StatusBadge band={result.bmiAsian.band} />
        </p>
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
          {fat?.source === "north-america" && comp?.bodyFatPct != null && (
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
              { label: t("bmrKatch"), value: `${f.number(na.bmrKcal, 0)} kcal` },
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
        </Card>
      )}

      <Card>
        <p className="text-sm font-medium text-ink-2">{t("bmr")}</p>
        <p className="mt-1 text-3xl font-bold">
          {f.number(result.bmrKcal, 0)} <span className="text-lg font-medium text-ink-2">{t("kcalDay")}</span>
        </p>
      </Card>

      {xiaomi.length > 0 && (
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
