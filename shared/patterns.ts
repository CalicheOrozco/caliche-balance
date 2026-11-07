/**
 * Patterns between habits from Apple Health and the scale, for Body > Trends. Each one compares
 * weeks where a habit held against weeks where it did not, and only says something when both
 * sides have enough weeks; with fewer, any difference is mostly noise from water and food.
 * These are associations in the person's own data, not causes, and the copy says so.
 */

/** A value on a local calendar day ("2026-11-06"). */
export interface DayValue {
  date: string;
  value: number;
}

export interface HabitPattern {
  /** Average change per week in weeks with the habit, minus the same in the other weeks. */
  difference: number;
  /** Weeks with the habit and weeks counted in total. */
  habitWeeks: number;
  totalWeeks: number;
}

/** Fewest weeks on each side before a pattern is shown. */
export const MIN_PATTERN_WEEKS = 3;
/** A night of 7 hours or more (AASM and Sleep Research Society, 2015). */
export const GOOD_SLEEP_MIN = 7 * 60;
/** An active day: 30 minutes of exercise, the daily share of 150 a week (WHO, 2020). */
export const ACTIVE_DAY_MIN = 30;
/** Weeks with this many active days count as active weeks. */
export const ACTIVE_DAYS_PER_WEEK = 3;

/** The Monday that starts the week of a calendar day, as "YYYY-MM-DD". */
export function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function previousWeek(week: string): string {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function byWeek(values: DayValue[]): Map<string, number[]> {
  const weeks = new Map<string, number[]>();
  for (const v of values) {
    const week = weekOf(v.date);
    weeks.set(week, [...(weeks.get(week) ?? []), v.value]);
  }
  return weeks;
}

/**
 * How much a body value moved each week: the week's average minus the previous week's. Averages
 * of two or more readings smooth out a single heavy morning; weeks without two readings, or
 * without a week before them, are left out.
 */
export function weeklyChanges(readings: DayValue[]): Map<string, number> {
  const weeks = byWeek(readings);
  const changes = new Map<string, number>();
  for (const [week, values] of weeks) {
    const before = weeks.get(previousWeek(week));
    if (values.length >= 2 && before && before.length >= 2) changes.set(week, mean(values) - mean(before));
  }
  return changes;
}

/** Compares weekly changes in weeks marked true against weeks marked false. */
function compare(changes: Map<string, number>, habit: Map<string, boolean>): HabitPattern | null {
  const yes: number[] = [];
  const no: number[] = [];
  for (const [week, change] of changes) {
    const held = habit.get(week);
    if (held === true) yes.push(change);
    else if (held === false) no.push(change);
  }
  if (yes.length < MIN_PATTERN_WEEKS || no.length < MIN_PATTERN_WEEKS) return null;
  return { difference: mean(yes) - mean(no), habitWeeks: yes.length, totalWeeks: yes.length + no.length };
}

/**
 * Weight change in weeks where the person slept 7 hours or more on average, against the other
 * weeks. A week counts when at least 4 of its nights were recorded.
 */
export function sleepWeightPattern(nights: DayValue[], weights: DayValue[]): HabitPattern | null {
  const habit = new Map<string, boolean>();
  for (const [week, minutes] of byWeek(nights)) {
    if (minutes.length >= 4) habit.set(week, mean(minutes) >= GOOD_SLEEP_MIN);
  }
  return compare(weeklyChanges(weights), habit);
}

/**
 * Body fat change in weeks with 3 or more days of 30 minutes of exercise, against the other
 * weeks. Apple Health sends exercise minutes but not the kind of workout, so this is exercise in
 * general, not strength training. A week counts when at least 5 of its days were recorded.
 */
export function exerciseFatPattern(exercise: DayValue[], fats: DayValue[]): HabitPattern | null {
  const habit = new Map<string, boolean>();
  for (const [week, minutes] of byWeek(exercise)) {
    if (minutes.length >= 5) habit.set(week, minutes.filter((m) => m >= ACTIVE_DAY_MIN).length >= ACTIVE_DAYS_PER_WEEK);
  }
  return compare(weeklyChanges(fats), habit);
}
