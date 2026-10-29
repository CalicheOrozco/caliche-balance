import type { SleepSummary } from "./health.ts";

/**
 * Caliche Balance's 0 to 100 sleep score, with every part visible, from the night Apple Health sent.
 *
 * - Duration (45 %): 7 to 9 hours for adults (American Academy of Sleep Medicine; National Sleep
 *   Foundation).
 * - Stages (20 %): deep sleep is usually 13 to 23 % of the night and REM 20 to 25 % in adults.
 * - Continuity (25 %): the National Sleep Foundation's sleep quality indicators (Ohayon et al.,
 *   Sleep Health 2017): awake after falling asleep 20 minutes or less is good and 51 or more poor;
 *   waking up once or less is good and 4 times or more poor; sleep efficiency (asleep over time in
 *   bed) 85 % or more is good and 74 % or less poor.
 * - Regularity (10 %): falling asleep near your usual time (Windred et al., Sleep 2024).
 *
 * The references are published; the weights and slopes between them are this app's choice, not a
 * clinical standard. A part without data (no Apple Watch stages, too few nights for a usual time)
 * is left out and the rest re-weighted.
 */

export type SleepPart = "duration" | "stages" | "continuity" | "regularity";

export interface SleepPartScore {
  part: SleepPart;
  score: number;
  weight: number;
}

export interface SleepScore {
  score: number;
  parts: SleepPartScore[];
  /** What each part read, for showing next to it. */
  facts: {
    asleepMin: number;
    deepPct: number | null;
    remPct: number | null;
    awakeMin: number | null;
    awakenings: number;
    efficiencyPct: number | null;
    /** Minutes away from the usual bedtime; null with fewer than 3 nights before. */
    bedtimeOffMin: number | null;
    /** Signed: negative is earlier than usual. */
    bedtimeDiffMin: number | null;
    /** The usual bedtime, in minutes after midnight (local). */
    usualBedtimeMin: number | null;
  };
}

const WEIGHTS: Record<SleepPart, number> = { duration: 0.45, stages: 0.2, continuity: 0.25, regularity: 0.1 };
/** Nights before this one needed to know the usual bedtime. */
const USUAL_NIGHTS = 3;

/** Straight line from (x0, y0) to (x1, y1), clamped to 0..100. */
function ramp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  const y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  return Math.min(Math.max(y, 0), 100);
}

/** 100 from 7 to 9 hours; 0 at 4 hours; down to 60 at 11 hours. */
function durationPart(min: number): number {
  const h = min / 60;
  if (h < 7) return ramp(h, 4, 0, 7, 100);
  if (h <= 9) return 100;
  return ramp(h, 9, 100, 11, 60);
}

/**
 * When a night started, in minutes from local noon, so bedtimes on both sides of midnight (23:30
 * and 00:20) come out close together.
 */
export function bedtimeMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (hour * 60 + minute + 12 * 60) % (24 * 60);
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** The score of one night, with up to 7 nights before it for the usual bedtime. */
export function sleepScoreOf(night: SleepSummary, before: SleepSummary[], timeZone: string): SleepScore | null {
  if (night.asleepMin <= 0) return null;
  const pct = (min: number | null) => (min === null ? null : (min / night.asleepMin) * 100);
  const deepPct = pct(night.deepMin);
  const remPct = pct(night.remMin);
  const efficiencyPct = night.inBedMin ? Math.min((night.asleepMin / night.inBedMin) * 100, 100) : null;
  const usual = before.slice(-7).map((n) => bedtimeMinutes(n.start, timeZone));
  const usualAt = usual.length >= USUAL_NIGHTS ? median(usual) : null;
  const bedtimeDiffMin = usualAt === null ? null : bedtimeMinutes(night.start, timeZone) - usualAt;
  const bedtimeOffMin = bedtimeDiffMin === null ? null : Math.abs(bedtimeDiffMin);
  const usualBedtimeMin = usualAt === null ? null : Math.round(usualAt + 12 * 60) % (24 * 60);

  const scores: Partial<Record<SleepPart, number>> = { duration: durationPart(night.asleepMin) };
  if (deepPct !== null && remPct !== null) scores.stages = (Math.min(deepPct / 13, 1) * 100 + Math.min(remPct / 20, 1) * 100) / 2;
  const continuity = [
    night.awakeMin === null ? null : ramp(night.awakeMin, 20, 100, 51, 0),
    ramp(night.awakenings, 1, 100, 4, 0),
    efficiencyPct === null ? null : ramp(efficiencyPct, 74, 0, 85, 100),
  ].filter((v): v is number => v !== null);
  scores.continuity = continuity.reduce((a, b) => a + b, 0) / continuity.length;
  if (bedtimeOffMin !== null) scores.regularity = ramp(bedtimeOffMin, 30, 100, 120, 0);

  const used = (Object.keys(scores) as SleepPart[]).filter((p) => scores[p] !== undefined);
  const total = used.reduce((sum, p) => sum + WEIGHTS[p], 0);
  const parts = used.map((part) => ({ part, score: scores[part]!, weight: WEIGHTS[part] / total }));
  return {
    score: Math.round(parts.reduce((sum, p) => sum + p.score * p.weight, 0)),
    parts,
    facts: { asleepMin: night.asleepMin, deepPct, remPct, awakeMin: night.awakeMin, awakenings: night.awakenings, efficiencyPct, bedtimeOffMin, bedtimeDiffMin, usualBedtimeMin },
  };
}
