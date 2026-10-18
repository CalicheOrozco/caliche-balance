import type { IconType } from "react-icons";
import { FiActivity, FiArrowLeft, FiChevronDown, FiChevronLeft, FiChevronRight, FiPieChart, FiTarget, FiUser } from "react-icons/fi";
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { bodyFatAge } from "../../shared/bodyAge.ts";
import { MUSCLE_INDEX_CUTOFFS, xiaomiComparable } from "../../shared/composition.ts";
import { type Change, type ReadingReport, type ReportItem, type ReportItemKey, readingReport, recentChanges } from "../../shared/report.ts";
import { healthyWeightRange, type Status } from "../../shared/reference.ts";
import { CM_PER_IN, fromKilograms, type MeasurementDto, type ProfileDto } from "../../shared/schemas.ts";
import { scoreOf } from "../../shared/score.ts";
import { useCompareXiaomi } from "../compare.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Card, RangeBar, StatusBadge, signed, useFormat } from "../ui.tsx";

const ITEM_ICON: Record<ReportItemKey, IconType> = { bodyFat: FiPieChart, bmi: FiUser, muscleIndex: FiActivity, waist: FiTarget };
const ICON_TONE: Record<Status, string> = { good: "bg-good/15 text-good", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad" };

/** A small single-series line, oldest to newest, with the newest point marked. */
function Sparkline({ points, label, format }: { points: { time: number; value: number }[]; label: string; format: (n: number) => string }) {
  const { locale } = useI18n();
  if (points.length < 2) return null;
  const W = 320;
  const H = 64;
  const pad = 6;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const t0 = points[0]!.time;
  const t1 = points[points.length - 1]!.time;
  const x = (t: number) => pad + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const last = points[points.length - 1]!;
  const day = (t: number) => new Date(t).toLocaleDateString(locale, { day: "numeric", month: "short" });
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${label}: ${format(points[0]!.value)} → ${format(last.value)}`}>
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke="var(--line)" strokeWidth={1} />
        <polyline
          points={points.map((p) => `${x(p.time)},${y(p.value)}`).join(" ")}
          fill="none"
          stroke="var(--series)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p) => (
          <circle key={p.time} cx={x(p.time)} cy={y(p.value)} r={p === last ? 4.5 : 0} fill="var(--series)" stroke="var(--surface)" strokeWidth={2}>
            <title>{`${day(p.time)}: ${format(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-muted">
        <span>{day(t0)}</span>
        <span>{day(t1)}</span>
      </figcaption>
    </figure>
  );
}

function ItemRow({ item, report, profile, reading }: { item: ReportItem; report: ReadingReport; profile: ProfileDto; reading: MeasurementDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const [compare] = useCompareXiaomi();
  const Icon = ITEM_ICON[item.key];
  const waistUnit = profile.unit === "lb" ? "in" : "cm";
  const waistText = (cm: number) => (waistUnit === "in" ? `${f.number(cm / CM_PER_IN)} in` : `${f.number(cm, 0)} cm`);
  const { low, moderate } = MUSCLE_INDEX_CUTOFFS[profile.sex];

  const value =
    item.key === "bodyFat" ? `${f.number(item.value)} %` : item.key === "muscleIndex" ? `${f.number(item.value)} kg/m²` : f.number(item.value, item.key === "waist" ? 2 : 1);
  const amount =
    item.toHealthy === null
      ? ""
      : item.key === "waist"
        ? `${f.number(waistUnit === "in" ? item.toHealthy / CM_PER_IN : item.toHealthy)} ${waistUnit}`
        : f.weight(item.toHealthy, profile.unit);
  const advice = tf(`advice.${item.key}.${item.band.key}` as MessageKey, {
    amount,
    min: f.number(report.fatRange.min, 0),
    max: f.number(report.fatRange.max, 0),
    obese: f.number(report.fatRange.obese, 0),
    low: f.number(low, 2),
    moderate: f.number(moderate, 2),
  });
  const xiaomi = xiaomiComparable(reading);
  const barFormat = item.key === "bodyFat" || item.key === "muscleIndex" ? (n: number) => f.number(n, item.key === "muscleIndex" ? 2 : 0) : (n: number) => f.number(n);

  return (
    <details open={item.band.status !== "good"} className="group border-t border-line first:border-t-0">
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${ICON_TONE[item.band.status]}`} aria-hidden>
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg leading-snug font-semibold">
            {t(`reportItem.${item.key}` as MessageKey)} <span className="whitespace-nowrap font-bold">{value}</span>
          </span>
          <span className="mt-1 block">
            <StatusBadge band={item.band} />
          </span>
        </span>
        <FiChevronDown size={18} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="pb-4 pl-14">
        <p className="text-sm text-ink-2">{advice}</p>
        {item.key === "muscleIndex" && report.muscleBandsAsGuide && <p className="mt-2 text-sm text-muted">{t("muscleBandsGuide")}</p>}
        {item.key === "waist" && report.waist && (
          <p className="mt-2 text-sm text-muted">{tf("reportWaistFrom", { waist: waistText(report.waist.cm), date: f.date(report.waist.measuredAt) })}</p>
        )}
        {item.key === "bodyFat" && compare && report.bodyFat?.source === "north-america" && xiaomi.bodyFatPct !== null && (
          <p className="mt-2 text-sm text-ink-2">{tf("reportXiaomi", { value: `${f.number(xiaomi.bodyFatPct)} %` })}</p>
        )}
        <RangeBar classification={item} format={barFormat} />
      </div>
    </details>
  );
}

function ChangeBlock({ change, unit }: { change: Change; unit: ProfileDto["unit"] }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const show = (kg: number) => `${f.number(fromKilograms(kg, unit))} ${unit}`;
  const delta = (kg: number) => signed(fromKilograms(kg, unit), (n) => `${f.number(n)} ${unit}`);
  const stats = [
    change.vsMonth && { label: tf("changeVsMonth", { date: f.date(change.vsMonth.measuredAt) }), delta: change.vsMonth.delta },
    change.vsFirst && { label: tf("changeVsFirst", { date: f.date(change.vsFirst.measuredAt) }), delta: change.vsFirst.delta },
  ].filter((s) => s !== null);
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <p className="font-semibold">{t(`change.${change.key}` as MessageKey)}</p>
      {stats.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{t("changeNone")}</p>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label}>
              <dd className="text-xl font-bold">{delta(s.delta)}</dd>
              <dt className="text-xs text-muted">{s.label}</dt>
            </div>
          ))}
        </dl>
      )}
      <Sparkline points={change.points.map((p) => ({ time: p.time, value: p.value }))} label={t(`change.${change.key}` as MessageKey)} format={show} />
    </div>
  );
}

function ScoreExplanation({ report, profile }: { report: ReadingReport; profile: ProfileDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const { low, moderate } = MUSCLE_INDEX_CUTOFFS[profile.sex];
  const partValue = (part: string, v: number) => (part === "bodyFat" ? `${f.number(v)} %` : part === "muscle" ? `${f.number(v)} kg/m²` : f.number(v));
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("scoreHowTitle")}</h2>
      <p className="mt-2 text-sm text-ink-2">{t("scoreHowIntro")}</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-2">
        <li>{tf("scoreHowBodyFat", { min: report.fatRange.min, max: report.fatRange.max, obese: report.fatRange.obese })}</li>
        <li>{t("scoreHowBmi")}</li>
        <li>{tf("scoreHowMuscle", { low: f.number(low, 2), moderate: f.number(moderate, 2) })}</li>
      </ul>
      <p className="mt-3 text-sm font-medium text-ink">{t("scoreHowYours")}</p>
      <ul className="mt-1 space-y-1 text-sm text-ink-2">
        {report.score.parts.map((p) => (
          <li key={p.part}>
            {tf("scoreHowPart", { part: t(`scorePart.${p.part}` as MessageKey), value: partValue(p.part, p.value), points: Math.round(p.score) })}
          </li>
        ))}
      </ul>
      {report.score.parts.length === 1 && <p className="mt-2 text-sm text-ink-2">{t("bodyScoreNoImpedance")}</p>}
      <p className="mt-2 text-sm font-semibold text-ink">{tf("scoreHowTotal", { score: report.score.score })}</p>
      <p className="mt-3 text-sm text-muted">{t("scoreHowNote")}</p>
    </Card>
  );
}

export function ReadingPage({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { id } = useParams();
  const { t, tf } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const [compare] = useCompareXiaomi();
  const index = measurements.findIndex((m) => m.id === id);
  // Opening a weigh-in (or moving to the next one) starts at its score, not where the last page was scrolled.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  const reading = measurements[index];

  if (!reading) {
    return (
      <Card className="text-center">
        <p className="text-ink-2">{t("readingNotFound")}</p>
        <Link to="/historial" className="mt-4 inline-block font-medium text-brand">
          {t("back")}
        </Link>
      </Card>
    );
  }

  const report = readingReport(profile, reading, measurements);
  const changes = recentChanges(profile, reading, measurements);
  const older = measurements[index + 1];
  const newer = measurements[index - 1];
  const na = report.composition;
  const xiaomi = xiaomiComparable(reading);
  // The score trend: the last ten weigh-ins with body composition up to this one, plus this one.
  const at = new Date(reading.measuredAt).getTime();
  const scoreTrend = measurements
    .filter((m) => new Date(m.measuredAt).getTime() <= at && (m.id === reading.id || m.bodyFatPct !== null || m.impedance !== null))
    .slice(0, 10)
    .reverse()
    .map((m) => ({ time: new Date(m.measuredAt).getTime(), value: scoreOf(profile, m).score }));
  const healthy = healthyWeightRange(profile.heightCm);
  const xiaomiLine = (value: string | null) => (compare && value !== null ? tf("reportXiaomi", { value }) : null);
  const others = [
    na && {
      label: t("reportFatAge"),
      value: (() => {
        const r = bodyFatAge(na.bodyFatPct, profile.sex, "mexican-american");
        return r.kind === "over" ? tf("bodyAgeOver", { age: r.age }) : r.kind === "under" ? tf("bodyAgeUnder", { age: r.age }) : tf("bodyAgeYears", { age: r.age });
      })(),
      xiaomi: xiaomiLine(reading.bodyAge === null ? null : tf("bodyAgeYears", { age: reading.bodyAge })),
    },
    na && { label: t("leanSoftMass"), value: f.weight(na.leanSoftKg, profile.unit), xiaomi: xiaomiLine(xiaomi.muscleKg === null ? null : f.weight(xiaomi.muscleKg, profile.unit)) },
    na && { label: t("skeletalMuscle"), value: f.weight(na.skeletalMuscleKg, profile.unit), xiaomi: null },
    na &&
      na.proteinPct !== null && {
        label: t("proteinExperimental"),
        value: `${f.number(na.proteinPct)} %`,
        xiaomi: xiaomiLine(xiaomi.proteinPct === null ? null : `${f.number(xiaomi.proteinPct)} %`),
      },
    na && { label: t("bodyWater"), value: `${f.number(na.bodyWaterPct)} %`, xiaomi: xiaomiLine(xiaomi.bodyWaterPct === null ? null : `${f.number(xiaomi.bodyWaterPct)} %`) },
    na && { label: t("bmrKatch"), value: `${f.number(na.bmrKcal, 0)} kcal`, xiaomi: xiaomiLine(xiaomi.bmrKcal === null ? null : `${f.number(xiaomi.bmrKcal, 0)} kcal`) },
    {
      label: t("healthyWeight"),
      value: `${f.number(fromKilograms(healthy.min, profile.unit))} ${t("rangeTo")} ${f.weight(healthy.max, profile.unit)}`,
      xiaomi: null,
    },
  ].filter((x) => x !== null && x !== false);

  const navButton = "flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition hover:bg-surface-2 active:scale-95 disabled:opacity-30";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <button type="button" className={navButton} onClick={() => navigate(-1)} aria-label={t("back")} title={t("back")}>
          <FiArrowLeft size={22} aria-hidden />
        </button>
        <p className="flex-1 text-center font-medium">{f.dateTime(reading.measuredAt)}</p>
        <button
          type="button"
          className={navButton}
          disabled={!older}
          onClick={() => older && navigate(`/medicion/${older.id}`, { replace: true })}
          aria-label={t("olderReading")}
          title={t("olderReading")}
        >
          <FiChevronLeft size={20} aria-hidden />
        </button>
        <button
          type="button"
          className={navButton}
          disabled={!newer}
          onClick={() => newer && navigate(`/medicion/${newer.id}`, { replace: true })}
          aria-label={t("newerReading")}
          title={t("newerReading")}
        >
          <FiChevronRight size={20} aria-hidden />
        </button>
      </div>

      <Card className="text-center">
        <p className="text-sm font-medium text-ink-2">{t("bodyScoreTitle")}</p>
        <p className="mt-1 text-6xl font-bold tracking-tight">{report.score.score}</p>
        <p className="mt-1 text-ink-2">{f.weight(reading.weightKg, profile.unit)}</p>
        {compare && reading.bodyScore !== null && <p className="mt-1 text-sm text-muted">{tf("bodyScoreXiaomi", { score: f.number(reading.bodyScore, 0) })}</p>}
        <Sparkline points={scoreTrend} label={t("bodyScoreTitle")} format={(n) => f.number(n, 0)} />
      </Card>

      {report.groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <Card key={g.status}>
            <h2 className="mb-1 text-lg font-semibold">{tf(`reportGroup.${g.status}` as MessageKey, { n: g.items.length })}</h2>
            {g.items.map((item) => (
              <ItemRow key={item.key} item={item} report={report} profile={profile} reading={reading} />
            ))}
          </Card>
        ))}

      {!report.waist && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-2">{t("reportNoWaist")}</p>}

      <Card>
        <h2 className="text-lg font-semibold">{t("reportOthers")}</h2>
        <p className="mt-1 text-sm text-muted">{t("reportOthersNote")}</p>
        <dl className="mt-2 divide-y divide-line">
          {others.map((o) => (
            <div key={o.label} className="flex items-baseline justify-between gap-3 py-3">
              <dt className="text-ink-2">{o.label}</dt>
              <dd className="text-right">
                <span className="font-semibold">{o.value}</span>
                {o.xiaomi && <span className="block text-xs text-muted">{o.xiaomi}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {na?.proteinPct !== null && na && <p className="mt-2 text-sm text-muted">{t("proteinNote")}</p>}
      </Card>

      {changes.length > 0 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">{t("reportChanges")}</h2>
          {changes.map((c) => (
            <ChangeBlock key={c.key} change={c} unit={profile.unit} />
          ))}
        </Card>
      )}

      <ScoreExplanation report={report} profile={profile} />
    </div>
  );
}
