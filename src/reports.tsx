import { FiLock } from "react-icons/fi";
import { STREAK_UNLOCKS, type StreakUnlock } from "../shared/achievements.ts";
import { CM_PER_IN, fromKilograms, type MeasurementDto, type ProfileDto } from "../shared/schemas.ts";
import { periodReport, type PeriodSummary, trendNow, weightTrend } from "../shared/trend.ts";
import { useAchievementsQuery } from "./api.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { Card, signed, useFormat } from "./ui.tsx";

/** The best streak so far, for what it unlocks; null until the server answers. */
export function useBestStreak(): number | null {
  return useAchievementsQuery().data?.streak.best ?? null;
}

/** A locked reward: what it is and the streak that unlocks it. */
export function LockedNote({ unlock, best }: { unlock: StreakUnlock; best: number }) {
  const { t, tf } = useI18n();
  return (
    <p className="flex items-start gap-2 text-sm text-muted">
      <FiLock size={15} className="mt-0.5 shrink-0" aria-hidden />
      {tf("reportLocked", { name: t(`unlock.${unlock}` as MessageKey), n: STREAK_UNLOCKS[unlock], best })}
    </p>
  );
}

/** "Real weight" for the weight card: the smoothed trend and its weekly change, or how to unlock it. */
export function TrendLine({ measurements, unit }: { measurements: MeasurementDto[]; unit: ProfileDto["unit"] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const best = useBestStreak();
  if (best === null) return null;
  if (best < STREAK_UNLOCKS.trend) {
    return <p className="mt-3 text-sm text-muted">{tf("trendLocked", { n: STREAK_UNLOCKS.trend, best })}</p>;
  }
  const now = trendNow(weightTrend(measurements));
  if (!now) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm font-medium text-ink-2">{t("trendTitle")}</p>
      <p className="text-2xl font-bold">
        {f.weight(now.trendKg, unit)}
        {now.perWeekKg !== null && (
          <span className="ml-2 text-sm font-medium text-ink-2">
            {tf("trendPerWeek", { delta: signed(fromKilograms(now.perWeekKg, unit), (n) => `${f.number(n)} ${unit}`) })}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">{t("trendHint")}</p>
    </div>
  );
}

/** One period against the one before: averages of what matters for health, not just weight. */
export function ReportCard({
  profile,
  measurements,
  days,
  unlock,
  title,
  intro,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  days: number;
  unlock: StreakUnlock;
  title: string;
  intro: string;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const best = useBestStreak();
  if (best === null) return null;
  if (best < STREAK_UNLOCKS[unlock]) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2">
          <LockedNote unlock={unlock} best={best} />
        </div>
      </Card>
    );
  }
  const { current, previous } = periodReport(profile, measurements, days, Date.now());
  const unit = profile.unit;
  const waistUnit = unit === "lb" ? "in" : "cm";
  const mass = (kg: number | null) => (kg === null ? null : fromKilograms(kg, unit));
  const rows: { label: string; pick: (p: PeriodSummary) => number | null; format: (n: number) => string }[] = [
    { label: `${t("weight")} (${unit})`, pick: (p) => mass(p.weightKg), format: (n) => f.number(n) },
    { label: `${t("bodyFat")} (%)`, pick: (p) => p.bodyFatPct, format: (n) => f.number(n) },
    { label: `${t("fatMass")} (${unit})`, pick: (p) => mass(p.fatMassKg), format: (n) => f.number(n) },
    { label: `${t("leanSoftMass")} (${unit})`, pick: (p) => mass(p.leanSoftKg), format: (n) => f.number(n) },
    { label: `${t("skeletalMuscle")} (${unit})`, pick: (p) => mass(p.skeletalMuscleKg), format: (n) => f.number(n) },
    { label: t("bodyScoreTitle"), pick: (p) => p.score, format: (n) => f.number(n, 0) },
    {
      label: `${t("waist")} (${waistUnit})`,
      pick: (p) => (p.waistCm === null ? null : waistUnit === "in" ? p.waistCm / CM_PER_IN : p.waistCm),
      format: (n) => f.number(n),
    },
    { label: t("reportCount"), pick: (p) => p.count, format: (n) => f.number(n, 0) },
  ];
  const shown = rows.filter((r) => r.pick(current) !== null || r.pick(previous) !== null);
  return (
    <Card>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{intro}</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1 font-medium" />
            <th className="py-1 pl-2 text-right font-medium">{t("reportNow")}</th>
            <th className="py-1 pl-2 text-right font-medium">{t("reportBefore")}</th>
            <th className="py-1 pl-2 text-right font-medium">{t("reportChange")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r) => {
            const now = r.pick(current);
            const before = r.pick(previous);
            return (
              <tr key={r.label}>
                <td className="py-2 text-ink-2">{r.label}</td>
                <td className="py-2 pl-2 text-right font-semibold">{now === null ? "-" : r.format(now)}</td>
                <td className="py-2 pl-2 text-right">{before === null ? "-" : r.format(before)}</td>
                <td className="py-2 pl-2 text-right font-medium">{now === null || before === null ? "-" : signed(now - before, r.format)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
