import { Link } from "react-router";
import { assess, type SourceId } from "../../shared/reference.ts";
import type { MeasurementDto, ProfileDto } from "../../shared/schemas.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Card, RangeBar, StatusBadge, useFormat } from "../ui.tsx";

export function HomePage({ profile, measurements, username }: { profile: ProfileDto; measurements: MeasurementDto[]; username: string }) {
  const { t } = useI18n();
  const f = useFormat();
  const latest = measurements[0];
  const name = profile.displayName ?? username;

  if (!latest) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">
          {t("hello")}, {name}
        </h1>
        <Card className="text-center">
          <h2 className="text-lg font-semibold">{t("noMeasurements")}</h2>
          <p className="mt-2 text-ink-2">{t("noMeasurementsBody")}</p>
          <div className="mt-5 flex flex-col gap-3">
            <Link to="/ajustes" className="rounded-2xl bg-brand px-4 py-3 font-semibold text-brand-ink">
              {t("connectScale")}
            </Link>
            <Link to="/agregar" className="rounded-2xl bg-surface-2 px-4 py-3 font-medium">
              {t("addManually")}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Weigh-ins without bare feet only have weight; body composition comes from the newest full one.
  const comp = measurements.find((m) => m.bodyFatPct !== null) ?? null;
  const result = assess(
    { sex: profile.sex, birthDate: new Date(`${profile.birthDate}T00:00:00Z`), heightCm: profile.heightCm },
    { measuredAt: new Date(latest.measuredAt), weightKg: latest.weightKg, bodyFatPct: comp?.bodyFatPct ?? null },
  );
  const sources: SourceId[] = ["who-bmi", "who-asian-bmi", "mifflin-st-jeor"];
  if (result.bodyFat) sources.splice(1, 0, "gallagher-2000", "ace");
  const v = (n: number | null | undefined) => n !== null && n !== undefined;
  const xiaomi = comp
    ? [
        v(comp.muscleKg) && { label: t("muscle"), value: f.weight(comp.muscleKg!, profile.unit) },
        v(comp.waterPct) && { label: t("water"), value: `${f.number(comp.waterPct!)} %` },
        v(comp.boneKg) && { label: t("bone"), value: f.weight(comp.boneKg!, profile.unit) },
        v(comp.visceralFat) && { label: t("visceral"), value: f.number(comp.visceralFat!, 0) },
        v(comp.proteinPct) && { label: t("protein"), value: `${f.number(comp.proteinPct!)} %` },
        v(comp.bmrKcal) && { label: t("bmrZepp"), value: `${f.number(comp.bmrKcal!, 0)} kcal` },
        v(comp.bodyAge) && { label: t("bodyAge"), value: f.number(comp.bodyAge!, 0) },
        v(comp.bodyScore) && { label: t("bodyScore"), value: f.number(comp.bodyScore!, 0) },
        v(comp.idealWeightKg) && { label: t("idealWeight"), value: f.weight(comp.idealWeightKg!, profile.unit) },
        v(comp.impedance) && { label: t("impedance"), value: `${f.number(comp.impedance!, 0)} Ω` },
      ].filter((x) => x !== false)
    : [];
  const compNote = comp && comp.id !== latest.id ? t("compositionFrom").replace("{date}", f.date(comp.measuredAt)) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {t("hello")}, {name}
        </h1>
        <p className="text-ink-2">
          {t("lastMeasurement")}: {f.dateTime(latest.measuredAt)}
        </p>
      </div>

      {result.notes.map((note) => (
        <p key={note} className="rounded-2xl bg-warn/15 px-4 py-3 text-sm text-ink">
          {t(`note.${note}` as MessageKey)}
        </p>
      ))}

      <Card>
        <p className="text-sm font-medium text-ink-2">{t("weight")}</p>
        <p className="mt-1 text-5xl font-bold tracking-tight">{f.weight(latest.weightKg, profile.unit)}</p>
        <p className="mt-3 text-sm text-ink-2">
          {t("healthyWeight")}: {f.weight(result.healthyWeight.min, profile.unit)} {t("rangeTo")} {f.weight(result.healthyWeight.max, profile.unit)}
        </p>
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-2">{t("bmi")}</p>
            <p className="mt-1 text-3xl font-bold">{f.number(result.bmi.value)}</p>
          </div>
          <StatusBadge band={result.bmi.band} />
        </div>
        <RangeBar classification={result.bmi} format={(n) => f.number(n)} />
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {t("asianComparison")} <StatusBadge band={result.bmiAsian.band} />
        </p>
      </Card>

      {compNote && <p className="px-1 text-sm text-muted">{compNote}</p>}

      {result.bodyFat && result.bodyFatAce && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink-2">{t("bodyFat")}</p>
              <p className="mt-1 text-3xl font-bold">{f.number(result.bodyFat.value)} %</p>
            </div>
            <StatusBadge band={result.bodyFat.band} />
          </div>
          <RangeBar classification={result.bodyFat} format={(n) => `${f.number(n, 0)}%`} />
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            {t("aceCategory")} <StatusBadge band={result.bodyFatAce.band} />
          </p>
        </Card>
      )}

      <Card>
        <p className="text-sm font-medium text-ink-2">{t("bmr")}</p>
        <p className="mt-1 text-3xl font-bold">
          {f.number(result.bmrKcal, 0)} <span className="text-lg font-medium text-ink-2">{t("kcalDay")}</span>
        </p>
      </Card>

      {xiaomi.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">{t("xiaomiValues")}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {xiaomi.map((x) => (
              <div key={x.label} className="rounded-2xl bg-surface-2 p-3">
                <dt className="text-sm text-ink-2">{x.label}</dt>
                <dd className="text-xl font-semibold">{x.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">{t("xiaomiNote")}</p>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">{t("sources")}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-2">
          {sources.map((s) => (
            <li key={s}>{t(`source.${s}` as MessageKey)}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t("disclaimer")}</p>
      </Card>
    </div>
  );
}
