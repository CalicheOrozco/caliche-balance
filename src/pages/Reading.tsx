import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { FiCheck, FiChevronLeft, FiChevronRight, FiEdit3 } from "react-icons/fi";
import { useNavigate, useParams } from "react-router";
import { metabolicAge } from "../../shared/bodyAge.ts";
import { MUSCLE_INDEX_CUTOFFS, xiaomiComparable } from "../../shared/composition.ts";
import { type Change, type ReadingReport, type ReportItem, readingReport, recentChanges } from "../../shared/report.ts";
import { healthyWeightRange, type Status } from "../../shared/reference.ts";
import { CM_PER_IN, fromKilograms, type MeasurementDto, NOTE_MAX_LENGTH, type ProfileDto } from "../../shared/schemas.ts";
import { scoreOf } from "../../shared/score.ts";
import { api } from "../api.ts";
import { convertWaist, useWaistUnit, WaistUnitToggle } from "../units.tsx";
import { useAdvice } from "../advice.ts";
import { Spark } from "../charts.tsx";
import { useCompareXiaomi } from "../compare.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { BackLink, Button, Card, Field, GroupLabel, IconButton, Modal, RangeBar, Rings, StatusBadge, signed, useFormat } from "../ui.tsx";
import { isFull, useItemText } from "./Body.tsx";

/** A rated measure outside the healthy range: big value, banded scale and what it means. */
function WatchCard({ item, report, profile, reading }: { item: ReportItem; report: ReadingReport; profile: ProfileDto; reading: MeasurementDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const [compare] = useCompareXiaomi();
  const text = useItemText(profile)(item, report);
  const advice = useAdvice(profile)(item, report);
  const xiaomi = xiaomiComparable(reading);
  const waistUnit = profile.unit === "lb" ? "in" : "cm";
  const waistText = (cm: number) => (waistUnit === "in" ? `${f.number(cm / CM_PER_IN)} in` : `${f.number(cm, 0)} cm`);
  return (
    <Card className="flex flex-col gap-2.5 p-4.5!">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-extrabold">{text.label}</span>
        <StatusBadge band={item.band} />
      </div>
      <span className="text-[32px] leading-9 font-extrabold">
        {text.value}
        {text.unit && <span className="text-lg text-muted"> {text.unit}</span>}
      </span>
      <RangeBar classification={item} format={(n) => f.number(n)} labels="names" />
      <p className="text-[13px] leading-4.75 font-semibold text-ink-2">{advice}</p>
      {item.key === "muscleIndex" && report.muscleBandsAsGuide && <p className="text-[13px] font-semibold text-muted">{t("muscleBandsGuide")}</p>}
      {item.key === "waist" && report.waist && (
        <p className="text-[13px] font-semibold text-muted">{tf("reportWaistFrom", { waist: waistText(report.waist.cm), date: f.date(report.waist.measuredAt) })}</p>
      )}
      {item.key === "bodyFat" && compare && report.bodyFat?.source === "north-america" && xiaomi.bodyFatPct !== null && (
        <p className="text-[13px] font-semibold text-muted">{tf("reportXiaomi", { value: `${f.number(xiaomi.bodyFatPct)} %` })}</p>
      )}
    </Card>
  );
}

/** "vs. 1 month ago" and "vs. first" for weight, fat mass and muscle, colored by whether it helps. */
function ChangesTable({ changes, unit }: { changes: Change[]; unit: ProfileDto["unit"] }) {
  const { t } = useI18n();
  const f = useFormat();
  const cell = (key: Change["key"], delta: number | undefined) => {
    if (delta === undefined) return { text: "-", tone: "text-muted" };
    const value = fromKilograms(delta, unit);
    const better = key === "skeletalMuscle" ? value > 0.05 : value < -0.05;
    const worse = key === "skeletalMuscle" ? value < -0.05 : value > 0.05;
    return { text: signed(value, (n) => `${f.number(n)} ${unit}`), tone: better ? "text-good-text" : worse ? "text-warn-text" : "text-ink-2" };
  };
  return (
    <Card className="px-4! py-1.5!">
      <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 py-2.5 text-xs font-extrabold text-muted">
        <span />
        <span className="text-right">{t("reading.vsMonth")}</span>
        <span className="text-right">{t("reading.vsFirst")}</span>
      </div>
      {changes.map((c) => {
        const m = cell(c.key, c.vsMonth?.delta);
        const first = cell(c.key, c.vsFirst?.delta);
        return (
          <div key={c.key} className="grid min-h-11 grid-cols-[1.4fr_1fr_1fr] items-center gap-2 border-t border-line text-sm font-bold">
            <span className="text-ink-2">{t(`change.${c.key}` as MessageKey)}</span>
            <span className={`text-right ${m.tone}`}>{m.text}</span>
            <span className={`text-right ${first.tone}`}>{first.text}</span>
          </div>
        );
      })}
    </Card>
  );
}

function ScoreExplanation({ report, profile }: { report: ReadingReport; profile: ProfileDto }) {
  const { t, tf } = useI18n();
  const f = useFormat();
  const { low, moderate } = MUSCLE_INDEX_CUTOFFS[profile.sex];
  const partValue = (part: string, v: number) => (part === "bodyFat" ? `${f.number(v)} %` : part === "muscle" ? `${f.number(v)} kg/m²` : f.number(v));
  return (
    <div className="text-sm text-ink-2">
      <p>{t("scoreHowIntro")}</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>{tf("scoreHowBodyFat", { min: report.fatRange.min, max: report.fatRange.max, obese: report.fatRange.obese })}</li>
        <li>{t("scoreHowBmi")}</li>
        <li>{tf("scoreHowMuscle", { low: f.number(low, 2), moderate: f.number(moderate, 2) })}</li>
      </ul>
      <p className="mt-3 font-bold text-ink">{t("scoreHowYours")}</p>
      <ul className="mt-1 space-y-1">
        {report.score.parts.map((p) => (
          <li key={p.part}>
            {tf("scoreHowPart", { part: t(`scorePart.${p.part}` as MessageKey), value: partValue(p.part, p.value), points: Math.round(p.score) })}
          </li>
        ))}
      </ul>
      {report.score.parts.length === 1 && <p className="mt-2">{t("bodyScoreNoImpedance")}</p>}
      <p className="mt-2 font-bold text-ink">{tf("scoreHowTotal", { score: report.score.score })}</p>
      <p className="mt-3 text-muted">{t("scoreHowNote")}</p>
    </div>
  );
}

const TILE: Record<Status, string> = { bad: "bg-bad-soft text-bad-text", warn: "bg-warn-soft text-warn-text", good: "bg-good-soft text-good-text" };

export function ReadingPage({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { id } = useParams();
  const { t, tf } = useI18n();
  const f = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [compare] = useCompareXiaomi();
  const itemText = useItemText(profile);
  const [explain, setExplain] = useState(false);
  const closeExplain = useCallback(() => setExplain(false), []);
  const [waistOpen, setWaistOpen] = useState(false);
  const [waistValue, setWaistValue] = useState("");
  const index = measurements.findIndex((m) => m.id === id);
  // Opening a weigh-in (or moving to the next one) starts at the top, not where the last page was scrolled.
  useEffect(() => {
    window.scrollTo(0, 0);
    setWaistOpen(false);
  }, [id]);
  const reading = measurements[index];
  const unit = profile.unit;
  const [waistUnit, setWaistUnit] = useWaistUnit(unit);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["measurements"] });
  const leave = () => {
    navigate("/cuerpo/pesadas", { replace: true });
    void refresh();
  };
  const remove = useMutation({ mutationFn: api.deleteMeasurement, onSuccess: leave });
  const notMine = useMutation({ mutationFn: api.notMine, onSuccess: leave });
  const saveWaist = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => api.setWaist(id, value.trim() ? value : null, waistUnit),
    onSuccess: () => {
      setWaistOpen(false);
      void refresh();
    },
  });

  if (!reading) {
    return (
      <div className="flex flex-col gap-3.5">
        <BackLink to="/cuerpo" label={t("nav.body")} />
        <Card className="text-center">
          <p className="font-semibold text-ink-2">{t("readingNotFound")}</p>
        </Card>
      </div>
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
    .filter((m) => new Date(m.measuredAt).getTime() <= at && (m.id === reading.id || isFull(m)))
    .slice(0, 10)
    .reverse()
    .map((m) => scoreOf(profile, m).score);
  const healthy = healthyWeightRange(profile.heightCm);
  const xiaomiLine = (value: string | null) => (compare && value !== null ? tf("reportXiaomi", { value }) : null);
  const others = [
    na && {
      label: t("reportFatAge"),
      value: (() => {
        const r = metabolicAge({ fatPct: na.bodyFatPct, weightKg: reading.weightKg, age: report.age, sex: profile.sex });
        return r.kind === "over" ? tf("bodyAgeOver", { age: r.age }) : r.kind === "under" ? tf("bodyAgeUnder", { age: r.age }) : tf("bodyAgeYears", { age: r.age });
      })(),
      xiaomi: xiaomiLine(reading.bodyAge === null ? null : tf("bodyAgeYears", { age: reading.bodyAge })),
    },
    na && { label: t("leanSoftMass"), value: f.weight(na.leanSoftKg, unit), xiaomi: xiaomiLine(xiaomi.muscleKg === null ? null : f.weight(xiaomi.muscleKg, unit)) },
    na && { label: t("skeletalMuscle"), value: f.weight(na.skeletalMuscleKg, unit), xiaomi: null },
    na && { label: t("fatFreeMass"), value: f.weight(na.fatFreeMassKg, unit), xiaomi: xiaomiLine(xiaomi.fatFreeMassKg === null ? null : f.weight(xiaomi.fatFreeMassKg, unit)) },
    na &&
      na.proteinPct !== null && {
        label: t("proteinExperimental"),
        value: `${f.number(na.proteinPct)} %`,
        xiaomi: xiaomiLine(xiaomi.proteinPct === null ? null : `${f.number(xiaomi.proteinPct)} %`),
      },
    na && { label: t("bodyWater"), value: `${f.number(na.bodyWaterPct)} %`, xiaomi: xiaomiLine(xiaomi.bodyWaterPct === null ? null : `${f.number(xiaomi.bodyWaterPct)} %`) },
    na && { label: t("bmrKatch"), value: `${f.number(na.bmrKcal, 0)} kcal`, xiaomi: xiaomiLine(xiaomi.bmrKcal === null ? null : `${f.number(xiaomi.bmrKcal, 0)} kcal`) },
    reading.boneKg !== null && compare && { label: t("bone"), value: `Xiaomi: ${f.weight(reading.boneKg, unit)}`, xiaomi: null },
    {
      label: t("healthyWeight"),
      value: `${f.number(fromKilograms(healthy.min, unit))} ${t("rangeTo")} ${f.weight(healthy.max, unit)}`,
      xiaomi: null,
    },
  ].filter((x) => x !== null && x !== false);

  const count = (status: Status) => report.groups.find((g) => g.status === status)!.items.length;
  const groupOf = (status: Status) => report.groups.find((g) => g.status === status)!.items;
  const source = reading.source === "zepp" ? t("reading.sourceZepp") : t("source.manual");
  const day = f.longDay(new Date(reading.measuredAt));

  return (
    <div className="flex flex-col gap-3.5">
      <BackLink to="/cuerpo" label={t("nav.body")}>
        <div className="flex gap-2">
          <IconButton label={t("olderReading")} disabled={!older} onClick={() => older && navigate(`/medicion/${older.id}`, { replace: true })}>
            <FiChevronLeft size={18} strokeWidth={2.4} aria-hidden />
          </IconButton>
          <IconButton label={t("newerReading")} disabled={!newer} onClick={() => newer && navigate(`/medicion/${newer.id}`, { replace: true })}>
            <FiChevronRight size={18} strokeWidth={2.4} aria-hidden />
          </IconButton>
        </div>
      </BackLink>

      <div className="flex flex-col gap-0.5 px-1">
        <p className="text-[13px] font-bold text-muted">
          <span className="inline-block first-letter:uppercase">{day}</span> · {f.time(reading.measuredAt)} · {source}
        </p>
        <h1 className="text-[44px] leading-12.5 font-extrabold tracking-[-0.03em]">
          {f.number(fromKilograms(reading.weightKg, unit))} <span className="text-xl text-muted">{unit}</span>
        </h1>
      </div>

      <NoteCard reading={reading} />

      <div className="grid grid-cols-3 gap-2">
        {(["bad", "warn", "good"] as const).map((s) => (
          <div key={s} className={`flex flex-col gap-0.5 rounded-[18px] p-3 ${TILE[s]}`}>
            <span className="text-2xl font-extrabold">{count(s)}</span>
            <span className="text-xs font-bold">{t(`reading.count.${s}` as MessageKey)}</span>
          </div>
        ))}
      </div>

      {groupOf("bad").length > 0 && <GroupLabel className="text-bad-text">{t("reading.count.bad")}</GroupLabel>}
      {groupOf("bad").map((item) => (
        <WatchCard key={item.key} item={item} report={report} profile={profile} reading={reading} />
      ))}
      {groupOf("warn").length > 0 && <GroupLabel className="text-warn-text">{t("reading.count.warn")}</GroupLabel>}
      {groupOf("warn").map((item) => (
        <WatchCard key={item.key} item={item} report={report} profile={profile} reading={reading} />
      ))}

      {groupOf("good").length > 0 && (
        <>
          <GroupLabel className="text-good-text">{t("reading.count.good")}</GroupLabel>
          <Card padded={false}>
            {groupOf("good").map((item) => {
              const text = itemText(item, report);
              return (
                <div key={item.key} className="flex min-h-15 items-center gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-good-soft text-good-text">
                    <FiCheck size={14} strokeWidth={3} aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-bold">{text.label}</span>
                    <span className="text-xs font-semibold text-muted">{text.hint}</span>
                  </span>
                  <span className="text-[15px] font-extrabold whitespace-nowrap">
                    {text.value}
                    {text.unit && ` ${text.unit}`}
                  </span>
                </div>
              );
            })}
          </Card>
        </>
      )}

      <GroupLabel>{t("reportOthers")}</GroupLabel>
      <Card padded={false}>
        <p className="px-4 pt-3.5 text-xs font-semibold text-muted">{t("reportOthersNote")}</p>
        {others.map((o) => (
          <div key={o.label} className="flex min-h-14 items-center justify-between gap-3 border-t border-line px-4 py-2.5 first-of-type:border-t-0">
            <span className="text-sm font-bold text-ink-2">{o.label}</span>
            <span className="text-right">
              <span className="text-[15px] font-extrabold">{o.value}</span>
              {o.xiaomi && <span className="block text-xs font-semibold text-muted">{o.xiaomi}</span>}
            </span>
          </div>
        ))}
        {na?.proteinPct != null && <p className="border-t border-line px-4 py-3 text-xs font-semibold text-muted">{t("proteinNote")}</p>}
      </Card>

      {changes.length > 0 && (
        <>
          <GroupLabel>{t("reportChanges")}</GroupLabel>
          <ChangesTable changes={changes} unit={unit} />
        </>
      )}

      <Card className="flex items-center gap-4">
        <Rings rings={[{ fraction: report.score.score / 100, className: "stroke-brand" }]} size={68} stroke={7}>
          <span className="text-xl font-extrabold">{report.score.score}</span>
        </Rings>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[15px] font-extrabold">{t("bodyScoreTitle")}</p>
          {compare && reading.bodyScore !== null && <p className="text-xs font-semibold text-muted">{tf("bodyScoreXiaomi", { score: f.number(reading.bodyScore, 0) })}</p>}
          {scoreTrend.length > 1 && <Spark values={scoreTrend} height={32} />}
        </div>
      </Card>

      {reading.waistCm === null && !report.waist && !waistOpen && (
        <section className="flex items-center gap-3.5 rounded-3xl border border-dashed border-line-strong bg-surface p-4.5">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-extrabold">{t("reading.addWaistTitle")}</span>
            <span className="text-[13px] font-semibold text-muted">{t("reading.addWaistBody")}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setWaistValue("");
              setWaistOpen(true);
            }}
            className="inline-flex h-10 shrink-0 items-center rounded-full bg-brand px-4 text-sm font-extrabold text-brand-ink active:scale-95"
          >
            {t("reading.add")}
          </button>
        </section>
      )}
      {waistOpen && (
        <Card>
          <form
            className="flex items-end gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveWaist.mutate({ id: reading.id, value: waistValue });
            }}
          >
            <div className="min-w-0 flex-1">
              <Field label={`${t("waist")} (${waistUnit})`} inputMode="decimal" value={waistValue} onChange={(e) => setWaistValue(e.target.value)} autoFocus />
            </div>
            <div className="pb-1.5">
              <WaistUnitToggle
                unit={waistUnit}
                onChange={(u) => {
                  setWaistValue(convertWaist(waistValue, waistUnit, u));
                  setWaistUnit(u);
                }}
              />
            </div>
            <Button type="submit" disabled={saveWaist.isPending} className="min-h-13.5">
              {t("save")}
            </Button>
          </form>
        </Card>
      )}

      <div className="flex gap-2.5">
        <Button variant="secondary" className="flex-1" onClick={() => setExplain(true)}>
          {t("reading.howScore")}
        </Button>
        <Button
          variant="dangerText"
          disabled={remove.isPending}
          onClick={() => {
            if (confirm(t("deleteMeasurementConfirm"))) remove.mutate(reading.id);
          }}
        >
          {t("delete")}
        </Button>
      </div>
      <div className="flex flex-wrap justify-center gap-x-2">
        {reading.waistCm !== null && !waistOpen && (
          <Button
            variant="subtle"
            onClick={() => {
              setWaistValue(String(Math.round((waistUnit === "in" ? reading.waistCm! / CM_PER_IN : reading.waistCm!) * 10) / 10));
              setWaistOpen(true);
            }}
          >
            {t("reading.editWaist")}
          </Button>
        )}
        {reading.source === "zepp" && (
          <Button
            variant="subtle"
            disabled={notMine.isPending}
            onClick={() => {
              if (confirm(t("notMineConfirm"))) notMine.mutate(reading.id);
            }}
          >
            {t("notMine")}
          </Button>
        )}
      </div>
      {!isFull(reading) && (
        <p className="text-center text-[13px] font-semibold text-muted">{t("reading.weightOnlyNote")}</p>
      )}

      {explain && (
        <Modal title={t("scoreHowTitle")} onClose={closeExplain}>
          <ScoreExplanation report={report} profile={profile} />
        </Modal>
      )}
    </div>
  );
}

/** The person's own note on this weigh-in: shown, added, changed or removed in place. */
function NoteCard({ reading }: { reading: MeasurementDto }) {
  const { t, te } = useI18n();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reading.note ?? "");
  // Moving to another weigh-in with the arrows reuses this component.
  useEffect(() => {
    setEditing(false);
    setValue(reading.note ?? "");
  }, [reading.id, reading.note]);
  const save = useMutation({
    mutationFn: (note: string | null) => api.setNote(reading.id, note),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["measurements"] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <form
        className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate(value.trim() || null);
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm font-bold text-ink-2">{t("body.noteTitle")}</span>
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, NOTE_MAX_LENGTH))}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            placeholder={t("body.noteAddHint")}
            className="w-full resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 font-semibold text-ink outline-none placeholder:font-medium placeholder:text-muted focus:border-2 focus:border-brand"
          />
        </label>
        {save.error && <p className="text-sm font-semibold text-bad-text">{te(save.error)}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending} className="flex-1">
            {t("body.noteSave")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
            {t("body.noteCancel")}
          </Button>
          {reading.note && (
            <Button type="button" variant="dangerText" disabled={save.isPending} onClick={() => save.mutate(null)}>
              {t("body.noteRemove")}
            </Button>
          )}
        </div>
      </form>
    );
  }
  return reading.note ? (
    <section className="flex items-start gap-3 rounded-3xl border border-line bg-surface p-4 shadow-card">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-extrabold tracking-[0.06em] text-muted uppercase">{t("body.noteTitle")}</span>
        <p className="text-[15px] leading-5.25 font-semibold wrap-break-word text-ink">{reading.note}</p>
      </div>
      <IconButton label={t("body.noteEdit")} onClick={() => setEditing(true)}>
        <FiEdit3 size={18} aria-hidden />
      </IconButton>
    </section>
  ) : (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-3 rounded-3xl border border-dashed border-line-strong bg-surface p-4 text-left transition active:scale-[0.99]"
    >
      <FiEdit3 size={18} className="shrink-0 text-brand-text" aria-hidden />
      <span className="flex flex-col">
        <span className="text-[15px] font-extrabold">{t("body.noteAdd")}</span>
        <span className="text-[13px] font-semibold text-muted">{t("body.noteAddHint")}</span>
      </span>
    </button>
  );
}
