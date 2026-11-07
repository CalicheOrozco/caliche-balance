import { describe, expect, it } from "vitest";
import { exerciseFatPattern, sleepWeightPattern, weekOf, weeklyChanges, type DayValue } from "../shared/patterns.ts";

/** Calendar day `n` days after Monday 2026-01-05. */
function day(n: number): string {
  const d = new Date(Date.UTC(2026, 0, 5 + n));
  return d.toISOString().slice(0, 10);
}

describe("weekOf", () => {
  it("returns the Monday of the week", () => {
    expect(weekOf("2026-11-06")).toBe("2026-11-02"); // Friday
    expect(weekOf("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(weekOf("2026-11-08")).toBe("2026-11-02"); // Sunday
  });
});

describe("weeklyChanges", () => {
  it("compares each week's average with the week before and skips weeks with one reading", () => {
    const readings: DayValue[] = [
      { date: day(0), value: 100 },
      { date: day(2), value: 100.4 },
      { date: day(7), value: 99.6 },
      { date: day(9), value: 99.8 },
      { date: day(14), value: 99 }, // only one reading this week
    ];
    const changes = weeklyChanges(readings);
    expect([...changes.keys()]).toEqual([day(7)]);
    expect(changes.get(day(7))).toBeCloseTo(-0.5);
  });
});

/** Ten weeks: weight drops 0.5 kg in weeks with good sleep and 0.1 kg in the others. */
function sleepData(goodWeeks: number[]) {
  const nights: DayValue[] = [];
  const weights: DayValue[] = [];
  let w = 100;
  for (let week = 0; week < 10; week++) {
    const good = goodWeeks.includes(week);
    if (week > 0) w -= good ? 0.5 : 0.1;
    for (let d = 0; d < 7; d++) nights.push({ date: day(week * 7 + d), value: good ? 450 : 360 });
    weights.push({ date: day(week * 7), value: w }, { date: day(week * 7 + 3), value: w });
  }
  return { nights, weights };
}

describe("sleepWeightPattern", () => {
  it("finds how much more weight goes in weeks of 7 hours of sleep", () => {
    const { nights, weights } = sleepData([1, 3, 5, 7]);
    const pattern = sleepWeightPattern(nights, weights)!;
    expect(pattern.difference).toBeCloseTo(-0.4);
    expect(pattern.habitWeeks).toBe(4);
    expect(pattern.totalWeeks).toBe(9);
  });

  it("says nothing with fewer than 3 weeks on a side", () => {
    const { nights, weights } = sleepData([1, 3]);
    expect(sleepWeightPattern(nights, weights)).toBeNull();
  });

  it("ignores weeks with fewer than 4 recorded nights", () => {
    const { nights, weights } = sleepData([1, 3, 5, 7]);
    const sparse = nights.filter((n) => !(n.date >= day(7) && n.date < day(14)) || n.date < day(9));
    expect(sleepWeightPattern(sparse, weights)!.habitWeeks).toBe(3);
  });
});

describe("exerciseFatPattern", () => {
  it("compares body fat change in weeks with 3 or more active days", () => {
    const exercise: DayValue[] = [];
    const fats: DayValue[] = [];
    let fat = 28;
    for (let week = 0; week < 8; week++) {
      const active = week % 2 === 1;
      if (week > 0) fat -= active ? 0.3 : 0.1;
      for (let d = 0; d < 7; d++) exercise.push({ date: day(week * 7 + d), value: active && d < 3 ? 40 : 10 });
      fats.push({ date: day(week * 7 + 1), value: fat }, { date: day(week * 7 + 4), value: fat });
    }
    const pattern = exerciseFatPattern(exercise, fats)!;
    expect(pattern.difference).toBeCloseTo(-0.2);
    expect(pattern.habitWeeks).toBe(4);
  });
});
