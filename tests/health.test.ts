import { describe, expect, it } from "vitest";
import { type HealthDayDto, type HealthMetric, HEALTH_METRIC_SPECS, HEALTH_METRICS, healthAverages, healthDaySchema, parseHealthNumber, parseHealthValue, readHealthSend, sleepNights, sleepStage, summarizeSleep } from "../shared/health.ts";

describe("parseHealthNumber", () => {
  const steps = { min: 0, max: 200_000 };
  const kcal = { min: 0, max: 20_000 };
  const breaths = { min: 4, max: 60 };

  it("reads what a Shortcut can send in any region format", () => {
    expect(parseHealthNumber(8452, steps)).toBe(8452);
    // Steps with a thousands separator: English, Spanish (Mexico), Spain, and with a space.
    expect(["8,452", "8.452", "8 452", "8\u202f452", "8452 pasos"].map((v) => parseHealthNumber(v, steps))).toEqual([8452, 8452, 8452, 8452, 8452]);
    // Decimals in a measure that has them.
    expect(["512.4", "512,4", "512,4 kcal", "1,234.5", "1.234,5", "6,25 km"].map((v) => parseHealthNumber(v, kcal))).toEqual([512.4, 512.4, 512.4, 1234.5, 1234.5, 6.25]);
    // A repeated mark always separates thousands.
    expect(parseHealthNumber("12,345,678", { min: 0, max: 1e9 })).toBe(12345678);
    // Text with no number is left for the schema to reject.
    expect(parseHealthNumber("nada", steps)).toBe("nada");
  });

  it("reads a single mark before three digits as thousands unless that is out of range", () => {
    // What an iPhone in English sends for resting energy and water: thousands, not decimals.
    expect(parseHealthNumber("1,935", kcal)).toBe(1935);
    expect(parseHealthNumber("1,800", { min: 0, max: 20_000 })).toBe(1800);
    // 15,234 breaths a minute is impossible, so it is 15.234.
    expect(parseHealthNumber("15.234", breaths)).toBe(15.234);
    expect(parseHealthNumber("0.045", { min: 0, max: 500 })).toBe(0.045);
  });
});

describe("parseHealthValue", () => {
  it("converts the person's preferred units into the metric's own", () => {
    const v = (metric: HealthMetric, value: string) => parseHealthValue(value, HEALTH_METRIC_SPECS[metric]);
    expect(v("restingHr", "58 count/min")).toBe(58);
    expect(v("restingHr", "0.97 count/s")).toBeCloseTo(58.2, 1);
    expect(v("hrvMs", "45 ms")).toBe(45);
    expect(v("hrvMs", "0.045 s")).toBeCloseTo(45, 6);
    expect(v("activeKcal", "1,935 kcal")).toBe(1935);
    expect(v("activeKcal", "418.4 kJ")).toBeCloseTo(100, 6);
    expect(v("exerciseMin", "1.5 hr")).toBe(90);
    expect(v("steps", "8,452 count")).toBe(8452);
    // No unit, or one this metric never uses, keeps the number.
    expect(v("steps", "8452")).toBe(8452);
    expect(v("standMin", "35 something")).toBe(35);
  });
});

describe("healthDaySchema", () => {
  it("accepts any subset of metrics and rejects an empty or impossible day", () => {
    expect(healthDaySchema.parse({ steps: "8,452", restingHr: 58 }).values).toEqual({ steps: 8452, restingHr: 58 });
    expect(healthDaySchema.safeParse({ date: "2026-10-19" }).success).toBe(false);
    // Distance from an iPhone set to miles.
    expect(healthDaySchema.parse({ distanceKm: "3,1 mi" }).values.distanceKm).toBeCloseTo(4.989, 3);
    // Without an Apple Watch some metrics have no samples and come as empty text.
    expect(healthDaySchema.parse({ steps: "8452", exerciseMin: "", restingHr: " " }).values).toEqual({ steps: 8452, exerciseMin: null, restingHr: null });
    expect(healthDaySchema.safeParse({ steps: "", restingHr: "" }).success).toBe(false);
    expect(healthDaySchema.safeParse({ steps: -5 }).success).toBe(false);
    expect(healthDaySchema.safeParse({ restingHr: 400 }).success).toBe(false);
  });

  it("puts each value on the day it belongs to", () => {
    // Right after midnight the latest steps are yesterday's; nothing found arrives empty.
    const { days, problems } = readHealthSend({
      steps: "8,452 count",
      steps_date: "2026-10-19T00:00:00-04:00",
      restingHr: "58 count/min",
      restingHr_date: "2026-10-20T00:00:00-04:00",
      flightsClimbed: " ",
      flightsClimbed_date: "",
      symptom_fatigue: "Mild",
      symptom_fatigue_date: "2026-10-02T21:15:00-04:00",
    });
    expect(problems).toEqual([]);
    expect(days.map((d) => [d.date, d.values, d.symptoms])).toEqual([
      ["2026-10-19", { steps: 8452 }, {}],
      ["2026-10-20", { restingHr: 58 }, {}],
      ["2026-10-02", {}, { fatigue: "Mild" }],
    ]);
    // Nothing found at all is still an empty day.
    expect(readHealthSend({ steps: "", steps_date: "" })).toEqual({ days: [], problems: [{ path: "days.0", code: "health-empty" }] });
  });

  it("reads the Shortcut's lines: one per day for metrics, the latest symptom, the night on the wake-up day", () => {
    const d = (day: string, time = "00:00:00") => `2026-10-${day}T${time}-04:00`;
    const { days, problems } = readHealthSend({
      // As an iPhone sent it: the first group starts at the day's first sample, and an empty group
      // for tomorrow comes last.
      steps: [`${d("18")}|10,240|count`, `${d("19")}|9,312|count`, `${d("20", "00:12:49")}|412|count`, `${d("21")}|0|count`].join("\n"),
      restingHr: `${d("19")}|58|count/min`,
      // Separate readings, averaged per day; "Fill Missing" zeros are not readings.
      hrvMs: [`${d("19", "11:53:00")}|55.5|ms`, `${d("19", "09:43:00")}|50.3|ms`, `${d("19", "08:49:00")}|30.4|ms`, `${d("18")}|0|ms`].join("\n"),
      activeKcal: `${d("19", "00:10:00")}|1,935.5|Cal`,
      // "Fill Missing" zeros start at midnight; a real 0 % reading starts at its time.
      walkingAsymmetryPct: [`${d("20")}|0|%`, `${d("19", "08:20:14")}|0|%`, `${d("18", "08:14:01")}|1.05|%`].join("\n"),
      // A day without data comes as 0 ("Fill Missing"); a pulse of 0 is not a reading.
      walkingHr: [`${d("19")}|0|count/min`, `${d("18")}|0|count/min`].join("\n"),
      flightsClimbed: "",
      symptom_fatigue: [`${d("19", "21:00:00")}|Severe`, `${d("19", "08:00:00")}|Mild`].join("\n"),
      sleep: [`${d("19", "23:40:00")}|${d("20", "03:00:00")}|Core`, `${d("20", "03:00:00")}|${d("20", "06:30:00")}|Deep`].join("\n"),
      shortcutVersion: "5",
    }, Date.parse("2026-10-20T08:00:00-04:00"));
    expect(problems).toEqual([]);
    expect(days.map((x) => [x.date, x.values, x.symptoms, x.sleep?.asleepMin ?? null])).toEqual([
      ["2026-10-18", { steps: 10240, walkingAsymmetryPct: 1.05 }, {}, null],
      ["2026-10-19", { steps: 9312, restingHr: 58, hrvMs: 45.4, activeKcal: 1935.5, walkingAsymmetryPct: 0 }, { fatigue: "Severe" }, null],
      ["2026-10-20", { steps: 412 }, {}, 410],
    ]);
  });

  it("keeps what is valid when a value is out of range or the night cannot be read", () => {
    const { days, problems } = readHealthSend({
      steps: "8452 count",
      restingHr: "0.2 count/min",
      sleep: "algo que no es una noche",
      steps_date: "2026-10-20T00:00:00-04:00",
    });
    // The steps are saved; the impossible pulse is reported with what came; the unreadable night is dropped.
    expect(days.map((d) => [d.date, d.values])).toEqual([["2026-10-20", { steps: 8452 }]]);
    expect(problems).toEqual([{ path: "days.1.restingHr", code: "Too small: expected number to be >=20", received: 0.2 }]);
    expect(readHealthSend("nada").problems).toEqual([{ path: "", code: "invalid" }]);
    expect(readHealthSend({ days: [] }).problems).toEqual([{ path: "days", code: "invalid" }]);
  });

  it("keeps symptoms that were logged and drops the empty ones", () => {
    expect(healthDaySchema.parse({ symptom_fatigue: "Mild", symptom_fever: "", symptom_nausea: "Not Present" }).symptoms).toEqual({ fatigue: "Mild" });
  });

  it("averages only the days that have each metric", () => {
    const day = (steps: number | null, restingHr: number | null, asleepMin?: number): HealthDayDto => ({
      ...(Object.fromEntries(HEALTH_METRICS.map((m) => [m, null])) as Record<(typeof HEALTH_METRICS)[number], null>),
      date: "2026-10-19",
      steps,
      restingHr,
      sleep: asleepMin === undefined ? null : { asleepMin, inBedMin: null, deepMin: null, coreMin: null, remMin: null, awakeMin: null, awakenings: 0, start: "", end: "" },
      symptoms: {},
    });
    expect(healthAverages([day(8000, 60, 420), day(10000, null)])).toMatchObject({ steps: 9000, restingHr: 60, sleepMin: 420, hrvMs: null });
  });
});

describe("sleep", () => {
  const line = (start: string, end: string, value: string) => `2026-10-19T${start}:00-03:00|2026-10-19T${end}:00-03:00|${value}`;

  it("names stages in English or Spanish", () => {
    expect(["In Bed", "Awake", "Core", "Deep", "REM", "Asleep", "En cama", "Profundo", "Despierto"].map(sleepStage)).toEqual([
      "inBed",
      "awake",
      "core",
      "deep",
      "rem",
      "asleep",
      "inBed",
      "deep",
      "awake",
    ]);
  });

  it("adds up a night by stage, counting minutes recorded by two devices once", () => {
    const night = [
      line("00:00", "08:00", "In Bed"),
      line("00:10", "01:10", "Core"),
      line("01:10", "02:00", "Deep"),
      line("02:00", "02:10", "Awake"),
      line("02:10", "03:00", "REM"),
      line("03:00", "06:30", "Core"),
      // The iPhone's own estimate overlaps the Watch's stages: not counted twice.
      line("00:30", "06:00", "Asleep"),
      line("06:30", "06:40", "Awake"),
      line("06:40", "07:00", "Core"),
      "una línea que no se entiende",
    ].join("\n");
    const s = summarizeSleep(night)!;
    expect(s).toMatchObject({ coreMin: 290, deepMin: 50, remMin: 50, awakeMin: 20, awakenings: 2, inBedMin: 480 });
    // Asleep from 00:10 to 07:00 minus the two 10-minute awakenings; the iPhone's plain "Asleep"
    // estimate does not hide the one at 02:00.
    expect(s.asleepMin).toBe(390);
    expect(s.start).toBe(new Date("2026-10-19T00:10:00-03:00").toISOString());
    expect(s.end).toBe(new Date("2026-10-19T07:00:00-03:00").toISOString());
  });

  it("splits several days of samples into nights, one per wake-up day, and leaves naps out", () => {
    const at = (day: string, time: string) => `2026-10-${day}T${time}:00-03:00`;
    const text = [
      // The search window starts in the middle of this night: dropped.
      `${at("23", "00:00")}|${at("23", "07:10")}|Core`,
      // Night of the 23rd to the 24th.
      `${at("23", "23:30")}|${at("24", "03:00")}|Core`,
      `${at("24", "03:00")}|${at("24", "04:00")}|Deep`,
      `${at("24", "04:00")}|${at("24", "07:00")}|REM`,
      // A nap on the 24th.
      `${at("24", "15:00")}|${at("24", "15:40")}|Core`,
      // Night of the 24th to the 25th, still asleep at 11:32.
      `${at("25", "00:20")}|${at("25", "06:00")}|Core`,
      `${at("25", "06:00")}|${at("25", "06:10")}|Awake`,
      `${at("25", "06:10")}|${at("25", "11:32")}|REM`,
    ].join("\n");
    const nights = sleepNights(text);
    expect([...nights.keys()]).toEqual(["2026-10-24", "2026-10-25"]);
    expect(summarizeSleep(nights.get("2026-10-24")!)).toMatchObject({ asleepMin: 450, awakenings: 0 });
    expect(summarizeSleep(nights.get("2026-10-25")!)).toMatchObject({ asleepMin: 662, awakenings: 1 });
    // What the Shortcut sends lands on those days.
    const { days } = readHealthSend({ sleep: text });
    expect(days.map((d) => [d.date, d.sleep?.asleepMin])).toEqual([
      ["2026-10-24", 450],
      ["2026-10-25", 662],
    ]);
  });

  it("works without an Apple Watch (only in bed or asleep) and with nothing readable", () => {
    expect(summarizeSleep(line("00:00", "07:30", "In Bed"))).toMatchObject({ asleepMin: 0, inBedMin: 450, deepMin: null, awakenings: 0 });
    expect(summarizeSleep([line("00:00", "07:30", "In Bed"), line("00:20", "07:00", "Asleep")].join("\n"))).toMatchObject({ asleepMin: 400, deepMin: null });
    expect(summarizeSleep("basura\n||")).toBeNull();
  });
});
