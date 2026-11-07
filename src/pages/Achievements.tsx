import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { FiChevronDown, FiGift } from "react-icons/fi";
import { type BadgeGroup, type BadgeStatus, HEALTH_BADGE_GROUPS, STREAK_UNLOCKS, type StreakUnlock, TARGETS } from "../../shared/achievements.ts";
import { type ProfileDto, REWARD_KINDS, type RewardKind, rewardProgress, type StreakReward, type UserDto } from "../../shared/schemas.ts";
import { BadgeMedal, ChallengeRow, StreakHero, TIER_LOOK, useBadgeNames, useBodyNow, useNewLevels } from "../achievements.tsx";
import { api, useAchievementsQuery, useMe } from "../api.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Avatar, Button, Card, Field, Modal, PageHeader, Progress, SectionHeader, Segmented, useFormat } from "../ui.tsx";

const GROUPS: BadgeGroup[] = ["habit", "health", "goals", ...HEALTH_BADGE_GROUPS];

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

/** Everything about one badge: its level, what it takes, how many times and when it was earned. */
function BadgeDetail({ b, unit }: { b: BadgeStatus; unit: ProfileDto["unit"] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const names = useBadgeNames();
  // count and pastYears are missing on achievements cached offline by an older version.
  const count = b.count ?? b.dates.length;
  const pastYears = b.pastYears ?? [];
  const description = tf(`badgeDesc.${b.id}` as MessageKey, { fat: f.weight(TARGETS.recompFatKg, unit), lean: f.weight(TARGETS.recompLeanKg, unit) });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3.5">
        <BadgeMedal id={b.id} level={b.level} size={64} />
        <div className="min-w-0">
          <p className={`text-[15px] font-extrabold ${b.level > 0 ? TIER_LOOK[b.level]!.text : "text-muted"}`}>{b.level > 0 ? names.tier(b.level) : t("aw.notEarned")}</p>
          <p className="text-[13px] font-semibold text-ink-2">{description}</p>
        </div>
      </div>
      <p className="text-sm font-semibold text-ink-2">
        {count === 1 ? t(b.scope === "year" ? "badgeTimesOneYear" : "badgeTimesOne") : count > 1 ? tf(b.scope === "year" ? "badgeTimesYear" : "badgeTimes", { n: count }) : null}
        {count > 0 && " · "}
        {b.nextAt === null ? t("badgeMax") : tf("badgeNext", { count, next: b.nextAt, tier: names.tier(b.level + 1) })}
      </p>
      {b.nextAt !== null && <Progress fraction={count / b.nextAt} />}
      {pastYears.length > 0 && (
        <p className="text-xs font-semibold text-muted">
          {pastYears.map((y) => tf("badgePastYear", { year: y.year, tier: y.level > 0 ? names.tier(y.level) : t("badgeLocked"), n: y.count })).join(" · ")}
        </p>
      )}
      {b.dates.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-bold text-brand-text [&::-webkit-details-marker]:hidden">
            {t("badgeDates")} <FiChevronDown className="transition group-open:rotate-180" aria-hidden />
          </summary>
          <BadgeDates dates={b.dates} />
        </details>
      )}
    </div>
  );
}

/** A tile of the badge grid: the medal, its name and its level; opens the badge's detail. */
function BadgeTile({ b, isNew, onOpen }: { b: BadgeStatus; isNew: boolean; onOpen: () => void }) {
  const { t, tf } = useI18n();
  const names = useBadgeNames();
  const count = b.count ?? b.dates.length;
  const name = names.badge(b.id);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={tf("aw.badgeOpen", { name })}
      className={`flex flex-col items-center gap-2 rounded-[22px] border bg-surface px-2 py-3.5 transition active:scale-[0.97] ${isNew ? "border-brand ring-2 ring-brand" : "border-line"} ${b.level === 0 ? "opacity-75" : ""}`}
    >
      <BadgeMedal id={b.id} level={b.level} size={64} />
      <span className="text-center text-xs leading-3.75 font-extrabold text-ink">{name}</span>
      <span className={`text-[11px] font-bold ${b.level > 0 ? TIER_LOOK[b.level]!.text : "text-muted"}`}>
        {b.level === 0 ? t("aw.notEarned") : count > 1 ? tf("aw.levelTimes", { tier: names.tier(b.level), n: count }) : names.tier(b.level)}
      </span>
    </button>
  );
}

/** Everything a longer best streak unlocks, as a timeline: done, the one in progress, and the rest. */
function UnlocksCard({ best }: { best: number }) {
  const { t, tf } = useI18n();
  // Unlocks that share a day count are one step (the monthly report and the gold theme at 30).
  const steps = [...new Set(Object.values(STREAK_UNLOCKS))]
    .sort((a, b) => a - b)
    .map((days) => ({ days, keys: (Object.keys(STREAK_UNLOCKS) as StreakUnlock[]).filter((k) => STREAK_UNLOCKS[k] === days) }));
  const currentDays = steps.find((s) => best < s.days)?.days;
  return (
    <Card className="flex flex-col">
      <h2 className="text-base font-extrabold">{t("unlocksTitle")}</h2>
      <p className="mb-3 text-[13px] font-semibold text-muted">{t("unlocksIntro")}</p>
      <ol>
        {steps.map((step, i) => {
          const done = best >= step.days;
          const current = step.days === currentDays;
          const last = i === steps.length - 1;
          const title = step.keys.length > 1 ? t("aw.unlockMonthlyGold") : t(`unlock.${step.keys[0]!}` as MessageKey);
          const desc = t(`unlockDesc.${step.keys[0]!}` as MessageKey);
          return (
            <li key={step.days} className="flex gap-3.5">
              <div className="flex w-10 flex-col items-center">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-[13px] font-extrabold ${
                    done ? "border-brand bg-brand text-brand-ink" : current ? "border-gold bg-gold-soft text-gold-text" : "border-line bg-surface-2 text-muted"
                  }`}
                >
                  {step.days}
                </span>
                {!last && <span className={`min-h-4.5 w-0.5 flex-1 ${done ? "bg-brand" : "bg-line"}`} aria-hidden />}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2 pb-4">
                <span className="text-[15px] font-extrabold">{title}</span>
                <span className="text-[13px] font-semibold text-muted">
                  {done ? `${desc} · ${t("aw.unlockedShort")}` : current ? tf("aw.progressDays", { best, days: step.days }) : desc}
                </span>
                {current && <Progress fraction={best / step.days} className="bg-gold" label={title} />}
                {!done && !current && step.days === STREAK_UNLOCKS.diamond && <span className="sr-only">{t("aw.unlockLevelTop")}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** The person's own reward: for a streak, for kilos lost, or for points of body fat lost. */
function RewardCard({ reward, current }: { reward: StreakReward | null; current: number }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const queryClient = useQueryClient();
  const body = useBodyNow();
  const unit = useMe().data?.profile?.unit ?? "kg";
  // The form shows with no reward, or when picking another; derived so that a reward arriving after
  // the offline copy still shows instead of the form.
  const [picking, setEditing] = useState(false);
  const editing = reward === null || picking;
  const [text, setText] = useState("");
  const [kind, setKind] = useState<RewardKind>("streak");
  const [amounts, setAmounts] = useState<Record<RewardKind, string>>({ streak: String(Math.max(30, current + 7)), weight: unit === "lb" ? "10" : "5", fat: "3" });
  const done = (saved: UserDto) => {
    queryClient.setQueryData(["me"], saved);
    setEditing(false);
  };
  const save = useMutation({ mutationFn: () => api.saveStreakReward({ text, kind, amount: amounts[kind], unit }), onSuccess: done });
  const remove = useMutation({ mutationFn: api.removeStreakReward, onSuccess: done });
  const hint =
    kind === "streak"
      ? current > 0
        ? tf("rewardDaysHint", { n: current })
        : undefined
      : kind === "weight"
        ? body.weightKg !== null
          ? tf("rewardWeightHint", { now: f.weight(body.weightKg, unit) })
          : t("error.reward-no-weight")
        : body.fatPct !== null
          ? tf("rewardFatHint", { now: f.number(body.fatPct) })
          : t("error.reward-no-fat");
  if (reward && !editing) {
    const kind = reward.kind ?? "streak";
    const { current: got } = rewardProgress({ kind, target: reward.target, start: reward.start ?? null }, { streak: current, ...body });
    const left = Math.max(reward.target - got, 0);
    const label =
      kind === "streak"
        ? tf("aw.rewardStreak", { n: reward.target })
        : kind === "weight"
          ? tf("aw.rewardWeight", { amount: f.weight(reward.target, unit) })
          : tf("aw.rewardFat", { n: f.number(reward.target) });
    const remaining = reward.earnedAt
      ? t("aw.rewardWon")
      : kind === "streak"
        ? left === 1
          ? t("aw.rewardDayLeft")
          : tf("aw.rewardDaysLeft", { n: left })
        : tf("aw.rewardLeft", { amount: kind === "weight" ? f.weight(left, unit) : `${f.number(left)} %` });
    return (
      <section className="flex flex-col gap-3 rounded-3xl border border-dashed border-gold bg-surface p-4.5">
        <div className="flex items-center gap-3.5">
          <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gold-soft text-gold" aria-hidden>
            <FiGift size={26} strokeWidth={2.2} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs font-extrabold tracking-[0.04em] text-gold-text uppercase">{label}</span>
            <span className="text-base font-extrabold">{reward.text}</span>
            <span className={`text-[13px] font-semibold ${reward.earnedAt ? "text-good-text" : "text-muted"}`}>{remaining}</span>
          </span>
        </div>
        {!reward.earnedAt && <Progress fraction={got / reward.target} className="bg-gold" label={reward.text} />}
        <p className="text-xs font-semibold text-muted">{tf("rewardSince", { date: f.date(reward.setAt) })}</p>
        <div className="flex gap-2">
          {reward.earnedAt && (
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(true)}>
              {t("rewardNew")}
            </Button>
          )}
          <Button
            variant="dangerText"
            className={reward.earnedAt ? "" : "w-full"}
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`${t("rewardRemove")}?`)) remove.mutate();
            }}
          >
            {t("rewardRemove")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-extrabold">
        <FiGift className="text-gold" aria-hidden /> {t("rewardTitle")}
      </h2>
      <form
        className="mt-2 space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm font-semibold text-ink-2">{t("rewardIntro")}</p>
        <Field label={t("rewardText")} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("rewardTextPlaceholder")} maxLength={60} required />
        <Segmented
          label={t("rewardKind")}
          value={kind}
          onChange={setKind}
          options={REWARD_KINDS.map((k) => ({ value: k, label: t(`rewardKind.${k}` as MessageKey) }))}
        />
        <Field
          label={kind === "streak" ? t("rewardDays") : kind === "weight" ? tf("rewardWeight", { unit }) : t("rewardFat")}
          inputMode={kind === "streak" ? "numeric" : "decimal"}
          value={amounts[kind]}
          onChange={(e) => setAmounts((a) => ({ ...a, [kind]: e.target.value }))}
          help={hint}
          required
        />
        {save.error && <p className="text-sm font-semibold text-bad-text">{te(save.error)}</p>}
        <Button type="submit" className="w-full" disabled={save.isPending}>
          {t("rewardSave")}
        </Button>
        {reward && (
          <Button type="button" variant="subtle" className="w-full" onClick={() => setEditing(false)}>
            {t("aw.cancel")}
          </Button>
        )}
      </form>
    </Card>
  );
}

export function AchievementsPage({ user, profile }: { user: UserDto; profile: ProfileDto }) {
  const username = user.username;
  const { t, tf } = useI18n();
  const names = useBadgeNames();
  const query = useAchievementsQuery();
  const a = query.data;
  const { fresh, markSeen } = useNewLevels(username, a);
  const [category, setCategory] = useState<BadgeGroup | "all">("all");
  const [open, setOpen] = useState<BadgeStatus["id"] | null>(null);
  // Highlight every badge that went up during this visit, including those that appear once the
  // server answers after the offline copy, and count them as seen for the next visit.
  const [highlight, setHighlight] = useState<Set<string>>(() => new Set());
  const freshKey = fresh.map((x) => `${x.id}:${x.level}`).join(",");
  useEffect(() => {
    if (!freshKey) return;
    setHighlight((previous) => new Set([...previous, ...fresh.map((x) => x.id)]));
    markSeen();
  }, [freshKey]);

  const header = (subtitle?: string) => (
    <PageHeader title={t("achievementsTitle")} subtitle={subtitle}>
      <Avatar to="/yo" />
    </PageHeader>
  );
  if (!a)
    return (
      <div className="flex flex-col gap-3.5">
        {header()}
        <p className="py-10 text-center text-muted">{query.error ? t("error.generic") : "…"}</p>
      </div>
    );
  const earned = a.badges.filter((b) => b.level > 0).length;
  const week = a.challenges.filter((c) => c.period === "week");
  const month = a.challenges.filter((c) => c.period === "month");
  // Apple Health badges need the connection; without it a group shows only once one was earned.
  const groups = GROUPS.filter((g) => !HEALTH_BADGE_GROUPS.includes(g) || user.appleHealth != null || a.badges.some((b) => b.group === g && b.level > 0));
  const shown = a.badges
    .filter((b) => groups.includes(b.group) && (category === "all" || b.group === category))
    // Highest level first; within a level, the closest to the next one.
    .sort((x, y) => y.level - x.level || (y.count ?? 0) / (y.nextAt ?? 1) - (x.count ?? 0) / (x.nextAt ?? 1));
  const opened = open ? a.badges.find((b) => b.id === open) : undefined;
  const daysLeft = (list: typeof week) => (list[0] ? (list[0].daysLeft <= 1 ? t("challengeLastDay") : tf("challengeDaysLeft", { n: list[0].daysLeft })) : undefined);

  return (
    <div className="flex flex-col gap-3.5">
      {header(tf("aw.subtitle", { year: new Date().getFullYear(), earned, total: a.badges.length }))}

      <StreakHero s={a.streak} />

      <UnlocksCard best={a.streak.best} />

      {week.length > 0 && (
        <>
          <SectionHeader title={t("aw.weekChallenges")} aside={daysLeft(week)} />
          <Card className="py-1.5!">
            <ul>
              {week.map((c) => (
                <ChallengeRow key={c.id} c={c} />
              ))}
            </ul>
          </Card>
        </>
      )}
      {month.length > 0 && (
        <>
          <SectionHeader title={t("aw.monthChallenges")} aside={daysLeft(month)} />
          <Card className="py-1.5!">
            <ul>
              {month.map((c) => (
                <ChallengeRow key={c.id} c={c} />
              ))}
            </ul>
          </Card>
        </>
      )}

      <SectionHeader title={t("aw.yourBadges")} />
      <div role="radiogroup" aria-label={t("aw.categories")} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {(["all", ...groups] as const).map((g) => {
          const on = category === g;
          return (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setCategory(g)}
              className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-extrabold whitespace-nowrap transition ${on ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2"}`}
            >
              {t(`aw.cat.${g}` as MessageKey)}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {shown.map((b) => (
          <BadgeTile key={b.id} b={b} isNew={b.level > 0 && highlight.has(b.id)} onOpen={() => setOpen(b.id)} />
        ))}
      </div>

      <RewardCard reward={user.streakReward ?? null} current={a.streak.current} />

      <details className="group rounded-3xl border border-line bg-surface px-4">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 text-[15px] font-bold [&::-webkit-details-marker]:hidden">
          {t("aw.levelsHelp")} <FiChevronDown className="text-muted transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-2 pb-4 text-[13px] leading-4.75 font-semibold text-ink-2">
          <p>{t("achievementsIntro")}</p>
          <p>{t("levelsIntro")}</p>
        </div>
      </details>

      {opened && (
        <Modal title={names.badge(opened.id)} onClose={() => setOpen(null)}>
          <BadgeDetail b={opened} unit={profile.unit} />
        </Modal>
      )}
    </div>
  );
}
