import { z } from "zod";

/*
 * Lab studies (blood and urine tests, and an electrocardiogram when there is one, done about once
 * a year, such as Salud Digna's). Results are
 * read from the lab's PDF on the phone (see src/labPdf.ts) or typed by hand, and judged two ways:
 * against the lab's own reference range, and for the markers that matter most, against published
 * North American guidelines. Feedback is information to take to a doctor, never a diagnosis.
 */

export type LabGroup = "blood" | "urine" | "ecg";
export const LAB_GROUPS: readonly LabGroup[] = ["blood", "urine", "ecg"];

/** One result as it is stored: the value, the lab's unit and range, and whether the lab flagged it. */
export const labResultSchema = z.object({
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(100),
  group: z.enum(["blood", "urine", "ecg"]),
  value: z.number().finite().nullable(),
  /** A result in words; long only for a cardiologist's reading of an electrocardiogram. */
  text: z.string().trim().max(400).nullable(),
  unit: z.string().trim().max(30).nullable(),
  ref: z.string().trim().max(80).nullable(),
  flagged: z.boolean(),
});

export const labStudyInputSchema = z.object({
  takenAt: z.iso.date(),
  lab: z.string().trim().min(1).max(60),
  results: z.array(labResultSchema).min(1).max(250),
});

export type LabResult = z.infer<typeof labResultSchema>;
export type LabStudyInput = z.infer<typeof labStudyInputSchema>;

export interface LabStudyDto extends LabStudyInput {
  id: string;
}

/** A known test: its key, names in both languages and how labs print it. */
export interface LabTest {
  key: string;
  group: LabGroup;
  es: string;
  en: string;
  /** Printed names, without accents and in capitals; the first match wins. */
  aliases: string[];
}

const t = (key: string, group: LabGroup, es: string, en: string, ...aliases: string[]): LabTest => ({ key, group, es, en, aliases });

/** Tests the app knows by name. Anything else is kept with the name the lab printed. */
export const LAB_TESTS: LabTest[] = [
  // Complete blood count.
  t("wbc", "blood", "Leucocitos", "White blood cells", "LEUCOCITOS"),
  t("rbc", "blood", "Eritrocitos", "Red blood cells", "ERITROCITOS"),
  t("hemoglobin", "blood", "Hemoglobina", "Hemoglobin", "HEMOGLOBINA"),
  t("hematocrit", "blood", "Hematocrito", "Hematocrit", "HEMATOCRITO"),
  t("mcv", "blood", "Volumen corpuscular medio", "Mean corpuscular volume", "VOLUMEN CORPUSCULAR MEDIO"),
  t("mch", "blood", "Hemoglobina corpuscular media", "Mean corpuscular hemoglobin", "HEMOGLOBINA CORPUSCULAR MEDIA"),
  t("mchc", "blood", "Concentración media de hemoglobina", "Mean corpuscular hemoglobin concentration", "CONC. MEDIA DE HB CORPUSCULAR", "CONCENTRACION MEDIA DE HEMOGLOBINA CORPUSCULAR"),
  t("rdwSd", "blood", "Ancho de distribución eritrocitaria (DE)", "Red cell distribution width (SD)", "ANCHO DE DISTRIBUCION ERITROCITARIA (D.E.)"),
  t("rdwCv", "blood", "Ancho de distribución eritrocitaria (CV)", "Red cell distribution width (CV)", "ANCHO DE DISTRIBUCION ERITROCITARIA (C.V.)"),
  t("platelets", "blood", "Plaquetas", "Platelets", "PLAQUETAS"),
  t("mpv", "blood", "Volumen plaquetario medio", "Mean platelet volume", "VOLUMEN PLAQUETARIO MEDIO"),
  t("lymphPct", "blood", "Linfocitos (%)", "Lymphocytes (%)", "LINFOCITOS (%)"),
  t("monoPct", "blood", "Monocitos (%)", "Monocytes (%)", "MONOCITOS (%)"),
  t("eosPct", "blood", "Eosinófilos (%)", "Eosinophils (%)", "EOSINOFILOS (%)"),
  t("basoPct", "blood", "Basófilos (%)", "Basophils (%)", "BASOFILOS (%)"),
  t("neutPct", "blood", "Neutrófilos (%)", "Neutrophils (%)", "NEUTROFILOS (%)"),
  t("lymph", "blood", "Linfocitos", "Lymphocytes", "LINFOCITOS"),
  t("mono", "blood", "Monocitos", "Monocytes", "MONOCITOS"),
  t("eos", "blood", "Eosinófilos", "Eosinophils", "EOSINOFILOS"),
  t("baso", "blood", "Basófilos", "Basophils", "BASOFILOS"),
  t("neut", "blood", "Neutrófilos", "Neutrophils", "NEUTROFILOS"),
  // Chemistry.
  t("glucose", "blood", "Glucosa", "Glucose", "GLUCOSA", "GLUCOSA EN SUERO"),
  t("hba1c", "blood", "Hemoglobina glucosilada (A1c)", "Hemoglobin A1c", "HEMOGLOBINA GLUCOSILADA", "HEMOGLOBINA GLICOSILADA", "HBA1C", "HEMOGLOBINA GLUCOSILADA (HBA1C)"),
  t("urea", "blood", "Urea", "Urea", "UREA"),
  t("bun", "blood", "Nitrógeno ureico (BUN)", "Blood urea nitrogen (BUN)", "NITROGENO UREICO (BUN)", "NITROGENO UREICO"),
  t("creatinine", "blood", "Creatinina", "Creatinine", "CREATININA EN SUERO", "CREATININA"),
  t("bunCreatinine", "blood", "Relación BUN/creatinina", "BUN/creatinine ratio", "RELACION BUN/CREATININA"),
  t("uricAcid", "blood", "Ácido úrico", "Uric acid", "ACIDO URICO EN SUERO", "ACIDO URICO"),
  t("cholesterol", "blood", "Colesterol total", "Total cholesterol", "COLESTEROL TOTAL"),
  t("triglycerides", "blood", "Triglicéridos", "Triglycerides", "TRIGLICERIDOS"),
  t("hdl", "blood", "Colesterol HDL", "HDL cholesterol", "COLESTEROL HDL"),
  t("ldl", "blood", "Colesterol LDL", "LDL cholesterol", "COLESTEROL LDL"),
  t("vldl", "blood", "Colesterol VLDL", "VLDL cholesterol", "COLESTEROL VLDL"),
  t("ldlHdl", "blood", "Relación LDL/HDL", "LDL/HDL ratio", "RELACION COLESTEROL LDL/COLESTEROL HDL"),
  t("atherogenic", "blood", "Índice de riesgo aterogénico", "Atherogenic index", "INDICE DE RIESGO ATEROGENICO", "INDICE ATEROGENICO"),
  t("biliTotal", "blood", "Bilirrubina total", "Total bilirubin", "BILIRRUBINA TOTAL"),
  t("biliDirect", "blood", "Bilirrubina directa", "Direct bilirubin", "BILIRRUBINA DIRECTA"),
  t("biliIndirect", "blood", "Bilirrubina indirecta", "Indirect bilirubin", "BILIRRUBINA INDIRECTA"),
  t("ast", "blood", "AST (TGO)", "AST", "ASPARTATO AMINOTRANSFERASA (TGO)(AST)", "ASPARTATO AMINOTRANSFERASA"),
  t("alt", "blood", "ALT (TGP)", "ALT", "ALANINO AMINOTRANSFERASA (TGP)(ALT)", "ALANINO AMINOTRANSFERASA"),
  t("ggt", "blood", "GGT", "GGT", "GAMMAGLUTAMIL TRANSPEPTIDASA (GGT)", "GAMMAGLUTAMIL TRANSPEPTIDASA"),
  t("alp", "blood", "Fosfatasa alcalina", "Alkaline phosphatase", "FOSFATASA ALCALINA (ALP)", "FOSFATASA ALCALINA"),
  t("ldh", "blood", "Deshidrogenasa láctica (LDH)", "Lactate dehydrogenase (LDH)", "DESHIDROGENASA LACTICA (LDH)", "DESHIDROGENASA LACTICA"),
  t("protein", "blood", "Proteínas totales", "Total protein", "PROTEINAS TOTALES SERICAS", "PROTEINAS TOTALES"),
  t("albumin", "blood", "Albúmina", "Albumin", "ALBUMINA EN SUERO", "ALBUMINA"),
  t("globulin", "blood", "Globulina", "Globulin", "GLOBULINA"),
  t("agRatio", "blood", "Relación albúmina/globulina", "Albumin/globulin ratio", "RELACION A/G"),
  t("calcium", "blood", "Calcio", "Calcium", "CALCIO EN SUERO", "CALCIO"),
  t("phosphorus", "blood", "Fósforo", "Phosphorus", "FOSFORO EN SUERO", "FOSFORO"),
  t("magnesium", "blood", "Magnesio", "Magnesium", "MAGNESIO EN SUERO", "MAGNESIO"),
  t("iron", "blood", "Hierro", "Iron", "HIERRO", "HIERRO SERICO"),
  t("ferritin", "blood", "Ferritina", "Ferritin", "FERRITINA"),
  t("amylase", "blood", "Amilasa", "Amylase", "AMILASA"),
  t("lipase", "blood", "Lipasa", "Lipase", "LIPASA"),
  t("sodium", "blood", "Sodio", "Sodium", "SODIO"),
  t("potassium", "blood", "Potasio", "Potassium", "POTASIO"),
  t("chloride", "blood", "Cloruro", "Chloride", "CLORURO"),
  t("tsh", "blood", "TSH", "TSH", "TSH", "HORMONA ESTIMULANTE DE TIROIDES"),
  t("vitaminD", "blood", "Vitamina D", "Vitamin D", "VITAMINA D", "25-HIDROXIVITAMINA D"),
  t("vitaminB12", "blood", "Vitamina B12", "Vitamin B12", "VITAMINA B12"),
  t("insulin", "blood", "Insulina", "Insulin", "INSULINA"),
  t("psa", "blood", "Antígeno prostático (PSA)", "Prostate-specific antigen (PSA)", "ANTIGENO PROSTATICO ESPECIFICO", "PSA"),
  // Urinalysis.
  t("uColor", "urine", "Color", "Color", "COLOR"),
  t("uAspect", "urine", "Aspecto", "Appearance", "ASPECTO"),
  t("uGravity", "urine", "Densidad (gravedad específica)", "Specific gravity", "GRAVEDAD ESPECIFICA", "DENSIDAD"),
  t("uPh", "urine", "pH", "pH", "REACCION PH", "PH"),
  t("uLeukEsterase", "urine", "Esterasa leucocitaria", "Leukocyte esterase", "ESTERASA LEUCOCITARIA"),
  t("uNitrites", "urine", "Nitritos", "Nitrites", "NITRITOS"),
  t("uProtein", "urine", "Proteínas en orina", "Urine protein", "PROTEINAS"),
  t("uGlucose", "urine", "Glucosa en orina", "Urine glucose", "GLUCOSA"),
  t("uKetones", "urine", "Cetonas", "Ketones", "CETONAS"),
  t("uUrobilinogen", "urine", "Urobilinógeno", "Urobilinogen", "UROBILINOGENO"),
  t("uBilirubin", "urine", "Bilirrubina en orina", "Urine bilirubin", "BILIRRUBINAS", "BILIRRUBINA"),
  t("uBlood", "urine", "Sangre en orina", "Urine blood", "SANGRE (ERIT. LISADOS)", "SANGRE"),
  t("uWbc", "urine", "Leucocitos en orina", "Urine white cells", "LEUCOCITOS"),
  t("uRbc", "urine", "Eritrocitos en orina", "Urine red cells", "ERITROCITOS"),
  t("uBacteria", "urine", "Bacterias", "Bacteria", "BACTERIAS"),
  t("uSquamous", "urine", "Células epiteliales escamosas", "Squamous epithelial cells", "CELULAS EPITELIALES ESCAMOSAS"),
  t("uNonSquamous", "urine", "Células epiteliales no escamosas", "Non-squamous epithelial cells", "CELULAS EPITELIALES NO ESCAMOSAS"),
  t("uMucus", "urine", "Filamento mucoide", "Mucus threads", "FILAMENTO MUCOIDE"),
  t("uCrystals", "urine", "Cristales", "Crystals", "CRISTALES"),
  t("uUrates", "urine", "Uratos amorfos", "Amorphous urates", ". URATOS AMORFOS", "URATOS AMORFOS"),
  t("uYeast", "urine", "Levaduras", "Yeast", "LEVADURAS"),
  t("uHyaline", "urine", "Cilindros hialinos", "Hyaline casts", "CILINDROS HIALINOS"),
  t("uCasts", "urine", "Cilindros patológicos", "Pathological casts", "CILINDROS PATOLOGICOS"),
  // Electrocardiogram at rest.
  t("ecgRhythm", "ecg", "Ritmo", "Rhythm", "RITMO", "RITMO CARDIACO"),
  t("ecgHr", "ecg", "Frecuencia cardiaca", "Heart rate", "FRECUENCIA CARDIACA", "FRECUENCIA", "FREC. VENTRICULAR"),
  t("ecgP", "ecg", "Duración de la onda P", "P wave duration", "ONDA P", "DURACION P"),
  t("ecgPr", "ecg", "Intervalo PR", "PR interval", "INTERVALO PR", "PR"),
  t("ecgQrs", "ecg", "Duración del QRS", "QRS duration", "COMPLEJO QRS", "DURACION QRS", "QRS"),
  t("ecgQt", "ecg", "Intervalo QT", "QT interval", "INTERVALO QT", "INTERVALO QTM", "QT"),
  t("ecgQtc", "ecg", "QT corregido (QTc)", "Corrected QT (QTc)", "QTC", "QT CORREGIDO", "INTERVALO QTC"),
  t("ecgAxis", "ecg", "Eje eléctrico del QRS", "QRS axis", "EJE ELECTRICO DEL QRS (AQRS)", "EJE ELECTRICO", "EJE QRS"),
  t("ecgSokolow", "ecg", "Índice de Sokolow-Lyon", "Sokolow-Lyon index", "SOKOLOW-LYON"),
  t("ecgHypertrophy", "ecg", "Hipertrofia", "Hypertrophy", "HIPERTROFIA"),
  t("ecgDiastolic", "ecg", "Sobrecarga diastólica", "Diastolic overload", "SOBRECARGA DIASTOLICA"),
  t("ecgSystolic", "ecg", "Sobrecarga sistólica", "Systolic overload", "SOBRECARGA SISTOLICA"),
  t("ecgInjury", "ecg", "Lesión", "Injury", "LESION"),
  t("ecgIschemia", "ecg", "Isquemia", "Ischemia", "ISQUEMIA"),
  t("ecgNecrosis", "ecg", "Necrosis", "Necrosis", "NECROSIS"),
  t("ecgReading", "ecg", "Hallazgos del cardiólogo", "Cardiologist's findings", "HALLAZGOS ELECTROCARDIOGRAFICOS", "INTERPRETACION", "CONCLUSION"),
];

/** Findings a cardiologist marks as present or not; "No" is the normal answer. */
const ECG_FINDINGS = ["ecgHypertrophy", "ecgDiastolic", "ecgSystolic", "ecgInjury", "ecgIschemia", "ecgNecrosis"];

/** Capitals without accents and with single spaces, to compare printed names. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function labTest(key: string): LabTest | undefined {
  return LAB_TESTS.find((x) => x.key === key);
}

/** The known test for a printed name in a group, or a key made from the name. */
export function identify(name: string, group: LabGroup): { key: string; known: boolean } {
  const n = normalizeName(name);
  const found = LAB_TESTS.find((x) => x.group === group && x.aliases.includes(n));
  if (found) return { key: found.key, known: true };
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  return { key: `${group === "urine" ? "u-" : group === "ecg" ? "ecg-" : ""}${slug || "resultado"}`, known: false };
}

// ---------------------------------------------------------------------------------------------
// Reading a lab report.

export interface ParsedStudy {
  takenAt: string | null;
  results: LabResult[];
  /** An older study the report compares against (Salud Digna's last page), if any. */
  previous: { takenAt: string; results: LabResult[] }[];
}

const NUMBER = /^[<>≤≥]?\s*-?\d+(?:[.,]\d+)?$/;
const RANGE = /^(?:[<>≤≥]\s*-?\d+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?\s*-\s*-?\d+(?:[.,]\d+)?)$/;
/** Words labs use as values and as references in urine tests. */
const QUALITATIVE = /^(NEGATIVO|POSITIVO|NORMAL|AUSENTES?|PRESENTES?|ESCASAS?|ESCASOS?|MODERAD[AO]S?|ABUNDANTES?|AMARILLO|AMBAR|CLARO|TURBIO|LIG\.?\s?TURBIO|TRAZAS?|NEGATIVE|POSITIVE|ABSENT|PRESENT|FEW|MODERATE|MANY|CLEAR|YELLOW|CLOUDY)$/i;

/** Lines with these words are page furniture, not results. */
const SKIP = /(PACIENTE|FOLIO|N[ºO°] CLIENTE|FECHA|MEDICO|VALIDO|Q\.F\.B|Q\.C\.|TLC\.|CEDULA|UNIVERSIDAD|RESPONSABLE|REIMPRESION|RESULTADOS FUERA|CIFRA DE ALERTA|ESTUDIOS REALIZAMOS|TIPO DE MUESTRA|METODO|EQUIPO|NOTA:|COL\.|C\.P\.|^\d+\s+DE\s+\d+$)/;

const MONTHS: Record<string, string> = {
  ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06", JUL: "07", AGO: "08", SEP: "09", SEPT: "09", OCT: "10", NOV: "11", DIC: "12",
  JAN: "01", APR: "04", AUG: "08", DEC: "12",
};

/** "6/Feb/2025", as electrocardiogram reports print it, as "2025-02-06". */
function readNamedSlashDate(s: string): string | null {
  const m = /(\d{1,2})\/([A-Za-z]{3,4})\.?\/(\d{4})/.exec(s);
  const month = m ? MONTHS[normalizeName(m[2]!)] : undefined;
  return m && month ? `${m[3]}-${month}-${m[1]!.padStart(2, "0")}` : null;
}

function toNumber(s: string): number | null {
  const n = Number(s.replace(/[<>≤≥\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "29/08/2026" or "06-FEB.-2025" as "2026-08-29". */
function readDate(s: string): string | null {
  const dmy = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  const named = /(\d{1,2})-([A-Z]{3,4})\.?-(\d{4})/.exec(normalizeName(s));
  if (named && MONTHS[named[2]!]) return `${named[3]}-${MONTHS[named[2]!]}-${named[1]!.padStart(2, "0")}`;
  return null;
}

function urineSection(n: string): boolean {
  return /ORINA|UROANALISIS|URIANALISIS|EXAMEN FISICO|EXAMEN QUIMICO|EXAMEN MICROSCOPICO/.test(n);
}

/**
 * Reads the lines of a lab report laid out as columns (name, value, an optional "*" when out of
 * range, unit, reference), as pdftotext -layout or src/labPdf.ts produce them: columns are
 * separated by two or more spaces. Sections (HEMATOLOGÍA, UROANÁLISIS...) tell blood from urine,
 * which matters for names both use (glucose, white cells). A comparison table of older studies at
 * the end, like Salud Digna's, comes back as `previous`.
 */
export function parseLabReport(lines: string[]): ParsedStudy {
  if (lines.some((l) => /INFORME DE RESULTADOS ELECTROCARDIOGRAMA/.test(normalizeName(l)))) return parseEcgReport(lines);
  let takenAt: string | null = null;
  let group: LabGroup = "blood";
  const results: LabResult[] = [];
  const seen = new Set<string>();
  let compareDates: string[] | null = null;
  const previous = new Map<string, LabResult[]>();

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const n = normalizeName(line);
    if (!takenAt && /FECHA DE TOMA/.test(n)) takenAt = readDate(line);

    // Salud Digna's last page: dates of the studies compared, then one row per test.
    const dates = [...line.matchAll(/\d{1,2}-[A-ZÁÉÍÓÚa-z]{3,4}\.?-\d{4}/g)].map((m) => readDate(m[0])).filter((d): d is string => d !== null);
    if (dates.length >= 2 && /^\s*$/.test(line.replace(/\d{1,2}-[A-ZÁÉÍÓÚa-z]{3,4}\.?-\d{4}/g, ""))) {
      compareDates = dates;
      continue;
    }
    if (/RESUMEN COMPARATIVO/.test(n)) continue;
    if (compareDates) {
      const cols = line.trim().split(/\s{2,}/);
      const name = cols[0]!;
      const values = cols.slice(1).filter((c) => c !== "-");
      const unit = values.length > compareDates.length ? values.pop()! : null;
      if (values.length === compareDates.length && values.every((v) => NUMBER.test(v))) {
        const { key } = identify(name, "blood");
        compareDates.forEach((date, i) => {
          // The newest column is the study being read; only older ones are kept.
          if (i === compareDates!.length - 1) return;
          const list = previous.get(date) ?? [];
          // Salud Digna prints "mg/dL" for every row of this table; the unit of the same test in
          // the main report is the right one and replaces it below.
          list.push({ key, name: titleCase(name), group: "blood", value: toNumber(values[i]!), text: null, unit, ref: null, flagged: false });
          previous.set(date, list);
        });
      }
      continue;
    }

    if (SKIP.test(n)) continue;
    const cols = line.trim().split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    // A section title: one column of capitals without digits.
    if (cols.length === 1) {
      if (/^[A-ZÑ .()/]+$/.test(n) && !/[a-z]/.test(cols[0]!)) {
        if (urineSection(n)) group = "urine";
        else if (/HEMATOLOGIA|QUIMICA|BIOMETRIA|ELECTROLITOS|PERFIL|LIPIDOS|HORMONAS|INMUNOLOGIA/.test(n)) group = "blood";
      }
      continue;
    }
    const [name, ...rest] = cols;
    if (!name || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(name) || /^[(<>≤≥]/.test(name) || /:/.test(name)) continue;
    let flagged = false;
    const tokens = rest.filter((tok) => {
      if (/^\*{1,2}$/.test(tok)) {
        flagged = true;
        return false;
      }
      return true;
    });
    let valueTok = tokens.shift();
    if (!valueTok) continue;
    // "8.80 *" can arrive as one column when the gap is short.
    if (/\s\*{1,2}$/.test(valueTok)) {
      flagged = true;
      valueTok = valueTok.replace(/\s\*{1,2}$/, "");
    }
    const numeric = NUMBER.test(valueTok) && !/^[<>≤≥]/.test(valueTok);
    if (!numeric && !QUALITATIVE.test(valueTok)) continue;
    let unit: string | null = null;
    let ref: string | null = null;
    for (const tok of tokens) {
      if (ref === null && (RANGE.test(tok) || QUALITATIVE.test(tok) || (numeric && unit !== null && NUMBER.test(tok)))) ref = tok;
      else if (unit === null && ref === null) unit = tok;
    }
    const { key } = identify(name, group);
    // Some reports repeat a page header row; keep the first reading of each test.
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      key,
      name: titleCase(name.replace(/^\.\s*/, "")),
      group,
      value: numeric ? toNumber(valueTok) : null,
      text: numeric ? null : valueTok,
      unit,
      ref,
      flagged,
    });
  }

  // Older studies get the unit of the same test in this report.
  const units = new Map(results.map((r) => [r.key, r.unit]));
  return {
    takenAt,
    results,
    previous: [...previous].map(([date, list]) => ({
      takenAt: date,
      results: list.map((r) => ({ ...r, unit: units.get(r.key) ?? r.unit })),
    })),
  };
}

/**
 * Reads Salud Digna's electrocardiogram report: the cardiologist's values ("Ritmo: Sinusal",
 * "Intervalo PR: 140 ms."), the findings marked "No" or "Sí", the written conclusion, and from the
 * machine's page what the cardiologist does not repeat (QTc, Sokolow-Lyon). The cardiologist's
 * reading wins where both give a value.
 */
export function parseEcgReport(lines: string[]): ParsedStudy {
  const text = lines.join("\n");
  const flat = text.replace(/\s+/g, " ");
  const results: LabResult[] = [];
  const num = (pattern: RegExp) => {
    const m = pattern.exec(flat);
    return m ? toNumber(m[1]!) : null;
  };
  const add = (key: string, value: number | null, unit: string | null, extra: Partial<LabResult> = {}) => {
    if (value === null && !extra.text) return;
    const test = labTest(key)!;
    results.push({ key, name: test.es, group: "ecg", value, text: null, unit, ref: null, flagged: false, ...extra });
  };
  const rhythm = /Ritmo:\s*([^,\n]+?)\s+Frecuencia cardiaca/i.exec(text)?.[1]?.trim();
  if (rhythm) add("ecgRhythm", null, null, { text: rhythm });
  add("ecgHr", num(/Frecuencia cardiaca:\s*(\d+)/i) ?? num(/Frec\. ventricular\s*(\d+)/i), "lpm");
  add("ecgP", num(/Onda p:\s*[\d.]+\s*mm\.?\s*(\d+)\s*ms/i) ?? num(/Duraci[oó]n P\s*(\d+)\s*ms/i), "ms");
  add("ecgPr", num(/Intervalo PR:\s*(\d+)/i) ?? num(/Intervalo PR\s+(\d+)\s*ms/i), "ms");
  add("ecgQrs", num(/Complejo QRS:\s*(\d+)/i) ?? num(/Duraci[oó]n QRS\s*(\d+)\s*ms/i), "ms");
  const machineQt = /QT \/ QTc\(?B?\)?\s*(\d+)\s*\/\s*(\d+)\s*ms/i.exec(flat);
  add("ecgQt", num(/Intervalo QTm?:\s*(\d+)/i) ?? (machineQt ? toNumber(machineQt[1]!) : null), "ms");
  add("ecgQtc", machineQt ? toNumber(machineQt[2]!) : null, "ms");
  add("ecgAxis", num(/\(aQRS\):\s*(-?\d+)/i) ?? num(/Ejes P-R-T\s*-?\d+\s*\/\s*(-?\d+)/i), "°");
  add("ecgSokolow", num(/Sokolow-Lyon\s*([\d.]+)\s*mV/i), "mV", { ref: "<3.5" });
  const findings: [string, RegExp][] = [
    ["ecgHypertrophy", /Hipertrofia:\s*(S[ií]|No)(?![a-z])/i],
    ["ecgDiastolic", /Sobrecarga diast[oó]lica:\s*(S[ií]|No)(?![a-z])/i],
    ["ecgSystolic", /Sobrecarga sist[oó]lica:\s*(S[ií]|No)(?![a-z])/i],
    ["ecgInjury", /Lesi[oó]n:\s*(S[ií]|No)(?![a-z])/i],
    ["ecgIschemia", /Isquemia:\s*(S[ií]|No)(?![a-z])/i],
    ["ecgNecrosis", /Necrosis:\s*(S[ií]|No)(?![a-z])/i],
  ];
  for (const [key, pattern] of findings) {
    const answer = pattern.exec(flat)?.[1];
    if (answer) add(key, null, null, { text: answer, ref: "No", flagged: normalizeName(answer) !== "NO" });
  }
  const reading = /HALLAZGOS ELECTROCARDIOGR[AÁ]FICOS\s*(.+?)\s*(?:\d\)\s*SUGERENCIAS|$)/i.exec(flat)?.[1]?.trim();
  if (reading) add("ecgReading", null, null, { text: reading.slice(0, 400) });
  const date = /Fecha toma:\s*([^\s]+)/i.exec(flat)?.[1];
  return { takenAt: date ? (readNamedSlashDate(date) ?? readDate(date)) : null, results, previous: [] };
}

function titleCase(s: string): string {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ---------------------------------------------------------------------------------------------
// Judging the results.

export type LabRangeStatus = "in" | "low" | "high" | "off";

/** Where a value sits against the lab's printed reference ("4.23 - 9.07", "<200.0", ">55.0", "Negativo"). */
export function rangeStatus(result: Pick<LabResult, "value" | "text" | "ref" | "flagged">): LabRangeStatus | null {
  const ref = result.ref?.trim();
  if (!ref) return result.flagged ? "off" : null;
  if (result.value === null) {
    if (!result.text) return null;
    const a = normalizeName(result.text);
    const b = normalizeName(ref);
    if (a === b || (b === "NEGATIVO" && a === "NORMAL") || (b === "AUSENTES" && a === "AUSENTE")) return "in";
    return result.flagged ? "off" : "in";
  }
  const v = result.value;
  const range = /^(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)$/.exec(ref);
  if (range) {
    const lo = toNumber(range[1]!)!;
    const hi = toNumber(range[2]!)!;
    return v < lo ? "low" : v > hi ? "high" : "in";
  }
  const bound = /^([<>≤≥])\s*(-?\d+(?:[.,]\d+)?)$/.exec(ref);
  if (bound) {
    const x = toNumber(bound[2]!)!;
    const op = bound[1];
    if (op === "<") return v < x ? "in" : "high";
    if (op === "≤") return v <= x ? "in" : "high";
    if (op === ">") return v > x ? "in" : "low";
    return v >= x ? "in" : "low";
  }
  return result.flagged ? "off" : null;
}

export type LabStatus = "good" | "warn" | "bad";

/** What the app says about one result: a status, and a message key with its values. */
export interface LabAssessment {
  status: LabStatus;
  /** Copy key under "lab.note."; null when the lab's range says it all. */
  note: string | null;
  vars: Record<string, string | number>;
  /** Where the cutoffs come from, for the guideline-based ones. */
  source: string | null;
}

export interface LabPerson {
  sex: "male" | "female";
  age: number;
}

/** Estimated glomerular filtration, CKD-EPI 2021 (race-free), mL/min/1.73 m². */
export function egfr(creatinineMgDl: number, person: LabPerson): number {
  const female = person.sex === "female";
  const k = female ? 0.7 : 0.9;
  const a = female ? -0.241 : -0.302;
  const r = creatinineMgDl / k;
  return 142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** person.age * (female ? 1.012 : 1);
}

const by = (status: LabStatus, note: string | null, source: string | null, vars: Record<string, string | number> = {}): LabAssessment => ({
  status,
  note,
  vars,
  source,
});

/**
 * Guideline cutoffs for the markers that matter most; the lab's range for the rest. A value just
 * outside the lab's range on its own is "warn", never "bad": many are not meaningful alone.
 */
export function assess(result: LabResult, person: LabPerson): LabAssessment {
  const v = result.value;
  const male = person.sex === "male";
  if (v !== null) {
    switch (result.key) {
      case "glucose":
        if (v < 70) return by("warn", "glucoseLow", "ADA 2025");
        if (v < 100) return by("good", "glucoseNormal", "ADA 2025");
        if (v < 126) return by("warn", "glucosePrediabetes", "ADA 2025");
        return by("bad", "glucoseDiabetes", "ADA 2025");
      case "hba1c":
        if (v < 5.7) return by("good", "a1cNormal", "ADA 2025");
        if (v < 6.5) return by("warn", "a1cPrediabetes", "ADA 2025");
        return by("bad", "a1cDiabetes", "ADA 2025");
      case "cholesterol":
        if (v < 200) return by("good", "cholDesirable", "NCEP ATP III");
        if (v < 240) return by("warn", "cholBorderline", "NCEP ATP III");
        return by("bad", "cholHigh", "NCEP ATP III");
      case "ldl":
        if (v < 100) return by("good", "ldlOptimal", "NCEP ATP III");
        if (v < 130) return by("warn", "ldlNearOptimal", "NCEP ATP III");
        if (v < 160) return by("warn", "ldlBorderline", "NCEP ATP III");
        if (v < 190) return by("bad", "ldlHigh", "NCEP ATP III");
        return by("bad", "ldlVeryHigh", "ACC/AHA 2018");
      case "hdl": {
        const low = male ? 40 : 50;
        if (v < low) return by("bad", "hdlLow", "NCEP ATP III / AHA", { low });
        if (v < 60) return by("warn", "hdlAcceptable", "NCEP ATP III / AHA", { low });
        return by("good", "hdlProtective", "NCEP ATP III / AHA");
      }
      case "triglycerides":
        if (v < 150) return by("good", "tgNormal", "NCEP ATP III");
        if (v < 200) return by("warn", "tgBorderline", "NCEP ATP III");
        return by("bad", "tgHigh", "NCEP ATP III");
      case "vldl":
        if (rangeStatus(result) === "low") return by("good", "vldlLow", null);
        break;
      case "creatinine": {
        const e = Math.round(egfr(v, person));
        if (e >= 90) return by("good", "egfrNormal", "CKD-EPI 2021, KDIGO", { egfr: e });
        if (e >= 60) return by("warn", "egfrMild", "CKD-EPI 2021, KDIGO", { egfr: e });
        return by("bad", "egfrLow", "CKD-EPI 2021, KDIGO", { egfr: e });
      }
      case "uricAcid": {
        const high = male ? 7 : 6;
        if (v > high) return by("warn", "uricHigh", "ACR 2020", { high });
        return by("good", "uricNormal", "ACR 2020", { high });
      }
      case "alt": {
        // The "healthy" upper limits are lower than most labs print (ACG 2017).
        const top = male ? 33 : 25;
        if (v > top) return by("warn", "altAbove", "ACG 2017", { top });
        return by("good", "altNormal", "ACG 2017", { top });
      }
      case "lipase": {
        const hi = refHigh(result.ref);
        if (hi !== null && v > hi) return v >= hi * 3 ? by("bad", "lipaseHigh", null) : by("warn", "lipaseMild", null);
        break;
      }
      case "mpv":
      case "globulin":
        if (rangeStatus(result) === "low") return by("warn", "slightlyLowAlone", null);
        break;
      case "uGravity":
        if (v >= 1.025) return by("warn", "urineConcentrated", null);
        break;
      // Electrocardiogram at rest: AHA/ACC/HRS recommendations for its interpretation (2007-2009).
      case "ecgHr":
        if (v < 50) return by("warn", "ecgHrLow", "AHA/ACC/HRS", { bpm: v });
        if (v <= 100) return by("good", "ecgHrNormal", "AHA/ACC/HRS", { bpm: v });
        return by("warn", "ecgHrHigh", "AHA/ACC/HRS", { bpm: v });
      case "ecgP":
        if (v >= 120) return by("warn", "ecgPLong", "AHA/ACC/HRS");
        return by("good", "ecgPNormal", "AHA/ACC/HRS");
      case "ecgPr":
        if (v < 120 || v > 200) return by("warn", "ecgPrOff", "AHA/ACC/HRS");
        return by("good", "ecgPrNormal", "AHA/ACC/HRS");
      case "ecgQrs":
        if (v >= 120) return by("warn", "ecgQrsWide", "AHA/ACC/HRS");
        return by("good", "ecgQrsNormal", "AHA/ACC/HRS");
      case "ecgQtc": {
        const top = male ? 450 : 460;
        if (v > 500) return by("bad", "ecgQtcLong", "AHA/ACC/HRS", { top });
        if (v > top) return by("warn", "ecgQtcBorderline", "AHA/ACC/HRS", { top });
        return by("good", "ecgQtcNormal", "AHA/ACC/HRS", { top });
      }
      case "ecgAxis":
        if (v < -30 || v > 90) return by("warn", "ecgAxisOff", "AHA/ACC/HRS");
        return by("good", "ecgAxisNormal", "AHA/ACC/HRS");
      case "ecgSokolow":
        if (v >= 3.5) return by("warn", "ecgSokolowHigh", "Sokolow-Lyon");
        return by("good", "ecgSokolowNormal", "Sokolow-Lyon");
    }
  } else {
    switch (result.key) {
      case "uBacteria":
      case "uAspect":
      case "uCrystals":
      case "uUrates":
        if (rangeStatus(result) === "off" || result.flagged || result.key === "uUrates") return by("warn", "urineSample", null);
        break;
      case "ecgRhythm":
        if (/SINUSAL|SINUS/.test(normalizeName(result.text ?? ""))) return by("good", "ecgSinus", null);
        return by("warn", "ecgRhythmOther", null);
      case "ecgReading":
        if (result.flagged) return by("warn", "ecgReadingCheck", null);
        if (/DENTRO DE PARAMETROS NORMALES|NORMAL/.test(normalizeName(result.text ?? ""))) return by("good", "ecgReadingNormal", null);
        return by("good", null, null);
    }
    if (ECG_FINDINGS.includes(result.key)) {
      return normalizeName(result.text ?? "") === "NO" ? by("good", "ecgFindingNone", null) : by("warn", "ecgFindingPresent", null);
    }
  }
  const status = rangeStatus(result);
  if (status === null || status === "in") return by("good", null, null);
  return by("warn", "outOfLabRange", null);
}

function refHigh(ref: string | null): number | null {
  if (!ref) return null;
  const range = /-\s*(-?\d+(?:[.,]\d+)?)$/.exec(ref);
  if (range) return toNumber(range[1]!);
  const bound = /^[<≤]\s*(-?\d+(?:[.,]\d+)?)$/.exec(ref);
  return bound ? toNumber(bound[1]!) : null;
}

/** Non-HDL cholesterol (total minus HDL), a better single number for risk than LDL alone (NLA). */
export function nonHdl(results: LabResult[]): number | null {
  const total = results.find((r) => r.key === "cholesterol")?.value;
  const hdl = results.find((r) => r.key === "hdl")?.value;
  return total != null && hdl != null ? total - hdl : null;
}

/** A study is about yearly; the next one is due a year after the last. */
export function nextStudyDue(takenAt: string): string {
  const d = new Date(`${takenAt}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
