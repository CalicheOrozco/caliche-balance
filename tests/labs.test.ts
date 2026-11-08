import { describe, expect, it } from "vitest";
import { assess, egfr, nextStudyDue, nonHdl, parseLabReport, rangeStatus, type LabResult } from "../shared/labs.ts";

// A made-up report laid out like Salud Digna's (name, value, "*", unit, reference in columns).
const REPORT = `
                     Nº Cliente:     12345678                 Fecha de Toma:     15/03/2026    08:10:00
Paciente: PRUEBA, PERSONA                                      Sexo:   Hombre   Edad: 40   Años
  HEMATOLOGÍA
   BIOMETRIA HEMATICA
   LEUCOCITOS                                      6.10              10^3/µL           4.23 - 9.07
   HEMOGLOBINA                                     12.90      *       g/dL             13.70 - 17.50
  Valido:    Q.C. ALGUIEN
*=RESULTADOS FUERA DE LOS LIMITES DE REFERENCIA PARA PACIENTES NORMALES
   QUIMICA CLINICA
   GLUCOSA                                         112.0      *       mg/dL             74.0 - 106.0
   COLESTEROL TOTAL                                210.0      *       mg/dL               <200.0
   COLESTEROL HDL                                  38.0       *       mg/dL               >55.0
                                                                                   Masculino
                                                                                   Sin riesgo: > 55
   COLESTEROL LDL                                  141.0      *       mg/dL               <100.0
   TRIGLICERIDOS                                   155.0      *       mg/dL               <150.0
   CREATININA EN SUERO                             0.90               mg/dL              0.70 - 1.20
   RELACIÓN BUN/CREATININA                         15.0                                   6.0 - 25.0
   Tipo de muestra: Suero
   UROÁNALISIS
   EXAMEN GENERAL DE ORINA
   ASPECTO                                    Turbio      *                       Claro
   GLUCOSA                                     Normal                 mg/dL          Normal
   LEUCOCITOS                                      3        *       por campo          0-2
   . URATOS AMORFOS                           Escasos
                     En esta hoja encontrarás el resumen comparativo de tu QUÍMICA CLÍNICA.
                                                   01-ENE.-2025      15-MAR.-2026
      GLUCOSA                                  -       99.0             112.0         mg/dL
      COLESTEROL TOTAL                         -       190              210.0         mg/dL
`.split("\n");

describe("parseLabReport", () => {
  const parsed = parseLabReport(REPORT);
  const byKey = (key: string) => parsed.results.find((r) => r.key === key)!;

  it("reads the date, values, units, references and flags", () => {
    expect(parsed.takenAt).toBe("2026-03-15");
    expect(byKey("wbc")).toMatchObject({ group: "blood", value: 6.1, unit: "10^3/µL", ref: "4.23 - 9.07", flagged: false });
    expect(byKey("hemoglobin")).toMatchObject({ value: 12.9, flagged: true });
    expect(byKey("hdl")).toMatchObject({ value: 38, unit: "mg/dL", ref: ">55.0" });
    expect(byKey("bunCreatinine")).toMatchObject({ value: 15, unit: null, ref: "6.0 - 25.0" });
  });

  it("tells urine tests from blood tests with the same name", () => {
    expect(byKey("glucose")).toMatchObject({ group: "blood", value: 112 });
    expect(byKey("uGlucose")).toMatchObject({ group: "urine", value: null, text: "Normal", ref: "Normal" });
    expect(byKey("uWbc")).toMatchObject({ value: 3, unit: "por campo", ref: "0-2", flagged: true });
    expect(byKey("uAspect")).toMatchObject({ text: "Turbio", ref: "Claro", flagged: true });
    expect(byKey("uUrates")).toMatchObject({ text: "Escasos", ref: null });
  });

  it("skips page furniture and reference notes", () => {
    expect(parsed.results.map((r) => r.key)).not.toContain("masculino");
    expect(parsed.results).toHaveLength(13);
  });

  it("returns the older study from the comparison table, with this report's units", () => {
    expect(parsed.previous).toHaveLength(1);
    expect(parsed.previous[0]!.takenAt).toBe("2025-01-01");
    expect(parsed.previous[0]!.results.map((r) => [r.key, r.value, r.unit])).toEqual([
      ["glucose", 99, "mg/dL"],
      ["cholesterol", 190, "mg/dL"],
    ]);
  });
});

const result = (over: Partial<LabResult>): LabResult => ({ key: "x", name: "X", group: "blood", value: null, text: null, unit: null, ref: null, flagged: false, ...over });
const man = { sex: "male" as const, age: 40 };

describe("rangeStatus", () => {
  it("reads ranges, bounds and words", () => {
    expect(rangeStatus(result({ value: 5, ref: "4 - 6" }))).toBe("in");
    expect(rangeStatus(result({ value: 3, ref: "4 - 6" }))).toBe("low");
    expect(rangeStatus(result({ value: 210, ref: "<200.0" }))).toBe("high");
    expect(rangeStatus(result({ value: 1.2, ref: "≤1.20" }))).toBe("in");
    expect(rangeStatus(result({ value: 43, ref: ">55.0" }))).toBe("low");
    expect(rangeStatus(result({ text: "Negativo", ref: "Negativo" }))).toBe("in");
    expect(rangeStatus(result({ text: "Presentes", ref: "Ausentes", flagged: true }))).toBe("off");
  });
});

describe("assess", () => {
  it("uses the ADA cutoffs for fasting glucose", () => {
    expect(assess(result({ key: "glucose", value: 95 }), man).status).toBe("good");
    expect(assess(result({ key: "glucose", value: 112 }), man)).toMatchObject({ status: "warn", note: "glucosePrediabetes" });
    expect(assess(result({ key: "glucose", value: 130 }), man).status).toBe("bad");
  });

  it("uses a lower HDL cutoff for men than for women", () => {
    expect(assess(result({ key: "hdl", value: 45 }), man)).toMatchObject({ status: "warn", note: "hdlAcceptable" });
    expect(assess(result({ key: "hdl", value: 45 }), { sex: "female", age: 40 })).toMatchObject({ status: "bad", note: "hdlLow" });
    expect(assess(result({ key: "hdl", value: 62 }), man).status).toBe("good");
  });

  it("turns creatinine into eGFR", () => {
    expect(Math.round(egfr(0.9, man))).toBe(111);
    expect(assess(result({ key: "creatinine", value: 0.9 }), man)).toMatchObject({ status: "good", vars: { egfr: 111 } });
    expect(assess(result({ key: "creatinine", value: 1.3 }), man).status).toBe("warn");
    expect(assess(result({ key: "creatinine", value: 1.6 }), man).status).toBe("bad");
  });

  it("calls a mildly high lipase a warning, and three times the limit a problem", () => {
    expect(assess(result({ key: "lipase", value: 70, ref: "13.00 - 60.00" }), man).note).toBe("lipaseMild");
    expect(assess(result({ key: "lipase", value: 200, ref: "13.00 - 60.00" }), man).status).toBe("bad");
  });

  it("falls back to the lab's range for everything else", () => {
    expect(assess(result({ key: "iron", value: 100, ref: "33 - 193" }), man)).toMatchObject({ status: "good", note: null });
    expect(assess(result({ key: "iron", value: 20, ref: "33 - 193" }), man)).toMatchObject({ status: "warn", note: "outOfLabRange" });
  });
});

describe("helpers", () => {
  it("computes non-HDL cholesterol and the next yearly study", () => {
    expect(nonHdl([result({ key: "cholesterol", value: 200 }), result({ key: "hdl", value: 50 })])).toBe(150);
    expect(nonHdl([result({ key: "cholesterol", value: 200 })])).toBeNull();
    expect(nextStudyDue("2026-08-29")).toBe("2027-08-29");
  });
});

describe("electrocardiogram", () => {
  // The layout of Salud Digna's report, with made-up values.
  const report = [
    "                   INFORME DE RESULTADOS ELECTROCARDIOGRAMA",
    "                       Fecha de nacimiento:      1/Ene/1990          Fecha toma:     6/Feb/2025 08:29 a. m.",
    "2) INFORME DE RESULTADOS",
    "Ritmo:                      Sinusal                               Frecuencia cardiaca:         58         latidos por minuto",
    "Onda p:                               1.5             mm.                 90                 ms.",
    "Intervalo PR:                         150             ms.",
    "Complejo QRS:                 96",
    "Intervalo QTm:                410                                                                   Eje eléctrico.",
    "Eje eléctrico del QRS (aQRS):               120        grados.",
    "Hipertrofia:                  No                      -",
    "Isquemia:                     Sí                      -",
    "3) HALLAZGOS ELECTROCARDIOGRÁFICOS",
    "Ritmo: Sinusal, Frecuencia: 58 latidos por minuto, resto dentro de parámetros",
    "normales.",
    "4) SUGERENCIAS",
    "        QT / QTc(B)           410 / 470 ms",
    "        Sokolow-Lyon               2.10 mV",
  ];

  it("reads the cardiologist's values, the findings and the machine's QTc", () => {
    const study = parseLabReport(report);
    expect(study.takenAt).toBe("2025-02-06");
    const get = (key: string) => study.results.find((r) => r.key === key);
    expect(get("ecgRhythm")?.text).toBe("Sinusal");
    expect(get("ecgHr")?.value).toBe(58);
    expect(get("ecgP")?.value).toBe(90);
    expect(get("ecgPr")?.value).toBe(150);
    expect(get("ecgQt")?.value).toBe(410);
    expect(get("ecgQtc")?.value).toBe(470);
    expect(get("ecgAxis")?.value).toBe(120);
    expect(get("ecgSokolow")?.value).toBe(2.1);
    expect(get("ecgIschemia")).toMatchObject({ text: "Sí", flagged: true });
    expect(get("ecgReading")?.text).toBe("Ritmo: Sinusal, Frecuencia: 58 latidos por minuto, resto dentro de parámetros normales.");
    expect(study.results.every((r) => r.group === "ecg")).toBe(true);
  });

  it("judges it against the AHA/ACC/HRS cutoffs", () => {
    const study = parseLabReport(report);
    const judge = (key: string) => assess(study.results.find((r) => r.key === key)!, { sex: "male", age: 35 });
    expect(judge("ecgHr")).toMatchObject({ status: "good", note: "ecgHrNormal" });
    expect(judge("ecgQtc")).toMatchObject({ status: "warn", note: "ecgQtcBorderline" });
    expect(judge("ecgAxis")).toMatchObject({ status: "warn", note: "ecgAxisOff" });
    expect(judge("ecgHypertrophy")).toMatchObject({ status: "good", note: "ecgFindingNone" });
    expect(judge("ecgIschemia")).toMatchObject({ status: "warn", note: "ecgFindingPresent" });
    expect(judge("ecgReading")).toMatchObject({ status: "good", note: "ecgReadingNormal" });
  });
});
