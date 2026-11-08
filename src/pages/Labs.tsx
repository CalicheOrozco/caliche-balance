import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from "react";
import { FiAlertTriangle, FiCalendar, FiChevronDown, FiChevronRight, FiFileText, FiInfo, FiPlus, FiX } from "react-icons/fi";
import { Link, useNavigate, useParams } from "react-router";
import { bodyFatOf } from "../../shared/composition.ts";
import {
  assess,
  egfr,
  type LabAssessment,
  type LabPerson,
  type LabResult,
  type LabStatus,
  type LabStudyDto,
  LAB_GROUPS,
  labTest,
  nextStudyDue,
  nonHdl,
  type ParsedStudy,
} from "../../shared/labs.ts";
import { ageAt, bodyFatBands } from "../../shared/reference.ts";
import type { MeasurementDto, ProfileDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { BackLink, Button, Callout, Card, Field, GroupLabel, SectionHeader, StatusPill, useFormat } from "../ui.tsx";
import { BodyTop, isFull } from "./Body.tsx";

export function useLabs() {
  return useQuery({ queryKey: ["labs"], queryFn: api.labs });
}

/** How old the person was on the day of the study, for the cutoffs that depend on age and sex. */
function personAt(profile: ProfileDto, takenAt: string): LabPerson {
  return { sex: profile.sex, age: ageAt(new Date(`${profile.birthDate}T00:00:00Z`), new Date(`${takenAt}T12:00:00Z`)) };
}

/** The test's name in the person's language, or the one the lab printed. */
function useLabName() {
  const { lang } = useI18n();
  return (r: Pick<LabResult, "key" | "name">) => labTest(r.key)?.[lang] ?? r.name;
}

/** Values as precise as labs print them: no decimals for whole numbers, up to two otherwise. */
function useLabValue() {
  const { locale } = useI18n();
  return (r: Pick<LabResult, "value" | "text" | "unit">, withUnit = true) => {
    const value = r.value === null ? (r.text ?? "-") : r.value.toLocaleString(locale, { maximumFractionDigits: 2 });
    return withUnit && r.unit && r.value !== null ? `${value} ${r.unit}` : value;
  };
}

/** A result in words too long to sit beside its name, like a cardiologist's written findings. */
const isLong = (r: Pick<LabResult, "text">) => (r.text?.length ?? 0) > 24;

function useStudyDate() {
  const { locale } = useI18n();
  return (iso: string, style: "long" | "short" = "long") =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: style, year: "numeric" });
}

interface Judged {
  result: LabResult;
  a: LabAssessment;
}

function judge(study: Pick<LabStudyDto, "results">, person: LabPerson): Judged[] {
  return study.results.map((result) => ({ result, a: assess(result, person) }));
}

function counts(judged: Judged[]) {
  return {
    good: judged.filter((j) => j.a.status === "good").length,
    warn: judged.filter((j) => j.a.status === "warn").length,
    bad: judged.filter((j) => j.a.status === "bad").length,
  };
}

const TILE: Record<LabStatus, string> = { bad: "bg-bad-soft text-bad-text", warn: "bg-warn-soft text-warn-text", good: "bg-good-soft text-good-text" };

/** When the next yearly study is due, as a reminder card. */
function NextStudy({ latest }: { latest: string }) {
  const { tf, t } = useI18n();
  const date = useStudyDate();
  const due = nextStudyDue(latest);
  // A month ahead is when to book it.
  const soon = Date.parse(`${due}T12:00:00`) - Date.now() < 31 * 86_400_000;
  return (
    <Callout icon={FiCalendar} tone={soon ? "brand" : "neutral"}>
      <strong className="text-ink">{soon ? tf("labs.nextDue", { date: date(latest) }) : tf("labs.next", { date: date(due) })}</strong>
      <span className="mt-0.5 block">{t("labs.nextHint")}</span>
    </Callout>
  );
}

/** Body > Studies: every lab study, newest first, and the way to add one. */
export function LabsPage({ profile }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf } = useI18n();
  const date = useStudyDate();
  const studies = useLabs().data ?? [];
  const latest = studies[0];
  return (
    <div className="flex flex-col gap-3.5">
      <BodyTop subtitle={latest ? tf("labs.subtitle", { n: studies.length, date: date(latest.takenAt, "short") }) : t("labs.subtitleNone")} />
      {latest && <NextStudy latest={latest.takenAt} />}
      <Link to="/estudios/nuevo" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-extrabold text-brand-ink">
        <FiPlus size={18} strokeWidth={2.6} aria-hidden />
        {t("labs.add")}
      </Link>
      {studies.length === 0 ? (
        <Card className="flex flex-col gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-text">
            <FiFileText size={22} aria-hidden />
          </span>
          <h2 className="text-lg font-extrabold">{t("labs.emptyTitle")}</h2>
          <p className="text-[15px] font-medium text-ink-2">{t("labs.emptyBody")}</p>
        </Card>
      ) : (
        <>
          <KeyMarkers studies={studies} />
          <div className="flex flex-col gap-2.5">
            {studies.map((s) => {
              const c = counts(judge(s, personAt(profile, s.takenAt)));
              return (
                <Link key={s.id} to={`/estudios/${s.id}`} className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-ink shadow-card">
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="text-[15px] font-extrabold">{date(s.takenAt)}</span>
                    <span className="text-xs font-semibold text-muted">
                      {s.lab} · {tf("labs.countsShort", { n: s.results.length })}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {(["bad", "warn", "good"] as const).map((k) =>
                        c[k] > 0 ? (
                          <span key={k} className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${TILE[k]}`}>
                            {c[k]} {t(`labs.status.${k}` as MessageKey).toLowerCase()}
                          </span>
                        ) : null,
                      )}
                    </span>
                  </span>
                  <FiChevronRight size={18} strokeWidth={2.4} className="shrink-0 text-muted" aria-hidden />
                </Link>
              );
            })}
          </div>
        </>
      )}
      <p className="px-1 text-xs font-semibold text-muted">{t("labs.disclaimer")}</p>
    </div>
  );
}

const KEY_MARKERS = ["glucose", "hba1c", "cholesterol", "ldl", "hdl", "triglycerides", "creatinine", "uricAcid", "alt", "hemoglobin"];

/** The markers that matter most, across the last studies: how each one moved year to year. */
function KeyMarkers({ studies }: { studies: LabStudyDto[] }) {
  const name = useLabName();
  const value = useLabValue();
  const date = useStudyDate();
  const shown = studies.slice(0, 3);
  const rows = KEY_MARKERS.flatMap((key) => {
    const cells = shown.map((s) => s.results.find((r) => r.key === key && r.value !== null) ?? null);
    const first = cells.find((c) => c !== null);
    return first ? [{ key, first, cells }] : [];
  });
  if (rows.length === 0) return null;
  return (
    <Card className="px-4! py-2!">
      <div className="grid gap-x-2 border-b border-line py-2.5 text-[11px] font-extrabold text-muted" style={{ gridTemplateColumns: `1.6fr repeat(${shown.length}, 1fr)` }}>
        <span />
        {shown.map((s) => (
          <span key={s.id} className="text-right">
            {date(s.takenAt, "short")}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid min-h-11 items-center gap-x-2 border-t border-line text-sm first-of-type:border-t-0"
          style={{ gridTemplateColumns: `1.6fr repeat(${shown.length}, 1fr)` }}
        >
          <span className="font-semibold text-ink-2">{name(row.first)}</span>
          {row.cells.map((c, i) => (
            <span key={i} className={`text-right ${i === 0 ? "font-extrabold" : "font-semibold text-ink-2"}`}>
              {c ? value(c, false) : "-"}
            </span>
          ))}
        </div>
      ))}
    </Card>
  );
}

/** One result with what it means: value, status, the explanation, the lab's range and last year's value. */
function ResultCard({ j, before, beforeDate }: { j: Judged; before: LabResult | null; beforeDate: string | null }) {
  const { t, tf } = useI18n();
  const name = useLabName();
  const value = useLabValue();
  const date = useStudyDate();
  const { result, a } = j;
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[15px] font-extrabold">{name(result)}</span>
        <StatusPill status={a.status}>{t(`labs.status.${a.status}` as MessageKey)}</StatusPill>
      </div>
      <span className={isLong(result) ? "text-[15px] leading-5 font-bold" : "text-[28px] leading-8 font-extrabold"}>{value(result)}</span>
      {a.note && <p className="text-[13px] leading-4.75 font-semibold text-ink-2">{tf(`lab.note.${a.note}` as MessageKey, a.vars)}</p>}
      <p className="text-xs font-semibold text-muted">
        {[
          result.ref ? tf("labs.labRange", { ref: result.ref }) : null,
          result.flagged ? t("labs.labFlagged") : null,
          a.source ? tf("labs.source", { source: a.source }) : null,
          before && beforeDate ? tf("labs.before", { value: value(before), date: date(beforeDate, "short") }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Card>
  );
}

/** Several urine findings that usually come from how the sample was taken, explained once. */
function UrineSampleCard({ items }: { items: Judged[] }) {
  const { t } = useI18n();
  const name = useLabName();
  const value = useLabValue();
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[15px] font-extrabold">{t("labs.urineSampleTitle")}</span>
        <StatusPill status="warn">{t("labs.status.warn")}</StatusPill>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((j) => (
          <li key={j.result.key} className="flex justify-between gap-3 text-sm">
            <span className="font-semibold text-ink-2">{name(j.result)}</span>
            <span className="font-extrabold">{value(j.result)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[13px] leading-4.75 font-semibold text-ink-2">{t("lab.note.urineSample")}</p>
    </Card>
  );
}

/** A row of the full list, opening to the same explanation as the cards above. */
function ResultRow({ j, before }: { j: Judged; before: LabResult | null }) {
  const { t, tf } = useI18n();
  const name = useLabName();
  const value = useLabValue();
  const { result, a } = j;
  const hasMore = Boolean(a.note || result.ref || before);
  return (
    <details className="group border-t border-line first:border-t-0">
      <summary className={`flex min-h-13 list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden ${hasMore ? "cursor-pointer" : ""}`}>
        {isLong(result) ? (
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold text-ink-2">{name(result)}</span>
            <span className="text-sm font-bold">{value(result)}</span>
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-sm font-semibold text-ink-2">{name(result)}</span>
            <span className="text-[15px] font-extrabold">{value(result)}</span>
          </>
        )}
        {a.status !== "good" ? (
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.status === "bad" ? "bg-bad" : "bg-warn"}`} aria-label={t(`labs.status.${a.status}` as MessageKey)} />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0" aria-hidden />
        )}
        {hasMore && <FiChevronDown size={16} strokeWidth={2.4} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />}
      </summary>
      {hasMore && (
        <div className="flex flex-col gap-1 px-4 pb-3 text-[13px] font-semibold text-muted">
          {a.note && <p className="text-ink-2">{tf(`lab.note.${a.note}` as MessageKey, a.vars)}</p>}
          {result.ref && <p>{tf("labs.labRange", { ref: result.ref })}</p>}
          {before && <p>{tf("labs.beforeShort", { value: value(before) })}</p>}
        </div>
      )}
    </details>
  );
}

/** One study: what matters most, values the app works out, changes since the last study, and every result. */
export function LabStudyPage({ profile, measurements }: { profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { id } = useParams();
  const { t, tf } = useI18n();
  const f = useFormat();
  const date = useStudyDate();
  const name = useLabName();
  const value = useLabValue();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useLabs();
  const studies = query.data ?? [];
  const index = studies.findIndex((s) => s.id === id);
  const study = studies[index];
  const previous = studies.slice(index + 1)[0] ?? null;
  const remove = useMutation({
    mutationFn: () => api.deleteLab(id!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      navigate("/cuerpo/estudios", { replace: true });
    },
  });

  if (!study) {
    return (
      <div className="flex flex-col gap-3.5">
        <BackLink to="/cuerpo/estudios" label={t("labs.back")} />
        {!query.isPending && <Card className="text-center font-semibold text-ink-2">{t("labs.notFound")}</Card>}
      </div>
    );
  }

  const person = personAt(profile, study.takenAt);
  const judged = judge(study, person);
  const c = counts(judged);
  const beforeOf = (r: LabResult) => previous?.results.find((p) => p.key === r.key && (p.value !== null || p.text !== null)) ?? null;
  const priorities = judged.filter((j) => j.a.status !== "good").sort((x, y) => (x.a.status === y.a.status ? 0 : x.a.status === "bad" ? -1 : 1));
  // Turbid urine, bacteria, crystals and urates share one likely cause (the sample), so they share one card.
  const sampleNotes = priorities.filter((j) => j.a.note === "urineSample");
  const creatinine = study.results.find((r) => r.key === "creatinine")?.value ?? null;
  const filtration = creatinine !== null ? Math.round(egfr(creatinine, person)) : null;
  const nonHdlValue = nonHdl(study.results);
  const nonHdlStatus: LabStatus | null = nonHdlValue === null ? null : nonHdlValue < 130 ? "good" : nonHdlValue < 160 ? "warn" : "bad";
  // Body fat links lipids to the scale: lowering it is what moves HDL, triglycerides and LDL most.
  const lipidsToWatch = judged.some((j) => ["hdl", "ldl", "triglycerides", "cholesterol"].includes(j.result.key) && j.a.status !== "good");
  const full = measurements.find(isFull);
  const fat = full ? bodyFatOf(profile, full) : null;
  const fatHealthyMax = bodyFatBands(profile.sex, person.age).find((b) => b.key === "healthy")?.max ?? null;
  const showBodyLink = lipidsToWatch && fat && fatHealthyMax !== null && fat.value > fatHealthyMax;
  const changes = previous
    ? study.results.filter((r) => r.value !== null && r.group === "blood").flatMap((r) => {
        const b = beforeOf(r);
        return b && b.value !== null && b.value !== r.value ? [{ r, b }] : [];
      })
    : [];
  const groups = LAB_GROUPS.filter((g) => judged.some((j) => j.result.group === g));
  const isLatest = index === 0;

  return (
    <div className="flex flex-col gap-3.5">
      <BackLink to="/cuerpo/estudios" label={t("labs.back")} />
      <div className="flex flex-col gap-0.5 px-1">
        <p className="text-[13px] font-bold text-muted">{study.lab}</p>
        <h1 className="text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{date(study.takenAt)}</h1>
        <p className="text-[13px] font-semibold text-muted">{tf("labs.counts", { good: c.good, warn: c.warn, bad: c.bad })}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["bad", "warn", "good"] as const).map((s) => (
          <div key={s} className={`flex flex-col gap-0.5 rounded-[18px] p-3 ${TILE[s]}`}>
            <span className="text-2xl font-extrabold">{c[s]}</span>
            <span className="text-xs font-bold">{t(`labs.status.${s}` as MessageKey)}</span>
          </div>
        ))}
      </div>

      <GroupLabel>{t("labs.priorities")}</GroupLabel>
      {priorities.length === 0 ? (
        <Callout icon={FiInfo} tone="brand">
          {t("labs.allGood")}
        </Callout>
      ) : (
        <>
          {priorities
            .filter((j) => j.a.note !== "urineSample")
            .map((j) => (
              <ResultCard key={j.result.key} j={j} before={beforeOf(j.result)} beforeDate={previous?.takenAt ?? null} />
            ))}
          {sampleNotes.length > 0 && <UrineSampleCard items={sampleNotes} />}
        </>
      )}
      {showBodyLink && (
        <Callout icon={FiAlertTriangle} tone="neutral">
          {tf("labs.bodyLink", { fat: f.number(fat!.value) })}
        </Callout>
      )}

      {(filtration !== null || nonHdlValue !== null) && (
        <>
          <GroupLabel>{t("labs.computed")}</GroupLabel>
          <Card padded={false}>
            {filtration !== null && (
              <div className="flex flex-col gap-1 border-t border-line px-4 py-3 first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-bold">{t("labs.egfr")}</span>
                  <span className="text-[15px] font-extrabold">{filtration} mL/min</span>
                </div>
                <p className="text-xs font-semibold text-muted">{t("labs.egfrHint")}</p>
              </div>
            )}
            {nonHdlValue !== null && nonHdlStatus && (
              <div className="flex flex-col gap-1 border-t border-line px-4 py-3 first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-bold">{t("labs.nonHdl")}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-extrabold">{f.number(nonHdlValue, 0)} mg/dL</span>
                    {nonHdlStatus !== "good" && <span className={`h-2.5 w-2.5 rounded-full ${nonHdlStatus === "bad" ? "bg-bad" : "bg-warn"}`} aria-hidden />}
                  </span>
                </div>
                <p className="text-xs font-semibold text-muted">{t(`labs.nonHdl.${nonHdlStatus}` as MessageKey)}</p>
              </div>
            )}
          </Card>
        </>
      )}

      {previous && (
        <>
          <GroupLabel>{tf("labs.changes", { date: date(previous.takenAt, "short") })}</GroupLabel>
          <Card padded={false}>
            {changes.map(({ r, b }) => {
              const delta = r.value! - b.value!;
              return (
                <div key={r.key} className="flex min-h-11 items-center gap-3 border-t border-line px-4 py-2 text-sm first:border-t-0">
                  <span className="min-w-0 flex-1 font-semibold text-ink-2">{name(r)}</span>
                  <span className="font-semibold text-muted">{value(b, false)}</span>
                  <FiChevronRight size={14} className="shrink-0 text-muted" aria-hidden />
                  <span className="font-extrabold">{value(r, false)}</span>
                  <span className="w-14 shrink-0 text-right text-xs font-bold text-ink-2">
                    {delta > 0 ? "+" : "−"}
                    {Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              );
            })}
          </Card>
        </>
      )}
      {!previous && isLatest && <p className="px-1 text-[13px] font-semibold text-muted">{t("labs.changesNone")}</p>}

      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-2">
          <SectionHeader title={t(`labs.${g}`)} />
          <Card padded={false}>
            {judged
              .filter((j) => j.result.group === g)
              .map((j) => (
                <ResultRow key={j.result.key} j={j} before={beforeOf(j.result)} />
              ))}
          </Card>
        </div>
      ))}

      {isLatest && <NextStudy latest={study.takenAt} />}
      <p className="px-1 text-xs font-semibold text-muted">{t("labs.disclaimer")}</p>
      <Button
        variant="dangerText"
        className="self-center"
        disabled={remove.isPending}
        onClick={() => {
          if (confirm(t("labs.deleteConfirm"))) remove.mutate();
        }}
      >
        {t("labs.delete")}
      </Button>
    </div>
  );
}

/** Tests offered when typing a study by hand: the ones most yearly checkups include. */
const MANUAL = ["glucose", "hba1c", "cholesterol", "hdl", "ldl", "triglycerides", "creatinine", "uricAcid", "alt", "ast", "hemoglobin", "platelets", "wbc"];
const MANUAL_UNITS: Record<string, string> = {
  glucose: "mg/dL",
  hba1c: "%",
  cholesterol: "mg/dL",
  hdl: "mg/dL",
  ldl: "mg/dL",
  triglycerides: "mg/dL",
  creatinine: "mg/dL",
  uricAcid: "mg/dL",
  alt: "U/L",
  ast: "U/L",
  hemoglobin: "g/dL",
  platelets: "10^3/µL",
  wbc: "10^3/µL",
};

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Adding a study: read the lab's PDF on the phone and review it, or type the main values by hand. */
export function AddLabPage({ profile }: { profile: ProfileDto }) {
  const { t, tf, te, lang } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const name = useLabName();
  const value = useLabValue();
  const date = useStudyDate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedStudy | null>(null);
  const [results, setResults] = useState<LabResult[]>([]);
  const [takenAt, setTakenAt] = useState(today());
  const [lab, setLab] = useState("Salud Digna");
  const [savePrevious, setSavePrevious] = useState(true);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProblem(null);
    setReading(true);
    try {
      const { readLabPdf } = await import("../labPdf.ts");
      const study = await readLabPdf(file);
      if (study.results.length === 0) {
        setProblem(t("labs.pdfNothing"));
      } else {
        setParsed(study);
        setResults(study.results);
        if (study.takenAt) setTakenAt(study.takenAt);
        setManual(false);
      }
    } catch {
      setProblem(t("labs.pdfError"));
    } finally {
      setReading(false);
    }
  };

  const manualResults = useMemo<LabResult[]>(
    () =>
      MANUAL.flatMap((key) => {
        const n = Number((typed[key] ?? "").trim().replace(",", "."));
        const test = labTest(key)!;
        return (typed[key] ?? "").trim() && Number.isFinite(n)
          ? [{ key, name: test[lang], group: "blood" as const, value: n, text: null, unit: MANUAL_UNITS[key] ?? null, ref: null, flagged: false }]
          : [];
      }),
    [typed, lang],
  );
  const toSave = manual ? manualResults : results;

  const save = useMutation({
    mutationFn: async () => {
      // An electrocardiogram is often done the same day as the blood tests: it joins that study.
      const merge = toSave.length > 0 && toSave.every((r) => r.group === "ecg");
      const main = await api.saveLab({ takenAt, lab: lab.trim() || "Salud Digna", results: toSave, merge });
      // The older study from the comparison page goes in as its own study.
      if (!manual && parsed && savePrevious) {
        for (const p of parsed.previous) if (p.takenAt !== takenAt) await api.saveLab({ takenAt: p.takenAt, lab: lab.trim() || "Salud Digna", results: p.results });
      }
      return main;
    },
    onSuccess: async (main) => {
      await queryClient.invalidateQueries({ queryKey: ["labs"] });
      navigate(`/estudios/${main.id}`, { replace: true });
    },
    onError: (e) => setProblem(te(e)),
  });

  const person = personAt(profile, takenAt);
  const reviewing = parsed !== null && !manual;
  return (
    <form
      className="flex flex-col gap-3.5 pb-28"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (toSave.length > 0) save.mutate();
      }}
    >
      <BackLink to="/cuerpo/estudios" label={t("labs.back")} />
      <h1 className="mx-1 text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{t("labs.new")}</h1>

      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onFile} />
      {!reviewing && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={reading}
          className="flex flex-col items-center gap-2 rounded-[28px] border-2 border-dashed border-line-strong bg-surface px-5 py-7 text-center transition active:scale-[0.99] disabled:opacity-60"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand-text">
            <FiFileText size={26} aria-hidden />
          </span>
          <span className="text-[17px] font-extrabold">{reading ? t("labs.pdfReading") : t("labs.pdfTitle")}</span>
          <span className="text-[13px] font-semibold text-muted">{t("labs.pdfBody")}</span>
          {!reading && <span className="mt-1 rounded-2xl bg-brand px-5 py-2.5 text-[15px] font-extrabold text-brand-ink">{t("labs.pdfPick")}</span>}
        </button>
      )}
      {problem && <p className="rounded-2xl bg-bad-soft px-4 py-3 text-sm font-semibold text-bad-text">{problem}</p>}

      {(reviewing || manual) && (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t("labs.date")} type="date" value={takenAt} max={today()} onChange={(e) => setTakenAt(e.target.value)} required />
          <Field label={t("labs.lab")} value={lab} onChange={(e) => setLab(e.target.value)} required />
        </div>
      )}

      {reviewing && (
        <>
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-xl font-extrabold">{tf("labs.found", { n: results.length })}</h2>
            <button type="button" onClick={() => fileRef.current?.click()} className="shrink-0 text-sm font-bold text-brand-text">
              {t("labs.pickAnother")}
            </button>
          </div>
          <p className="px-1 text-[13px] font-semibold text-muted">{t("labs.foundHint")}</p>
          {parsed!.previous.map((p) => (
            <label key={p.takenAt} className="flex items-center gap-3 rounded-[20px] border border-line bg-surface p-4">
              <input type="checkbox" checked={savePrevious} onChange={(e) => setSavePrevious(e.target.checked)} className="h-5 w-5 shrink-0 accent-(--brand)" />
              <span className="flex flex-col">
                <span className="text-[15px] font-bold">{t("labs.previousSave")}</span>
                <span className="text-xs font-semibold text-muted">{tf("labs.previousFound", { date: date(p.takenAt), n: p.results.length })}</span>
              </span>
            </label>
          ))}
          {LAB_GROUPS.map((g) => {
            const list = results.filter((r) => r.group === g);
            if (list.length === 0) return null;
            return (
              <Card key={g} padded={false}>
                <p className="px-4 pt-3.5 pb-1 text-[13px] font-extrabold tracking-[0.06em] text-muted uppercase">{t(`labs.${g}`)}</p>
                {list.map((r) => {
                  const a = assess(r, person);
                  return (
                    <div key={r.key} className="flex min-h-12 items-center gap-2 border-t border-line py-1.5 pr-1.5 pl-4 text-sm">
                      {isLong(r) ? (
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-semibold text-ink-2">{name(r)}</span>
                          <span className="font-bold">{value(r)}</span>
                        </span>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 font-semibold text-ink-2">{name(r)}</span>
                          <span className="font-extrabold">{value(r)}</span>
                        </>
                      )}
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.status === "good" ? "" : a.status === "bad" ? "bg-bad" : "bg-warn"}`} aria-hidden />
                      <button
                        type="button"
                        aria-label={tf("labs.remove", { name: name(r) })}
                        onClick={() => setResults((all) => all.filter((x) => x.key !== r.key))}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
                      >
                        <FiX size={16} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </Card>
            );
          })}
        </>
      )}

      {!reviewing && !manual && (
        <button type="button" onClick={() => setManual(true)} className="min-h-11 self-center text-[15px] font-bold text-brand-text">
          {t("labs.manual")}
        </button>
      )}
      {manual && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">{t("labs.manualTitle")}</h2>
          <p className="text-[13px] font-semibold text-muted">{t("labs.manualHint")}</p>
          <div className="grid grid-cols-2 gap-2.5">
            {MANUAL.map((key) => (
              <Field
                key={key}
                label={`${labTest(key)![lang]} (${MANUAL_UNITS[key]})`}
                inputMode="decimal"
                value={typed[key] ?? ""}
                onChange={(e) => setTyped((all) => ({ ...all, [key]: e.target.value }))}
              />
            ))}
          </div>
        </Card>
      )}

      {(reviewing || manual) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="mx-auto max-w-md">
            <Button type="submit" disabled={save.isPending || toSave.length === 0} className="min-h-14 w-full rounded-[18px] text-[17px]">
              {save.isPending ? t("labs.saving") : t("labs.save")}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
