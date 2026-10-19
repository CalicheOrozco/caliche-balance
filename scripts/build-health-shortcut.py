#!/usr/bin/env python3
"""
Builds the "Caliche Salud" iOS Shortcut that sends today's Apple Health totals to Caliche Balance,
and signs it so it can be added on an iPhone with one tap.

    python3 scripts/build-health-shortcut.py https://caliche-balance.vercel.app

Needs macOS (only `shortcuts sign` can sign a Shortcut). Writes public/shortcuts/caliche-salud.shortcut.

The action formats come from real shared Shortcuts (Find Health Samples, Get Details of Health
Sample, Get Contents of URL), not from guesses. Each metric is read as one sample: grouped by day,
latest first, limited to 1, so it is today's total the way the Health app counts it (an iPhone and
an Apple Watch are not counted twice) in a fixed unit. When the Shortcut is added it asks for the
person's key, which goes into the Authorization header.
"""

import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

OBJ = "￼"  # where a variable sits inside a Shortcuts text field
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public" / "shortcuts" / "caliche-salud.shortcut"

# (JSON field the API reads, Health type as Shortcuts names it, unit, grouped by day)
METRICS = [
    ("steps", "Steps", "count", True),
    ("activeKcal", "Active Energy", "kcal", True),
    ("exerciseMin", "Exercise Minutes", "min", True),
    ("distanceKm", "Walking + Running Distance", "km", True),
    # Resting heart rate is one value a day already: the latest one.
    ("restingHr", "Resting Heart Rate", "count/min", False),
]


def new_uuid() -> str:
    return str(uuid.uuid4()).upper()


def text(value: str) -> dict:
    return {"Value": {"string": value}, "WFSerializationType": "WFTextTokenString"}


def output_ref(action_uuid: str, name: str, prefix: str = "") -> dict:
    """A text field holding the output of an earlier action, optionally after some fixed text."""
    return {
        "Value": {
            "string": f"{prefix}{OBJ}",
            "attachmentsByRange": {f"{{{len(prefix)}, 1}}": {"Type": "ActionOutput", "OutputName": name, "OutputUUID": action_uuid}},
        },
        "WFSerializationType": "WFTextTokenString",
    }


def find_health(type_name: str, unit: str, by_day: bool) -> tuple[dict, str]:
    action_uuid = new_uuid()
    params = {
        "UUID": action_uuid,
        "WFContentItemFilter": {
            "Value": {
                "WFActionParameterFilterPrefix": 1,
                "WFContentPredicateBoundedDate": False,
                "WFActionParameterFilterTemplates": [
                    {
                        "Property": "Type",
                        "Operator": 4,  # is
                        "Values": {"Enumeration": {"Value": type_name, "WFSerializationType": "WFStringSubstitutableState"}},
                        "Removable": False,
                        "Bounded": True,
                    },
                    {
                        "Property": "Start Date",
                        "Operator": 1002,  # is in the last (1 day): keeps the query small
                        "Values": {
                            "Unit": {"Value": 16, "WFSerializationType": "WFCalendarUnitSubstitutableState"},
                            "Number": {"Value": "1", "WFSerializationType": "WFNumberStringSubstitutableState"},
                        },
                        "Removable": True,
                        "Bounded": True,
                    },
                ],
            },
            "WFSerializationType": "WFContentPredicateTableTemplate",
        },
        "WFContentItemSortProperty": "Start Date",
        "WFContentItemSortOrder": "Latest First",
        "WFContentItemLimitEnabled": True,
        "WFContentItemLimitNumber": 1.0,
        "WFHKSampleFilteringUnit": unit,
        "WFHKSampleFilteringFillMissing": False,
    }
    if by_day:
        params["WFHKSampleFilteringGroupBy"] = "Day"
    return {"WFWorkflowActionIdentifier": "is.workflow.actions.filter.health.quantity", "WFWorkflowActionParameters": params}, action_uuid


def sample_value(samples_uuid: str) -> tuple[dict, str]:
    action_uuid = new_uuid()
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.properties.health.quantity",
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFContentItemPropertyName": "Value",
            "WFInput": {
                "Value": {"Type": "ActionOutput", "OutputName": "Health Samples", "OutputUUID": samples_uuid},
                "WFSerializationType": "WFTextTokenAttachment",
            },
        },
    }, action_uuid


def build(base_url: str) -> dict:
    actions = []
    key_uuid = new_uuid()
    # Filled in by the import question when the Shortcut is added.
    actions.append({"WFWorkflowActionIdentifier": "is.workflow.actions.gettext", "WFWorkflowActionParameters": {"UUID": key_uuid, "WFTextActionText": ""}})
    fields = []
    for field, type_name, unit, by_day in METRICS:
        find, find_uuid = find_health(type_name, unit, by_day)
        value, value_uuid = sample_value(find_uuid)
        actions += [find, value]
        fields.append({"WFItemType": 0, "WFKey": text(field), "WFValue": output_ref(value_uuid, "Value")})
    actions.append(
        {
            "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
            "WFWorkflowActionParameters": {
                "UUID": new_uuid(),
                "WFURL": text(f"{base_url.rstrip('/')}/api/apple-health/ingest"),
                "WFHTTPMethod": "POST",
                "ShowHeaders": True,
                "WFHTTPHeaders": {
                    "Value": {
                        "WFDictionaryFieldValueItems": [
                            {"WFItemType": 0, "WFKey": text("Authorization"), "WFValue": output_ref(key_uuid, "Text", "Bearer ")},
                            {"WFItemType": 0, "WFKey": text("Content-Type"), "WFValue": text("application/json")},
                        ]
                    },
                    "WFSerializationType": "WFDictionaryFieldValue",
                },
                "WFHTTPBodyType": "JSON",
                "WFJSONValues": {"Value": {"WFDictionaryFieldValueItems": fields}, "WFSerializationType": "WFDictionaryFieldValue"},
            },
        }
    )
    return {
        "WFWorkflowClientVersion": "3218.0.9",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4292093695, "WFWorkflowIconGlyphNumber": 59754},
        "WFWorkflowTypes": [],
        "WFQuickActionSurfaces": [],
        "WFWorkflowInputContentItemClasses": ["WFStringContentItem"],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowImportQuestions": [
            {
                "ActionIndex": 0,
                "Category": "Parameter",
                "ParameterKey": "WFTextActionText",
                "DefaultValue": "",
                "Text": "Pega tu llave de Caliche Balance (Ajustes > Apple Salud > Crear mi llave). Paste your Caliche Balance key.",
            }
        ],
        "WFWorkflowActions": actions,
    }


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
        sys.exit("usage: build-health-shortcut.py https://your-app.vercel.app")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = Path(tmp) / "Caliche Salud.shortcut"
        with unsigned.open("wb") as f:
            plistlib.dump(build(sys.argv[1]), f, fmt=plistlib.FMT_BINARY)
        subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(OUTPUT)], check=True)
    print(f"signed: {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
