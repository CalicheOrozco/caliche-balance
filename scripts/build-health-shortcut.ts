/**
 * Builds the "Caliche Salud" iOS Shortcut that sends today's Apple Health data to Caliche Balance,
 * and signs it so it can be added on an iPhone with one tap.
 *
 *   npx tsx scripts/build-health-shortcut.ts https://caliche-balance.vercel.app
 *
 * Needs macOS (only `shortcuts sign` can sign a Shortcut). Writes public/shortcuts/caliche-salud.shortcut.
 *
 * Actions come from the metric table in shared/health.ts, so the app and the Shortcut never
 * disagree on names or units. Their formats were read from real Shortcuts, including one built on
 * the owner's iPhone (iOS 26): "Find Health Samples" grouped by day ("WFHKSampleFilteringGroupBy"),
 * latest first, limited to 1, gives the day's total the way the Health app counts it. Sleep sends
 * every sample of the last 36 hours as "start|end|stage" lines and the server adds them up. Values
 * go with their unit; the server converts them (asking for a unit here made Health find nothing).
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dateField, HEALTH_METRIC_SPECS, HEALTH_SHORTCUT_VERSION, HEALTH_METRICS, HEALTH_SYMPTOM_KEYS, HEALTH_SYMPTOMS, symptomField } from "../shared/health.ts";

const OBJ = "￼"; // where a variable sits inside a Shortcuts text field
const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT = join(ROOT, "public", "shortcuts", "caliche-salud.shortcut");
/** NSCalendarUnit values the date filter uses. */
const DAY = 16;
const HOUR = 32;
/** "Start Date is in the last N <unit>". */
const IN_THE_LAST = 1002;
/**
 * How far back to look for the latest day with data. Asking only for today fails ("No Samples
 * Found") right after midnight or on days without data, so each value goes with its own date.
 */
const METRIC_DAYS = 7;
const SYMPTOM_DAYS = 30;

/** A number Shortcuts stores as a real even when it is whole (the result limit). */
class Real {
  constructor(readonly value: number) {}
}
type Plist = string | number | boolean | Real | Plist[] | { [key: string]: Plist };

// ---- XML property list ----------------------------------------------------------------------

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toXml(value: Plist, indent = ""): string {
  const next = `${indent}\t`;
  if (typeof value === "string") return `${indent}<string>${escape(value)}</string>`;
  if (typeof value === "boolean") return `${indent}<${value}/>`;
  if (value instanceof Real) return `${indent}<real>${value.value}</real>`;
  if (typeof value === "number") return Number.isInteger(value) ? `${indent}<integer>${value}</integer>` : `${indent}<real>${value}</real>`;
  if (Array.isArray(value)) return `${indent}<array>\n${value.map((v) => toXml(v, next)).join("\n")}\n${indent}</array>`;
  const entries = Object.entries(value).map(([k, v]) => `${next}<key>${escape(k)}</key>\n${toXml(v, next)}`);
  return `${indent}<dict>\n${entries.join("\n")}\n${indent}</dict>`;
}

// ---- Action builders ------------------------------------------------------------------------

const uuid = () => randomUUID().toUpperCase();
const text = (value: string): Plist => ({ Value: { string: value }, WFSerializationType: "WFTextTokenString" });
const output = (actionUuid: string, name: string, aggrandizements?: Plist[]) => ({
  Type: "ActionOutput",
  OutputName: name,
  OutputUUID: actionUuid,
  ...(aggrandizements ? { Aggrandizements: aggrandizements } : {}),
});
/** A text field made of fixed text and earlier actions' outputs, e.g. ["Bearer ", ref]. */
function tokens(parts: (string | Record<string, Plist>)[]): Plist {
  let string = "";
  const attachments: Record<string, Plist> = {};
  for (const part of parts) {
    if (typeof part === "string") string += part;
    else {
      attachments[`{${string.length}, 1}`] = part;
      string += OBJ;
    }
  }
  return { Value: { string, attachmentsByRange: attachments }, WFSerializationType: "WFTextTokenString" };
}
const attachment = (ref: Record<string, Plist>): Plist => ({ Value: ref, WFSerializationType: "WFTextTokenAttachment" });
const action = (identifier: string, params: Record<string, Plist>): Plist => ({ WFWorkflowActionIdentifier: identifier, WFWorkflowActionParameters: params });

function findHealth(type: string, opts: { window: [number, number]; groupByDay: boolean; limit: number | null }) {
  const id = uuid();
  const params: Record<string, Plist> = {
    UUID: id,
    WFContentItemFilter: {
      WFSerializationType: "WFContentPredicateTableTemplate",
      Value: {
        WFActionParameterFilterPrefix: 1,
        WFContentPredicateBoundedDate: false,
        WFActionParameterFilterTemplates: [
          { Property: "Type", Operator: 4, Removable: false, Bounded: true, Values: { Enumeration: { WFSerializationType: "WFStringSubstitutableState", Value: type } } },
          { Property: "Start Date", Operator: IN_THE_LAST, Removable: false, Bounded: true, Values: { Unit: opts.window[1], Number: String(opts.window[0]) } },
        ],
      },
    },
    WFContentItemSortProperty: "Start Date",
    WFContentItemSortOrder: "Latest First",
  };
  if (opts.limit !== null) {
    params.WFContentItemLimitEnabled = true;
    params.WFContentItemLimitNumber = new Real(opts.limit);
  }
  if (opts.groupByDay) params.WFHKSampleFilteringGroupBy = "Day";
  return { id, action: action("is.workflow.actions.filter.health.quantity", params) };
}

function details(input: Plist, property: string) {
  const id = uuid();
  return { id, action: action("is.workflow.actions.properties.health.quantity", { UUID: id, WFInput: input, WFContentItemPropertyName: property }) };
}

const ISO_DATE: Plist[] = [
  { Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFDateContentItem" },
  { Type: "WFDateFormatVariableAggrandizement", WFDateFormatStyle: "ISO 8601", WFISO8601IncludeTime: true },
];

// ---- The Shortcut ---------------------------------------------------------------------------

function build(baseUrl: string): Record<string, Plist> {
  const actions: Plist[] = [];
  const fields: Plist[] = [];
  const field = (key: string, value: Plist) => fields.push({ WFItemType: 0, WFKey: text(key), WFValue: value });

  // 0: the person's key, filled in by the import question when the Shortcut is added.
  const keyId = uuid();
  actions.push(action("is.workflow.actions.gettext", { UUID: keyId, WFTextActionText: text("") }));

  // One value per metric: the latest day's group, with its unit ("1,935 kcal") and its date. Health
  // gives values in the person's preferred unit; the server converts them.
  for (const metric of HEALTH_METRICS) {
    const found = findHealth(HEALTH_METRIC_SPECS[metric].type, { window: [METRIC_DAYS, DAY], groupByDay: true, limit: 1 });
    const samples = attachment(output(found.id, "Health Samples"));
    const value = details(samples, "Value");
    const unit = details(samples, "Unit");
    const date = details(samples, "Start Date");
    actions.push(found.action, value.action, unit.action, date.action);
    field(metric, tokens([output(value.id, "Value"), " ", output(unit.id, "Unit")]));
    field(dateField(metric), tokens([output(date.id, "Start Date", ISO_DATE)]));
  }

  // Symptoms: the latest one logged and its date ("Mild", "Present"...).
  for (const symptom of HEALTH_SYMPTOM_KEYS) {
    const found = findHealth(HEALTH_SYMPTOMS[symptom], { window: [SYMPTOM_DAYS, DAY], groupByDay: false, limit: 1 });
    const samples = attachment(output(found.id, "Health Samples"));
    const value = details(samples, "Value");
    const date = details(samples, "Start Date");
    actions.push(found.action, value.action, date.action);
    field(symptomField(symptom), tokens([output(value.id, "Value")]));
    field(dateField(symptomField(symptom)), tokens([output(date.id, "Start Date", ISO_DATE)]));
  }

  // Sleep: every sample of the last 36 hours (last night, even when it started early) as lines.
  const sleep = findHealth("Sleep", { window: [36, HOUR], groupByDay: false, limit: null });
  const group = uuid();
  const repeatEnd = uuid();
  const item = attachment({ Type: "Variable", VariableName: "Repeat Item" });
  const start = details(item, "Start Date");
  const end = details(item, "End Date");
  const stage = details(item, "Value");
  const lineId = uuid();
  const combinedId = uuid();
  actions.push(
    sleep.action,
    action("is.workflow.actions.repeat.each", { UUID: uuid(), GroupingIdentifier: group, WFControlFlowMode: 0, WFInput: attachment(output(sleep.id, "Health Samples")) }),
    start.action,
    end.action,
    stage.action,
    action("is.workflow.actions.gettext", {
      UUID: lineId,
      WFTextActionText: tokens([output(start.id, "Start Date", ISO_DATE), "|", output(end.id, "End Date", ISO_DATE), "|", output(stage.id, "Value")]),
    }),
    action("is.workflow.actions.repeat.each", { UUID: repeatEnd, GroupingIdentifier: group, WFControlFlowMode: 2 }),
    action("is.workflow.actions.text.combine", { UUID: combinedId, WFTextSeparator: "New Lines", text: attachment(output(repeatEnd, "Repeat Results")) }),
  );
  field("sleep", tokens([output(combinedId, "Combined Text")]));
  // Lets Settings tell this copy from an older one.
  field("shortcutVersion", text(String(HEALTH_SHORTCUT_VERSION)));

  actions.push(
    action("is.workflow.actions.downloadurl", {
      UUID: uuid(),
      WFURL: text(`${baseUrl.replace(/\/$/, "")}/api/apple-health/ingest`),
      WFHTTPMethod: "POST",
      ShowHeaders: true,
      WFHTTPHeaders: {
        WFSerializationType: "WFDictionaryFieldValue",
        Value: {
          WFDictionaryFieldValueItems: [
            { WFItemType: 0, WFKey: text("Authorization"), WFValue: tokens(["Bearer ", output(keyId, "Text")]) },
            { WFItemType: 0, WFKey: text("Content-Type"), WFValue: text("application/json") },
          ],
        },
      },
      WFHTTPBodyType: "JSON",
      WFJSONValues: { WFSerializationType: "WFDictionaryFieldValue", Value: { WFDictionaryFieldValueItems: fields } },
    }),
  );

  return {
    WFWorkflowClientVersion: "5037.111",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 4292093695, WFWorkflowIconGlyphNumber: 59754 },
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowInputContentItemClasses: ["WFStringContentItem"],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowImportQuestions: [
      {
        ActionIndex: 0,
        Category: "Parameter",
        ParameterKey: "WFTextActionText",
        DefaultValue: "",
        Text: "Pega tu llave de Caliche Balance (Ajustes > Apple Salud > Crear mi llave). Paste your Caliche Balance key.",
      },
    ],
    WFWorkflowActions: actions,
  };
}

const baseUrl = process.argv[2];
if (!baseUrl?.startsWith("https://")) {
  console.error("usage: npx tsx scripts/build-health-shortcut.ts https://your-app.vercel.app");
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), "caliche-shortcut-"));
const xml = join(dir, "Caliche Salud.xml");
const unsigned = join(dir, "Caliche Salud.shortcut");
writeFileSync(
  xml,
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${toXml(build(baseUrl))}\n</plist>\n`,
);
execFileSync("plutil", ["-convert", "binary1", "-o", unsigned, xml]);
mkdirSync(join(ROOT, "public", "shortcuts"), { recursive: true });
execFileSync("shortcuts", ["sign", "--mode", "anyone", "--input", unsigned, "--output", OUTPUT]);
console.log(`signed: public/shortcuts/caliche-salud.shortcut (version ${HEALTH_SHORTCUT_VERSION}, ${HEALTH_METRICS.length} metrics, ${HEALTH_SYMPTOM_KEYS.length} symptoms, sleep)`);
