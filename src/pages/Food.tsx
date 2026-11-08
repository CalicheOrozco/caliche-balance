import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiInfo, FiPlus } from "react-icons/fi";
import { type FoodEntryDto, type FoodEntryInput, foodTotals, kcalFromMacros, type Meal, mealAt, MEALS } from "../../shared/food.ts";
import type { MeasurementDto, ProfileDto, UserDto } from "../../shared/schemas.ts";
import { api } from "../api.ts";
import { localIso, shiftDay, spentOf, useFood } from "../foodData.ts";
import { useHealthDays } from "../appleHealth.tsx";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { Button, Callout, Card, Field, Modal, Progress, Segmented, useFormat } from "../ui.tsx";
import { FoodTabs, TodayPlan } from "./Diet.tsx";

/** Recommended protein: 1.6 g per kg (ISSN position stand, losing fat while keeping muscle). */
const proteinTarget = (weightKg: number) => Math.round(weightKg * 1.6);
/** Daily fiber: 38 g for men and 25 g for women (Institute of Medicine). */
const fiberTarget = (sex: ProfileDto["sex"]) => (sex === "male" ? 38 : 25);

export function FoodPage({ user, profile, measurements }: { user: UserDto; profile: ProfileDto; measurements: MeasurementDto[] }) {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const today = localIso(Date.now());
  const [date, setDate] = useState(today);
  const [editing, setEditing] = useState<FoodEntryDto | "new" | null>(null);
  const month = useFood(today);
  // Days older than the month already loaded come on their own.
  const recentDay = date >= shiftDay(today, -29);
  const older = useFood(date, !recentDay);
  const all = recentDay ? (month.data ?? []) : (older.data ?? []);
  const entries = all.filter((e) => e.date === date);
  const health = useHealthDays(user.appleHealth != null).data ?? [];
  const spent = spentOf(health.find((d) => d.date === date));
  const totals = foodTotals(entries);
  const weightKg = measurements[0]?.weightKg ?? null;

  const dayLabel =
    date === today
      ? t("food.today")
      : date === shiftDay(today, -1)
        ? t("food.yesterday")
        : new Date(`${date}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });

  // The last 7 days with food: averages eaten and spent.
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(date, -i));
  const weekDays = week.flatMap((d) => {
    const list = all.filter((e) => e.date === d);
    return list.length ? [{ eaten: foodTotals(list).kcal, spent: spentOf(health.find((h) => h.date === d)) }] : [];
  });
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const weekEaten = avg(weekDays.map((d) => d.eaten));
  const weekSpent = avg(weekDays.flatMap((d) => (d.spent === null ? [] : [d.spent])));

  const balance = spent !== null && entries.length > 0 ? totals.kcal - spent : null;
  const macros: { key: MessageKey; g: number; kcalPerG: number; target?: number; targetKey?: MessageKey }[] = [
    { key: "food.protein", g: totals.proteinG, kcalPerG: 4, target: weightKg ? proteinTarget(weightKg) : undefined, targetKey: "food.proteinTarget" },
    { key: "food.carbs", g: totals.carbsG, kcalPerG: 4 },
    { key: "food.fat", g: totals.fatG, kcalPerG: 9 },
    { key: "food.fiber", g: totals.fiberG, kcalPerG: 0, target: fiberTarget(profile.sex), targetKey: "food.fiberTarget" },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <FoodTabs />

      <div className="flex items-center gap-2 rounded-[22px] bg-surface-2 p-1.5">
        <button
          type="button"
          onClick={() => setDate(shiftDay(date, -1))}
          aria-label={t("food.prevDay")}
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:text-ink"
        >
          <FiChevronLeft size={20} aria-hidden />
        </button>
        <span className="flex-1 text-center text-[15px] font-bold first-letter:uppercase">{dayLabel}</span>
        <button
          type="button"
          onClick={() => setDate(shiftDay(date, 1))}
          disabled={date >= today}
          aria-label={t("food.nextDay")}
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:text-ink disabled:opacity-30"
        >
          <FiChevronRight size={20} aria-hidden />
        </button>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col">
            <span className="text-[13px] font-bold text-ink-2">{t("food.eaten")}</span>
            <span className="text-[28px] leading-8 font-extrabold">{f.number(totals.kcal, 0)}</span>
            <span className="text-xs font-semibold text-muted">kcal</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-bold text-ink-2">{date === today ? t("food.spentSoFar") : t("food.spent")}</span>
            <span className="text-[28px] leading-8 font-extrabold">{spent === null ? "-" : f.number(spent, 0)}</span>
            <span className="text-xs font-semibold text-muted">{spent === null ? t("food.noSpent") : "kcal"}</span>
          </div>
        </div>
        {balance !== null && (
          <div className={`rounded-2xl px-4 py-3 ${balance < 0 ? "bg-good-soft text-good-text" : balance > 0 ? "bg-warn-soft text-warn-text" : "bg-surface-2"}`}>
            <p className="text-[15px] font-extrabold">
              {balance < 0 ? tf("food.deficit", { kcal: f.number(-balance, 0) }) : balance > 0 ? tf("food.surplus", { kcal: f.number(balance, 0) }) : t("food.even")}
            </p>
            <p className="text-[13px] font-semibold">{date === today ? t("food.todayPartial") : t(balance < 0 ? "food.deficitHint" : "food.surplusHint")}</p>
          </div>
        )}
        {entries.length > 0 && (
          <div className="flex flex-col gap-3">
            {macros.map((m) => {
              const share = m.kcalPerG && totals.kcal > 0 ? Math.round(((m.g * m.kcalPerG) / totals.kcal) * 100) : null;
              return (
                <div key={m.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-bold text-ink-2">{t(m.key)}</span>
                    <span className="font-extrabold">
                      {m.target && m.targetKey ? tf(m.targetKey, { g: f.number(m.g, 0), target: f.number(m.target, 0) }) : `${f.number(m.g, 0)} g`}
                      {share !== null && <span className="ml-1.5 text-xs font-semibold text-muted">{share} %</span>}
                    </span>
                  </div>
                  {m.target ? <Progress fraction={Math.min(m.g / m.target, 1)} /> : null}
                </div>
              );
            })}
            {weightKg && <p className="text-xs font-semibold text-muted">{t("food.proteinHint")}</p>}
          </div>
        )}
      </Card>

      {date === today && <TodayPlan />}

      <Button className="flex items-center justify-center gap-2" onClick={() => setEditing("new")}>
        <FiPlus size={18} strokeWidth={2.6} aria-hidden /> {t("food.add")}
      </Button>

      {entries.length === 0 ? (
        <>
          <Card className="text-center text-[15px] font-semibold text-ink-2">{t("food.empty")}</Card>
          <Callout icon={FiInfo} tone="brand">
            {t("food.claudeTip")}
          </Callout>
        </>
      ) : (
        MEALS.map((meal) => {
          const list = entries.filter((e) => e.meal === meal);
          if (list.length === 0) return null;
          return (
            <div key={meal} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-lg font-extrabold">{t(`food.meal.${meal}`)}</h2>
                <span className="text-sm font-bold text-muted">{tf("food.mealTotal", { kcal: f.number(foodTotals(list).kcal, 0) })}</span>
              </div>
              <Card padded={false}>
                {list.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEditing(e)}
                    className="flex min-h-14 w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left first:border-t-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[15px] font-bold">{e.name}</span>
                      <span className="text-xs font-semibold text-muted">
                        {[e.amount, e.time, e.proteinG != null ? `${t("food.protein")} ${f.number(e.proteinG, 0)} g` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {e.source === "claude" && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-ink-2" title={t("food.byClaudeLabel")}>
                        {t("food.byClaude")}
                      </span>
                    )}
                    <span className="text-[15px] font-extrabold">{f.number(e.kcal, 0)}</span>
                  </button>
                ))}
              </Card>
            </div>
          );
        })
      )}

      {weekEaten !== null && (
        <Card className="flex flex-col gap-1">
          <span className="text-[13px] font-bold text-ink-2">{t("food.week")}</span>
          <span className="text-sm font-semibold">
            {weekSpent !== null
              ? tf("food.weekAvg", { eaten: f.number(weekEaten, 0), spent: f.number(weekSpent, 0) })
              : tf("food.weekAvgNoSpent", { eaten: f.number(weekEaten, 0) })}
          </span>
        </Card>
      )}
      <p className="px-1 text-xs font-semibold text-muted">{t("food.estimate")}</p>

      {editing && <FoodForm date={date} entry={editing === "new" ? null : editing} recent={all} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Adding or editing one food; recent foods fill the form with one tap. */
function FoodForm({ date, entry, recent, onClose }: { date: string; entry: FoodEntryDto | null; recent: FoodEntryDto[]; onClose: () => void }) {
  const { t, tf, te } = useI18n();
  const queryClient = useQueryClient();
  const now = new Date();
  const text = (n: number | null | undefined) => (n == null ? "" : String(n));
  const [name, setName] = useState(entry?.name ?? "");
  const [amount, setAmount] = useState(entry?.amount ?? "");
  const [meal, setMeal] = useState<Meal>(entry?.meal ?? mealAt(now.getHours()));
  const [time, setTime] = useState(entry?.time ?? (date === localIso(Date.now()) ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` : ""));
  const [kcal, setKcal] = useState(text(entry?.kcal));
  const [protein, setProtein] = useState(text(entry?.proteinG));
  const [carbs, setCarbs] = useState(text(entry?.carbsG));
  const [fat, setFat] = useState(text(entry?.fatG));
  const [fiber, setFiber] = useState(text(entry?.fiberG));
  const [note, setNote] = useState(entry?.note ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const num = (s: string) => {
    const n = Number(s.trim().replace(",", "."));
    return s.trim() && Number.isFinite(n) ? n : null;
  };
  const fromMacros = kcalFromMacros(num(protein), num(carbs), num(fat));

  // The latest copy of each food, newest first, to log it again.
  const recentFoods = useMemo(() => {
    const seen = new Set<string>();
    return [...recent].reverse().filter((e) => {
      const k = e.name.toLowerCase();
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }, [recent]).slice(0, 8);
  const fill = (e: FoodEntryDto) => {
    setName(e.name);
    setAmount(e.amount ?? "");
    setKcal(text(e.kcal));
    setProtein(text(e.proteinG));
    setCarbs(text(e.carbsG));
    setFat(text(e.fatG));
    setFiber(text(e.fiberG));
  };

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["food"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: async (input: FoodEntryInput): Promise<void> => {
      if (entry) await api.updateFood(entry.id, input);
      else await api.addFood([input]);
    },
    onSuccess: done,
    onError: (e) => setProblem(te(e)),
  });
  const remove = useMutation({ mutationFn: () => api.deleteFood(entry!.id), onSuccess: done, onError: (e) => setProblem(te(e)) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const calories = num(kcal) ?? fromMacros;
    if (calories === null) return setProblem(t("food.kcalNeeded"));
    save.mutate({
      date: entry?.date ?? date,
      time: time || null,
      meal,
      name: name.trim(),
      amount: amount.trim() || null,
      kcal: calories,
      proteinG: num(protein),
      carbsG: num(carbs),
      fatG: num(fat),
      fiberG: num(fiber),
      note: note.trim() || null,
    });
  };

  return (
    <Modal title={t(entry ? "food.editTitle" : "food.addTitle")} onClose={onClose}>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
        {!entry && recentFoods.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-bold text-ink-2">{t("food.recent")}</span>
            <div className="flex flex-wrap gap-2">
              {recentFoods.map((e) => (
                <button key={e.id} type="button" onClick={() => fill(e)} className="min-h-9 rounded-full bg-surface-2 px-3 text-sm font-bold text-ink">
                  {e.name}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted">{t("food.recentHint")}</span>
          </div>
        )}
        <Field label={t("food.name")} placeholder={t("food.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        <Field label={t("food.amount")} placeholder={t("food.amountPlaceholder")} value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={60} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">{t("food.meal")}</span>
          <Segmented label={t("food.meal")} value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m, label: t(`food.meal.${m}`) }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("food.kcal")}
            inputMode="decimal"
            value={kcal}
            onChange={(e) => setKcal(e.target.value)}
            placeholder={fromMacros !== null ? String(fromMacros) : ""}
          />
          <Field label={t("food.time")} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {fromMacros !== null && !kcal.trim() && <p className="-mt-2 text-xs font-semibold text-muted">{tf("food.kcalFromMacros", { kcal: fromMacros })}</p>}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold text-ink-2">{t("food.macros")}</span>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("food.protein")} inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
            <Field label={t("food.carbs")} inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
            <Field label={t("food.fat")} inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
            <Field label={t("food.fiber")} inputMode="decimal" value={fiber} onChange={(e) => setFiber(e.target.value)} />
          </div>
        </div>
        <Field label={t("food.note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />
        {problem && <p className="text-sm font-semibold text-bad-text">{problem}</p>}
        <Button type="submit" disabled={save.isPending}>
          {t("food.save")}
        </Button>
        {entry && (
          <Button
            type="button"
            variant="dangerText"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(t("food.deleteConfirm"))) remove.mutate();
            }}
          >
            {t("food.delete")}
          </Button>
        )}
      </form>
    </Modal>
  );
}
