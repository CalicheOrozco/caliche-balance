import { useEffect, useState } from "react";
import { type BadgeGroup, type BadgeStatus, TARGETS } from "../../shared/achievements.ts";
import type { GoalHistoryEntry, MeasurementDto, ProfileDto } from "../../shared/schemas.ts";
import { BadgeMedal, ChallengeRow, StreakCard, useAchievements, useNewBadges } from "../achievements.tsx";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Card, useFormat } from "../ui.tsx";

const GROUPS: BadgeGroup[] = ["habit", "health", "goals"];

function BadgeTile({ b, unit, isNew }: { b: BadgeStatus; unit: ProfileDto["unit"]; isNew: boolean }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  // Percent and point targets read better with a decimal; counts do not.
  const decimals = b.id === "loss-5" || b.id === "loss-10" || b.id === "fat-down-2" ? 1 : 0;
  const description = tf(`badgeDesc.${b.id}` as MessageKey, {
    fat: f.weight(TARGETS.recompFatKg, unit),
    lean: f.weight(TARGETS.recompLeanKg, unit),
  });
  return (
    <li className={`flex flex-col items-center rounded-2xl p-3 text-center ${isNew ? "bg-brand/15 ring-2 ring-brand" : "bg-surface-2"}`}>
      <BadgeMedal id={b.id} earned={b.earnedAt !== null} size={72} />
      <p className={`mt-2 font-semibold leading-tight ${b.earnedAt ? "text-ink" : "text-ink-2"}`}>{t(`badge.${b.id}` as MessageKey)}</p>
      <p className="mt-1 text-xs text-muted">{description}</p>
      {b.earnedAt ? (
        <p className="mt-2 text-xs font-medium text-good">{tf("badgeEarnedOn", { date: f.date(b.earnedAt) })}</p>
      ) : (
        b.progress && (
          <div className="mt-2 w-full">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(Math.min(b.progress.value / b.progress.target, 1) * 100, 3)}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-2">
              {tf("badgeProgress", { value: f.number(Math.min(b.progress.value, b.progress.target), decimals), target: f.number(b.progress.target, decimals) })}
            </p>
          </div>
        )
      )}
    </li>
  );
}

export function AchievementsPage({
  profile,
  measurements,
  goalHistory,
  username,
}: {
  profile: ProfileDto;
  measurements: MeasurementDto[];
  goalHistory: GoalHistoryEntry[];
  username: string;
}) {
  const { t, tf } = useI18n();
  const a = useAchievements(profile, measurements, goalHistory);
  const { fresh, markSeen } = useNewBadges(username, a);
  // Highlight everything new during this visit, including badges that appear once the full history
  // loads after the offline copy (it keeps only 3 months), and count them as seen for the next visit.
  const [newOnOpen, setNewOnOpen] = useState<Set<string>>(() => new Set());
  const freshKey = fresh.join(",");
  useEffect(() => {
    if (!freshKey) return;
    setNewOnOpen((previous) => new Set([...previous, ...fresh]));
    markSeen();
  }, [freshKey]);
  const earned = a.badges.filter((b) => b.earnedAt !== null).length;
  const month = a.challenges.filter((c) => c.period === "month");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("achievementsTitle")}</h1>
        <p className="text-ink-2">{tf("achievementsCount", { earned, total: a.badges.length })}</p>
        <p className="mt-1 text-sm text-muted">{t("achievementsIntro")}</p>
      </div>

      <StreakCard a={a} fresh={[]} linkToBadges={false} />

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">{t("challengePeriod.month")}</h2>
          <p className="text-xs text-muted">{month[0] && (month[0].daysLeft <= 1 ? t("challengeLastDay") : tf("challengeDaysLeft", { n: month[0].daysLeft }))}</p>
        </div>
        <ul className="mt-3 space-y-3">
          {month.map((c) => (
            <ChallengeRow key={c.id} c={c} />
          ))}
        </ul>
      </Card>

      {GROUPS.map((g) => (
        <Card key={g}>
          <h2 className="text-lg font-semibold">{t(`badgeGroup.${g}` as MessageKey)}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3">
            {a.badges
              .filter((b) => b.group === g)
              // Earned first, newest on top; then the closest to being earned.
              .sort((x, y) =>
                x.earnedAt && y.earnedAt
                  ? y.earnedAt.localeCompare(x.earnedAt)
                  : x.earnedAt
                    ? -1
                    : y.earnedAt
                      ? 1
                      : (y.progress ? y.progress.value / y.progress.target : 0) - (x.progress ? x.progress.value / x.progress.target : 0),
              )
              .map((b) => (
                <BadgeTile key={b.id} b={b} unit={profile.unit} isNew={newOnOpen.has(b.id)} />
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
