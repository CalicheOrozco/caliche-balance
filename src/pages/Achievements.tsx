import { useEffect, useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import { type BadgeGroup, type BadgeStatus, TARGETS } from "../../shared/achievements.ts";
import type { ProfileDto } from "../../shared/schemas.ts";
import { BadgeMedal, ChallengeRow, StreakCard, useBadgeNames, useNewLevels } from "../achievements.tsx";
import { useAchievementsQuery } from "../api.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Card, useFormat } from "../ui.tsx";

const GROUPS: BadgeGroup[] = ["habit", "health", "goals"];

/**
 * Every date a badge was earned, one year at a time (the newest first) and one line per month,
 * so a badge earned daily since years ago stays short.
 */
function BadgeDates({ dates }: { dates: string[] }) {
  const { tf, locale } = useI18n();
  const byYear = new Map<number, Map<number, number[]>>();
  for (const iso of dates) {
    const d = new Date(iso);
    const months = byYear.get(d.getFullYear()) ?? new Map<number, number[]>();
    months.set(d.getMonth(), [...(months.get(d.getMonth()) ?? []), d.getDate()]);
    byYear.set(d.getFullYear(), months);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);
  const [year, setYear] = useState(years[0]!);
  const months = [...(byYear.get(year) ?? new Map<number, number[]>())].sort((a, b) => b[0] - a[0]);
  const monthName = (m: number) => new Date(2000, m, 1).toLocaleDateString(locale, { month: "long" });
  const total = (y: number) => [...byYear.get(y)!.values()].reduce((sum, days) => sum + days.length, 0);
  return (
    <div className="mt-2">
      {years.length > 1 && (
        <div role="radiogroup" aria-label={tf("badgeYears", { n: years.length })} className="flex flex-wrap gap-1.5">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              role="radio"
              aria-checked={y === year}
              onClick={() => setYear(y)}
              className={`min-h-9 rounded-full px-3 text-sm font-medium transition ${y === year ? "bg-brand text-brand-ink" : "bg-surface text-ink-2"}`}
            >
              {y} <span className={y === year ? "opacity-80" : "text-muted"}>· {total(y)}</span>
            </button>
          ))}
        </div>
      )}
      <dl className="mt-2 space-y-1.5 text-sm">
        {months.map(([m, days]) => (
          <div key={m} className="flex gap-2">
            <dt className="w-28 shrink-0 text-ink-2 first-letter:uppercase">
              {monthName(m)} <span className="text-muted">({days.length})</span>
            </dt>
            <dd className="text-ink">{[...new Set(days)].sort((a, b) => a - b).join(", ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BadgeRow({ b, unit, isNew }: { b: BadgeStatus; unit: ProfileDto["unit"]; isNew: boolean }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const names = useBadgeNames();
  const count = b.dates.length;
  const description = tf(`badgeDesc.${b.id}` as MessageKey, { fat: f.weight(TARGETS.recompFatKg, unit), lean: f.weight(TARGETS.recompLeanKg, unit) });
  return (
    <li className={`rounded-2xl p-3 ${isNew ? "bg-brand/15 ring-2 ring-brand" : "bg-surface-2"}`}>
      <div className="flex gap-3">
        <BadgeMedal id={b.id} level={b.level} size={68} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className={`font-semibold ${b.level > 0 ? "text-ink" : "text-ink-2"}`}>{names.badge(b.id)}</p>
            <p className={`text-sm font-semibold ${b.level > 0 ? "text-brand" : "text-muted"}`}>{b.level > 0 ? names.tier(b.level) : t("badgeLocked")}</p>
          </div>
          <p className="text-xs text-muted">{description}</p>
          <p className="mt-1 text-sm text-ink-2">
            {count === 1 ? t("badgeTimesOne") : count > 1 ? tf("badgeTimes", { n: count }) : null}
            {count > 0 && " · "}
            {b.nextAt === null ? t("badgeMax") : tf("badgeNext", { count, next: b.nextAt, tier: names.tier(b.level + 1) })}
          </p>
          {b.nextAt !== null && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max((count / b.nextAt) * 100, 3)}%` }} />
            </div>
          )}
        </div>
      </div>
      {count > 0 && (
        <details className="group mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
            {t("badgeDates")} <FiChevronDown className="transition group-open:rotate-180" aria-hidden />
          </summary>
          <BadgeDates dates={b.dates} />
        </details>
      )}
    </li>
  );
}

export function AchievementsPage({ profile, username }: { profile: ProfileDto; username: string }) {
  const { t, tf } = useI18n();
  const query = useAchievementsQuery();
  const a = query.data;
  const { fresh, markSeen } = useNewLevels(username, a);
  // Highlight every badge that went up during this visit, including those that appear once the
  // server answers after the offline copy, and count them as seen for the next visit.
  const [highlight, setHighlight] = useState<Set<string>>(() => new Set());
  const freshKey = fresh.map((x) => `${x.id}:${x.level}`).join(",");
  useEffect(() => {
    if (!freshKey) return;
    setHighlight((previous) => new Set([...previous, ...fresh.map((x) => x.id)]));
    markSeen();
  }, [freshKey]);

  if (!a) return <p className="py-10 text-center text-muted">{query.error ? t("error.generic") : "…"}</p>;
  const earned = a.badges.filter((b) => b.level > 0).length;
  const month = a.challenges.filter((c) => c.period === "month");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("achievementsTitle")}</h1>
        <p className="text-ink-2">{tf("achievementsCount", { earned, total: a.badges.length })}</p>
        <p className="mt-1 text-sm text-muted">{t("achievementsIntro")}</p>
        <p className="mt-1 text-sm text-muted">{t("levelsIntro")}</p>
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
          <ul className="mt-3 space-y-3">
            {a.badges
              .filter((b) => b.group === g)
              // Highest level first; within a level, the closest to the next one.
              .sort((x, y) => y.level - x.level || y.dates.length / (y.nextAt ?? 1) - x.dates.length / (x.nextAt ?? 1))
              .map((b) => (
                <BadgeRow key={b.id} b={b} unit={profile.unit} isNew={b.level > 0 && highlight.has(b.id)} />
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
