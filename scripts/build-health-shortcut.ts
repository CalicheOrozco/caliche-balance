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
 * the owner's iPhone (iOS 26), and the query settings copy the ones that work there (see
 * findHealth). Every query sends one line per item ("day|value|unit" for metrics, "start|end|stage"
 * for sleep) through Repeat with Each, the pattern published Health-to-API Shortcuts use; the
 * server owns parsing, units, dates and daily averages.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HEALTH_METRIC_SPECS, HEALTH_SHORTCUT_VERSION, HEALTH_METRICS, HEALTH_SYMPTOM_KEYS, HEALTH_SYMPTOMS, symptomField } from "../shared/health.ts";

const OBJ = "￼"; // where a variable sits inside a Shortcuts text field
const ROOT = resolve(import.meta.dirname, "..");
const SHORTCUTS = join(ROOT, "public", "shortcuts");
/** NSCalendarUnit values the date filter uses. */
const DAY = 16;
const HOUR = 32;
/**
 * "Start Date is in the last N <unit>". 1002 is "is today" (it was used here by mistake and made
 * every query return today only); dates compared with an amount of time are 1000 for "in the next"
 * and 1001 for "in the last", as the Cherri Shortcuts compiler writes them.
 */
const IN_THE_LAST = 1001;
/** How far each query looks back. */
interface Windows {
  metricDays: number;
  symptomDays: number;
  sleepHours: number;
  /** The year Shortcut, which honors each type's `yearDays`. */
  year?: boolean;
}

/**
 * The daily Shortcut: a week back, so today with no data yet does not fail and days missed by
 * earlier runs fill in; 3 days of sleep, the last two full nights.
 */
const DAILY: Windows = { metricDays: 7, symptomDays: 30, sleepHours: 72 };
/**
 * The one-time Shortcut that brings in a year. Types recorded about every minute (energy) look back
 * less (their `yearDays`), as do sound levels (2 days) and sleep (120 days, thousands of stretches):
 * with a whole year of them Shortcuts ran out of room and stopped.
 */
const YEAR: Windows = { metricDays: 366, symptomDays: 366, sleepHours: 120 * 24, year: true };

type Plist = string | number | boolean | Plist[] | { [key: string]: Plist };

// ---- XML property list ----------------------------------------------------------------------

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toXml(value: Plist, indent = ""): string {
  const next = `${indent}\t`;
  if (typeof value === "string") return `${indent}<string>${escape(value)}</string>`;
  if (typeof value === "boolean") return `${indent}<${value}/>`;
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

/**
 * Set up as on the owner's iPhone, where these queries return every day of the week: sorted by
 * start date, latest first, no limit (with "Group By" a limit cut the samples before adding them
 * up). Grouped by day with "Fill Missing", so a day without data is a 0 and not a "No Samples
 * Found" alert.
 */
function findHealth(type: string, opts: { window: [number, number]; groupByDay: boolean }) {
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
          // Written as substitutable states, as in published Shortcuts.
          {
            Property: "Start Date",
            Operator: IN_THE_LAST,
            Removable: false,
            Bounded: true,
            Values: {
              Unit: { Value: opts.window[1], WFSerializationType: "WFCalendarUnitSubstitutableState" },
              Number: { Value: String(opts.window[0]), WFSerializationType: "WFNumberStringSubstitutableState" },
            },
          },
        ],
      },
    },
    WFContentItemSortProperty: "Start Date",
    WFContentItemSortOrder: "Latest First",
    WFContentItemLimitEnabled: false,
  };
  if (opts.groupByDay) {
    params.WFHKSampleFilteringGroupBy = "Day";
    params.WFHKSampleFilteringFillMissing = true;
  }
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

function build(baseUrl: string, windows: Windows): Record<string, Plist> {
  const actions: Plist[] = [];
  const fields: Plist[] = [];
  const field = (key: string, value: Plist) => fields.push({ WFItemType: 0, WFKey: text(key), WFValue: value });

  // 0: the person's key, filled in by the import question when the Shortcut is added.
  const keyId = uuid();
  actions.push(action("is.workflow.actions.gettext", { UUID: keyId, WFTextActionText: text("") }));

  /**
   * One line per item found: Repeat with Each, Get Details for each property, a Text line with them
   * joined by "|", and the lines combined. Returns the field value for the JSON body.
   */
  const lines = (foundId: string, properties: string[]) => {
    const group = uuid();
    const repeatEnd = uuid();
    const combinedId = uuid();
    const item = attachment({ Type: "Variable", VariableName: "Repeat Item" });
    const got = properties.map((property) => ({ property, ...details(item, property) }));
    const lineParts = got.flatMap((g, i) => [...(i ? ["|"] : []), output(g.id, g.property, g.property.endsWith("Date") ? ISO_DATE : undefined)]);
    actions.push(
      action("is.workflow.actions.repeat.each", { UUID: uuid(), GroupingIdentifier: group, WFControlFlowMode: 0, WFInput: attachment(output(foundId, "Health Samples")) }),
      ...got.map((g) => g.action),
      action("is.workflow.actions.gettext", { UUID: uuid(), WFTextActionText: tokens(lineParts) }),
      action("is.workflow.actions.repeat.each", { UUID: repeatEnd, GroupingIdentifier: group, WFControlFlowMode: 2 }),
      action("is.workflow.actions.text.combine", { UUID: combinedId, WFTextSeparator: "New Lines", text: attachment(output(repeatEnd, "Repeat Results")) }),
    );
    return tokens([output(combinedId, "Combined Text")]);
  };

  // Metrics: the last week as "day|value|unit" lines, one per day (grouped by Health); readings
  // that still come one by one are averaged per day on the server.
  // Health gives the person's preferred unit; the server converts it and files each value on its day.
  for (const metric of HEALTH_METRICS) {
    const spec = HEALTH_METRIC_SPECS[metric];
    const found = findHealth(spec.type, { window: [Math.min(spec.days ?? windows.metricDays, windows.metricDays, windows.year ? (spec.yearDays ?? Infinity) : Infinity), DAY], groupByDay: spec.groupByDay ?? true });
    actions.push(found.action);
    field(metric, lines(found.id, ["Start Date", "Value", "Unit"]));
  }

  // Symptoms logged in the last month, as "when|value" ("Mild", "Present"...).
  for (const symptom of HEALTH_SYMPTOM_KEYS) {
    const found = findHealth(HEALTH_SYMPTOMS[symptom], { window: [windows.symptomDays, DAY], groupByDay: false });
    actions.push(found.action);
    field(symptomField(symptom), lines(found.id, ["Start Date", "Value"]));
  }

  // Sleep: every sample of the last 3 days as "start|end|stage"; the server splits them into nights.
  const sleep = findHealth("Sleep", { window: [windows.sleepHours, HOUR], groupByDay: false });
  actions.push(sleep.action);
  field("sleep", lines(sleep.id, ["Start Date", "End Date", "Value"]));
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
/** Writes, converts and signs one Shortcut; its file name is the name it gets on the iPhone. */
function write(file: string, windows: Windows) {
  const dir = mkdtempSync(join(tmpdir(), "caliche-shortcut-"));
  const xml = join(dir, "Caliche Salud.xml");
  const unsigned = join(dir, "Caliche Salud.shortcut");
  writeFileSync(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${toXml(build(baseUrl, windows))}\n</plist>\n`,
  );
  execFileSync("plutil", ["-convert", "binary1", "-o", unsigned, xml]);
  mkdirSync(SHORTCUTS, { recursive: true });
  execFileSync("shortcuts", ["sign", "--mode", "anyone", "--input", unsigned, "--output", join(SHORTCUTS, file)]);
  console.log(`signed: public/shortcuts/${file} (version ${HEALTH_SHORTCUT_VERSION}, ${HEALTH_METRICS.length} metrics, ${HEALTH_SYMPTOM_KEYS.length} symptoms, sleep; ${windows.metricDays} days)`);
}

write("caliche-salud.shortcut", DAILY);
write("caliche-salud-anio.shortcut", YEAR);
