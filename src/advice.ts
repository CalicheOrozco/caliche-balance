import { MUSCLE_INDEX_CUTOFFS } from "../shared/composition.ts";
import type { ReadingReport, ReportItem } from "../shared/report.ts";
import { CM_PER_IN, type ProfileDto } from "../shared/schemas.ts";
import { type MessageKey, useI18n } from "./i18n.tsx";
import { useFormat } from "./ui.tsx";

/** The plain-language comment for one rated measure, shared by the weigh-in detail and History. */
export function useAdvice(profile: ProfileDto): (item: ReportItem, report: ReadingReport) => string {
  const { tf } = useI18n();
  const f = useFormat();
  const waistUnit = profile.unit === "lb" ? "in" : "cm";
  const { low, moderate } = MUSCLE_INDEX_CUTOFFS[profile.sex];
  return (item, report) => {
    const amount =
      item.toHealthy === null
        ? ""
        : item.key === "waist"
          ? `${f.number(waistUnit === "in" ? item.toHealthy / CM_PER_IN : item.toHealthy)} ${waistUnit}`
          : f.weight(item.toHealthy, profile.unit);
    return tf(`advice.${item.key}.${item.band.key}` as MessageKey, {
      amount,
      min: f.number(report.fatRange.min, 0),
      max: f.number(report.fatRange.max, 0),
      obese: f.number(report.fatRange.obese, 0),
      low: f.number(low, 2),
      moderate: f.number(moderate, 2),
    });
  };
}
