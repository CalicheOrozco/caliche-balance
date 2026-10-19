import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { parseDecimal, type ProfileDto, toKilograms } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { useI18n } from "../i18n.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { Button, Card, Field } from "../ui.tsx";

/** Current local date ("yyyy-MM-dd") and time ("HH:mm"). */
function nowLocal(): { date: string; time: string } {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

const optional = (s: string) => (s.trim() === "" ? null : s);

/** Mass fields are typed in the profile unit and sent in kilograms. */
function massInKg(s: string, unit: "kg" | "lb"): unknown {
  const n = parseDecimal(optional(s));
  return typeof n === "number" ? toKilograms(n, unit) : n;
}

export function AddPage({ profile }: { profile: ProfileDto }) {
  const { t, te } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => nowLocal().date);
  const [time, setTime] = useState(() => nowLocal().time);
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [muscle, setMuscle] = useState("");
  const [water, setWater] = useState("");
  const [bone, setBone] = useState("");
  const [visceral, setVisceral] = useState("");
  const [waist, setWaist] = useState("");
  // Waist goes in inches for people who weigh in pounds, centimeters otherwise.
  const waistUnit = profile.unit === "lb" ? "in" : "cm";
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    // Numbers go as text; the shared schema parses decimal commas and converts units once.
    mutationFn: () =>
      api.addMeasurement({
        measuredAt: new Date(`${date}T${time}`).toISOString(),
        weight,
        weightUnit: profile.unit,
        bodyFatPct: optional(bodyFat),
        muscleKg: massInKg(muscle, profile.unit),
        waterPct: optional(water),
        boneKg: massInKg(bone, profile.unit),
        visceralFat: optional(visceral),
        waist: optional(waist),
        waistUnit,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["measurements"] });
      navigate("/");
    },
    onError: (e) => setError(te(e)),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("addTitle")}</h1>
        <p className="text-ink-2">{t("addIntro")}</p>
      </div>
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          {/* Fixed shares: an "auto" column grows to iOS Safari's wide native time input and overflows. */}
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <DatePicker label={t("measuredAt")} value={date} onChange={setDate} maxDate={new Date()} required />
            <Field label={t("time")} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("weight")} (${profile.unit})`} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} required />
            <Field label={`${t("bodyFat")} (%)`} inputMode="decimal" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} />
          </div>
          <Field
            label={`${t("waist")} (${waistUnit})`}
            inputMode="decimal"
            value={waist}
            onChange={(e) => setWaist(e.target.value)}
            help={t("waistHowTo")}
          />
          <p className="pt-2 text-sm font-semibold text-ink-2">{t("optionalXiaomi")}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("muscle")} (${profile.unit})`} inputMode="decimal" value={muscle} onChange={(e) => setMuscle(e.target.value)} />
            <Field label={`${t("water")} (%)`} inputMode="decimal" value={water} onChange={(e) => setWater(e.target.value)} />
            <Field label={`${t("bone")} (${profile.unit})`} inputMode="decimal" value={bone} onChange={(e) => setBone(e.target.value)} />
            <Field label={t("visceral")} inputMode="decimal" value={visceral} onChange={(e) => setVisceral(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="rounded-2xl bg-bad/15 px-4 py-3 text-sm text-bad">
              {error}
            </p>
          )}
          <Button type="submit" disabled={save.isPending} className="w-full">
            {t("save")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
