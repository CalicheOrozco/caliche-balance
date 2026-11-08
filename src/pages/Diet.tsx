import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { FiCheck, FiChevronDown, FiChevronRight, FiClock, FiCopy, FiEdit2, FiHeart, FiInfo, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  type DietDto,
  type DietPrefs,
  mondayOf,
  PLAN_AUTHORS,
  type PlanAuthor,
  type PlanDto,
  type RecipeDto,
  type RecipeInput,
  shoppingList,
} from "../../shared/diet.ts";
import { type Meal, mealAt, MEALS } from "../../shared/food.ts";
import { api } from "../api.ts";
import { localIso } from "../foodData.ts";
import { type MessageKey, useI18n } from "../i18n.tsx";
import { BackLink, Button, Callout, Card, Field, Modal, PageHeader, Progress, Segmented, TabPills, useFormat } from "../ui.tsx";

// ---- Data ---------------------------------------------------------------------------------------

/** The Monday of this week on this device. */
export const thisWeek = () => mondayOf(localIso(Date.now()));

export function useDiet(week = thisWeek()) {
  return useQuery({ queryKey: ["diet", week], queryFn: () => api.diet(week) });
}

function useRefreshDiet() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["diet"] });
}

// ---- Shared pieces ------------------------------------------------------------------------------

/** Amounts as people write them: "3", "1.5", "0.25", never "3.0". */
function useAmount() {
  const { locale } = useI18n();
  return (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });
}

/** "Comida" with its three sections: the food log, the diet and the grocery list. */
export function FoodTabs() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("nav.food")} />
      <TabPills
        label={t("diet.tabs")}
        tabs={[
          { to: "/comida", label: t("diet.tabLog") },
          { to: "/comida/dieta", label: t("diet.tabDiet") },
          { to: "/comida/super", label: t("diet.tabShop") },
        ]}
      />
    </>
  );
}

/** The recipe's picture, or its emoji when there is none or it does not load. */
export function RecipeThumb({ recipe, size = 56, className = "" }: { recipe: Pick<RecipeDto, "imageUrl" | "emoji" | "title">; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [recipe.imageUrl]);
  const box = { width: size, height: size };
  if (recipe.imageUrl && !broken) {
    return <img src={recipe.imageUrl} alt="" style={box} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`shrink-0 rounded-2xl object-cover ${className}`} />;
  }
  return (
    <span style={{ ...box, fontSize: size * 0.5 }} className={`flex shrink-0 items-center justify-center rounded-2xl bg-brand-soft ${className}`} aria-hidden>
      {recipe.emoji || "🍽️"}
    </span>
  );
}

const SERVING_STEPS = [0.5, 1, 1.5, 2, 3];

/** "Lo comí": logs a recipe in today's food with the servings and meal picked. */
export function AteModal({ recipe, meal, onClose }: { recipe: RecipeDto; meal?: Meal; onClose: () => void }) {
  const { t, tf, te } = useI18n();
  const f = useFormat();
  const amount = useAmount();
  const queryClient = useQueryClient();
  const [servings, setServings] = useState(1);
  const [kind, setKind] = useState<Meal>(meal ?? mealAt(new Date().getHours()));
  const [problem, setProblem] = useState<string | null>(null);
  const scale = (n: number | null) => (n == null ? null : Math.round(n * servings * 10) / 10);
  const save = useMutation({
    mutationFn: () => {
      const now = new Date();
      return api.addFood([
        {
          date: localIso(now.getTime()),
          time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
          meal: kind,
          name: recipe.title,
          amount: `${amount(servings)} ${t("diet.portion")}`,
          kcal: Math.round(recipe.kcal * servings),
          proteinG: scale(recipe.proteinG),
          carbsG: scale(recipe.carbsG),
          fatG: scale(recipe.fatG),
          fiberG: scale(recipe.fiberG),
        },
      ]);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["food"] });
      onClose();
    },
    onError: (e) => setProblem(te(e)),
  });
  return (
    <Modal title={tf("diet.ateTitle", { title: recipe.title })} onClose={onClose}>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">{t("diet.ateServings")}</span>
          <Segmented
            label={t("diet.ateServings")}
            value={String(servings)}
            onChange={(v) => setServings(Number(v))}
            options={SERVING_STEPS.map((s) => ({ value: String(s), label: amount(s) }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">{t("diet.ateMeal")}</span>
          <Segmented label={t("diet.ateMeal")} value={kind} onChange={setKind} options={MEALS.map((m) => ({ value: m, label: t(`food.meal.${m}`) }))} />
        </div>
        <p className="text-[15px] font-extrabold">{f.number(recipe.kcal * servings, 0)} kcal</p>
        {problem && <p className="text-sm font-semibold text-bad-text">{problem}</p>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {t("diet.ateSave")}
        </Button>
      </div>
    </Modal>
  );
}

/** Today's meals from the week's choice, each one logged with a tap (shown on the food log). */
export function TodayPlan() {
  const { t } = useI18n();
  const f = useFormat();
  const diet = useDiet().data;
  const [eating, setEating] = useState<{ recipe: RecipeDto; meal: Meal } | null>(null);
  const plan = diet?.plans.find((p) => p.active);
  if (!diet || !plan) return null;
  const byId = new Map(diet.recipes.map((r) => [r.id, r]));
  const rows = plan.slots.flatMap((s) => {
    const recipe = diet.week.choices[s.id] ? byId.get(diet.week.choices[s.id]!) : undefined;
    return recipe ? [{ slot: s, recipe }] : [];
  });
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-lg font-extrabold">{t("diet.todayPlan")}</h2>
      {rows.length === 0 ? (
        <Link to="/comida/dieta" className="rounded-3xl border border-line bg-surface p-4 text-sm font-semibold text-ink-2 shadow-card">
          {t("diet.todayPlanEmpty")}
        </Link>
      ) : (
        <Card padded={false}>
          {rows.map(({ slot, recipe }) => (
            <div key={slot.id} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
              <Link to={`/comida/receta/${recipe.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <RecipeThumb recipe={recipe} size={44} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs font-bold text-muted">{[slot.name, slot.time].filter(Boolean).join(" · ")}</span>
                  <span className="truncate text-[15px] font-bold">{recipe.title}</span>
                  <span className="text-xs font-semibold text-muted">{f.number(recipe.kcal, 0)} kcal</span>
                </span>
              </Link>
              <button type="button" onClick={() => setEating({ recipe, meal: slot.meal })} className="min-h-10 shrink-0 rounded-full bg-brand-soft px-3.5 text-sm font-extrabold text-brand-text">
                {t("diet.ate")}
              </button>
            </div>
          ))}
        </Card>
      )}
      {eating && <AteModal recipe={eating.recipe} meal={eating.meal} onClose={() => setEating(null)} />}
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 3, placeholder }: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-bold text-ink-2">{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-line bg-surface px-4 py-3 font-semibold text-ink outline-none placeholder:font-medium placeholder:text-muted focus:border-2 focus:border-brand"
      />
    </label>
  );
}

const PREF_KEYS = ["likes", "dislikes", "allergies", "cookingTime", "budget", "notes"] as const;

// ---- Diet ---------------------------------------------------------------------------------------

export function DietPage() {
  const { t, tf, locale } = useI18n();
  const f = useFormat();
  const refresh = useRefreshDiet();
  const query = useDiet();
  const [editingPrefs, setEditingPrefs] = useState(false);
  const diet = query.data;
  const choose = useMutation({
    mutationFn: ({ planId, choices }: { planId: string; choices: Record<string, string> }) => api.chooseWeek(diet!.week.week, planId, choices),
    onSuccess: refresh,
  });
  const planAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "archive" | "delete" }) =>
      action === "activate" ? api.activatePlan(id) : action === "archive" ? api.archivePlan(id) : api.deletePlan(id),
    onSuccess: refresh,
  });

  if (!diet) {
    return (
      <div className="flex flex-col gap-3.5">
        <FoodTabs />
        <p className="py-10 text-center text-muted">…</p>
      </div>
    );
  }
  const byId = new Map(diet.recipes.map((r) => [r.id, r]));
  const plan = diet.plans.find((p) => p.active);
  const archived = diet.plans.filter((p) => !p.active);
  const favorites = diet.recipes.filter((r) => r.favorite);
  const chosenKcal = plan ? plan.slots.reduce((sum, s) => sum + (byId.get(diet.week.choices[s.id] ?? "")?.kcal ?? 0), 0) : 0;
  const prefsSet = PREF_KEYS.filter((k) => diet.prefs[k]?.trim());
  const weekLabel = new Date(`${diet.week.week}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-3.5">
      <FoodTabs />

      <button type="button" onClick={() => setEditingPrefs(true)} className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4 text-left shadow-card">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-extrabold">{t("diet.prefs")}</span>
          <span className="line-clamp-2 text-xs font-semibold text-muted">
            {prefsSet.length ? prefsSet.map((k) => diet.prefs[k]).join(" · ") : t("diet.prefsEmpty")}
          </span>
        </span>
        <FiEdit2 size={16} className="shrink-0 text-muted" aria-label={t("diet.prefsEdit")} />
      </button>

      {plan ? (
        <>
          <Card className="flex flex-col gap-1">
            <span className="text-xs font-bold text-brand-text">{t("diet.activePlan")}</span>
            <span className="text-xl leading-6 font-extrabold">{plan.name}</span>
            <span className="text-xs font-semibold text-muted">
              {[t(`diet.author.${plan.author}`), plan.source, plan.month && new Date(`${plan.month}-15T12:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" })]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="mt-2 text-sm font-bold">
              {plan.kcalTarget ? tf("diet.kcalOfTarget", { kcal: f.number(chosenKcal, 0), target: f.number(plan.kcalTarget, 0) }) : tf("diet.kcalDay", { kcal: f.number(chosenKcal, 0) })}
            </span>
            {plan.kcalTarget ? <Progress fraction={Math.min(chosenKcal / plan.kcalTarget, 1)} /> : null}
            <div className="mt-2 flex gap-2">
              <Link to={`/comida/plan/${plan.id}/editar`} className="flex min-h-10 items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-sm font-bold">
                <FiEdit2 size={14} aria-hidden /> {t("diet.editPlan")}
              </Link>
              <button
                type="button"
                onClick={() => planAction.mutate({ id: plan.id, action: "archive" })}
                className="min-h-10 rounded-full bg-surface-2 px-3.5 text-sm font-bold text-ink-2"
              >
                {t("diet.archive")}
              </button>
            </div>
          </Card>

          <div className="flex flex-col gap-0.5 px-1">
            <h2 className="text-lg font-extrabold">{tf("diet.weekOf", { date: weekLabel })}</h2>
            <p className="text-xs font-semibold text-muted">{diet.week.carried ? t("diet.carried") : t("diet.chooseHint")}</p>
          </div>
          {plan.slots.map((slot) => (
            <div key={slot.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1">
                <span className="text-[15px] font-extrabold">{slot.name}</span>
                {slot.time && <span className="text-xs font-bold text-muted">{slot.time}</span>}
              </div>
              {slot.options.length === 0 && <p className="px-1 text-sm text-muted">{t("diet.noOptions")}</p>}
              {slot.options.map((id) => {
                const recipe = byId.get(id);
                if (!recipe) return null;
                const picked = diet.week.choices[slot.id] === id;
                return (
                  <div key={id} className={`flex items-center gap-3 rounded-3xl border bg-surface p-3 shadow-card ${picked ? "border-2 border-brand" : "border-line"}`}>
                    <Link to={`/comida/receta/${id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <RecipeThumb recipe={recipe} />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[15px] leading-5 font-bold">{recipe.title}</span>
                        <span className="text-xs font-semibold text-muted">
                          {[`${f.number(recipe.kcal, 0)} kcal`, recipe.proteinG != null ? `${t("food.protein")} ${f.number(recipe.proteinG, 0)} g` : null, recipe.tags[0]].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => choose.mutate({ planId: plan.id, choices: { ...diet.week.choices, [slot.id]: id } })}
                      className={`flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-extrabold ${picked ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-2"}`}
                    >
                      {picked && <FiCheck size={14} strokeWidth={3} aria-hidden />}
                      {picked ? t("diet.chosen") : t("diet.choose")}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      ) : (
        <Card className="flex flex-col gap-2">
          <h2 className="text-lg font-extrabold">{t("diet.noPlan")}</h2>
          <p className="text-[15px] font-medium text-ink-2">{t("diet.noPlanBody")}</p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link to="/comida/plan/nuevo" className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl bg-brand px-3 text-[15px] font-extrabold text-brand-ink">
          <FiPlus size={17} strokeWidth={2.6} aria-hidden /> {t("diet.newPlan")}
        </Link>
        <Link to="/comida/receta/nueva" className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl bg-surface-2 px-3 text-[15px] font-bold text-ink">
          <FiPlus size={17} strokeWidth={2.6} aria-hidden /> {t("diet.newRecipe")}
        </Link>
      </div>

      {favorites.length > 0 && <RecipeList title={t("diet.favorites")} recipes={favorites} open />}
      {diet.recipes.length > 0 && <RecipeList title={t("diet.allRecipes")} recipes={diet.recipes} />}

      {archived.length > 0 && (
        <details className="group overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
            <span className="text-[15px] font-extrabold">{t("diet.archived")}</span>
            <FiChevronDown className="text-muted transition group-open:rotate-180" aria-hidden />
          </summary>
          {archived.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 border-t border-line px-4 py-3">
              <span className="flex flex-col">
                <span className="text-[15px] font-bold">{p.name}</span>
                <span className="text-xs font-semibold text-muted">{[t(`diet.author.${p.author}`), p.source, p.month].filter(Boolean).join(" · ")}</span>
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={() => planAction.mutate({ id: p.id, action: "activate" })} className="min-h-10 rounded-full bg-brand-soft px-3.5 text-sm font-extrabold text-brand-text">
                  {t("diet.activate")}
                </button>
                <Link to={`/comida/plan/${p.id}/editar`} className="flex min-h-10 items-center rounded-full bg-surface-2 px-3.5 text-sm font-bold">
                  {t("diet.edit")}
                </Link>
                <button
                  type="button"
                  onClick={() => confirm(t("diet.deletePlanConfirm")) && planAction.mutate({ id: p.id, action: "delete" })}
                  className="min-h-10 rounded-full px-3 text-sm font-bold text-bad-text"
                >
                  {t("diet.deletePlan")}
                </button>
              </div>
            </div>
          ))}
        </details>
      )}

      {editingPrefs && <PrefsModal prefs={diet.prefs} onClose={() => setEditingPrefs(false)} />}
    </div>
  );
}

function RecipeList({ title, recipes, open = false }: { title: string; recipes: RecipeDto[]; open?: boolean }) {
  const { tf } = useI18n();
  const f = useFormat();
  return (
    <details open={open} className="group overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col">
          <span className="text-[15px] font-extrabold">{title}</span>
          <span className="text-xs font-semibold text-muted">{tf("diet.recipesCount", { n: recipes.length })}</span>
        </span>
        <FiChevronDown className="text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      {recipes.map((r) => (
        <Link key={r.id} to={`/comida/receta/${r.id}`} className="flex items-center gap-3 border-t border-line px-4 py-2.5">
          <RecipeThumb recipe={r} size={40} />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.title}</span>
          <span className="text-sm font-extrabold">{f.number(r.kcal, 0)}</span>
          <FiChevronRight size={16} className="text-muted" aria-hidden />
        </Link>
      ))}
    </details>
  );
}

function PrefsModal({ prefs, onClose }: { prefs: DietPrefs; onClose: () => void }) {
  const { t, te } = useI18n();
  const refresh = useRefreshDiet();
  const [values, setValues] = useState<DietPrefs>(prefs);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.saveDietPrefs(Object.fromEntries(PREF_KEYS.map((k) => [k, (values[k] ?? "").trim()]).filter(([, v]) => v))),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (e) => setProblem(te(e)),
  });
  return (
    <Modal title={t("diet.prefs")} onClose={onClose}>
      <div className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted">{t("diet.prefsHint")}</p>
        {PREF_KEYS.map((k) => (
          <TextArea key={k} label={t(`diet.prefs.${k}`)} rows={k === "budget" || k === "cookingTime" ? 1 : 2} value={values[k] ?? ""} onChange={(v) => setValues({ ...values, [k]: v })} />
        ))}
        {problem && <p className="text-sm font-semibold text-bad-text">{problem}</p>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {t("food.save")}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Recipe -------------------------------------------------------------------------------------

export function RecipePage() {
  const { id } = useParams();
  const { t, tf } = useI18n();
  const f = useFormat();
  const amount = useAmount();
  const navigate = useNavigate();
  const refresh = useRefreshDiet();
  const query = useDiet();
  const [eating, setEating] = useState(false);
  const recipe = query.data?.recipes.find((r) => r.id === id);
  const favorite = useMutation({ mutationFn: (on: boolean) => api.setFavorite(id!, on), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => api.deleteRecipe(id!),
    onSuccess: async () => {
      await refresh();
      navigate("/comida/dieta", { replace: true });
    },
  });
  const back = <BackLink to="/comida/dieta" label={t("diet.back")} />;
  if (!recipe) {
    return (
      <div className="flex flex-col gap-3.5">
        {back}
        {!query.isPending && <Card className="text-center font-semibold text-ink-2">{t("diet.notFound")}</Card>}
      </div>
    );
  }
  const macros: [MessageKey, number | null][] = [
    ["food.protein", recipe.proteinG],
    ["food.carbs", recipe.carbsG],
    ["food.fat", recipe.fatG],
    ["food.fiber", recipe.fiberG],
  ];
  return (
    <div className="flex flex-col gap-3.5">
      {back}
      <div className="flex items-center gap-4 px-1">
        <RecipeThumb recipe={recipe} size={96} className="rounded-[28px]" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[24px] leading-7 font-extrabold tracking-[-0.02em]">{recipe.title}</h1>
          <div className="flex flex-wrap gap-1.5">
            {recipe.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-ink-2">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] leading-8 font-extrabold">{f.number(recipe.kcal, 0)}</span>
          <span className="text-sm font-bold text-muted">kcal {t("diet.perServing")}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {macros.map(([key, g]) => (
            <div key={key} className="flex flex-col rounded-2xl bg-surface-2 px-2 py-2 text-center">
              <span className="text-[15px] font-extrabold">{g == null ? "-" : `${f.number(g, 0)} g`}</span>
              <span className="text-[11px] font-bold text-muted">{t(key)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-ink-2">
          <span>{tf("diet.servings", { n: amount(recipe.servings) })}</span>
          {recipe.prepMin != null && (
            <span className="flex items-center gap-1">
              <FiClock size={13} aria-hidden /> {tf("diet.prep", { min: recipe.prepMin })}
            </span>
          )}
          {recipe.cookMin != null && <span>{tf("diet.cook", { min: recipe.cookMin })}</span>}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Button onClick={() => setEating(true)}>{t("diet.ate")}</Button>
        <Button variant="secondary" className="flex items-center justify-center gap-2" onClick={() => favorite.mutate(!recipe.favorite)} aria-pressed={recipe.favorite}>
          <FiHeart size={16} className={recipe.favorite ? "fill-current text-bad" : ""} aria-hidden />
          {recipe.favorite ? t("diet.favorite") : t("diet.markFavorite")}
        </Button>
      </div>

      {recipe.ingredients.length > 0 && (
        <Section title={t("diet.ingredients")}>
          <Card padded={false}>
            {recipe.ingredients.map((ing, i) => (
              <div key={i} className="flex min-h-11 items-center gap-3 border-t border-line px-4 py-2 text-sm first:border-t-0">
                <span className="min-w-0 flex-1 font-semibold">{ing.item}</span>
                <span className="font-extrabold text-ink-2">{ing.qty == null ? t("diet.shop.toTaste") : `${amount(ing.qty)} ${ing.unit ?? ""}`.trim()}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}

      {recipe.steps.length > 0 && (
        <Section title={t("diet.steps")}>
          <Card>
            <ol className="flex flex-col gap-3">
              {recipe.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[15px]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-brand-text">{i + 1}</span>
                  <span className="pt-0.5 font-medium">{step}</span>
                </li>
              ))}
            </ol>
          </Card>
        </Section>
      )}

      {recipe.note && (
        <Callout icon={FiInfo} tone="neutral">
          {recipe.note}
        </Callout>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <Link to={`/comida/receta/${recipe.id}/editar`} className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-bold">
          <FiEdit2 size={14} aria-hidden /> {t("diet.edit")}
        </Link>
        <Link to={`/comida/receta/nueva?de=${recipe.id}`} className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-bold">
          <FiCopy size={14} aria-hidden /> {t("diet.duplicate")}
        </Link>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => confirm(t("diet.deleteRecipeConfirm")) && remove.mutate()}
          className="flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-bold text-bad-text"
        >
          <FiTrash2 size={14} aria-hidden /> {t("diet.deleteRecipe")}
        </button>
      </div>
      {eating && <AteModal recipe={recipe} meal={query.data?.plans.find((p) => p.active)?.slots.find((s) => s.options.includes(recipe.id))?.meal} onClose={() => setEating(false)} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-1 text-lg font-extrabold">{title}</h2>
      {children}
    </div>
  );
}

type IngredientRow = { qty: string; unit: string; item: string };

export function RecipeFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useRefreshDiet();
  const diet = useDiet().data;
  const sourceId = id ?? params.get("de");
  const source = diet?.recipes.find((r) => r.id === sourceId);
  if (sourceId && !diet) return <p className="py-10 text-center text-muted">…</p>;
  const onSaved = async (saved: RecipeDto) => {
    await refresh();
    navigate(`/comida/receta/${saved.id}`, { replace: true });
  };
  return <RecipeForm key={sourceId ?? "new"} id={id} source={source} duplicate={!id && !!source} onSaved={onSaved} />;
}

function RecipeForm({ id, source, duplicate, onSaved }: { id?: string; source?: RecipeDto; duplicate: boolean; onSaved: (saved: RecipeDto) => Promise<void> }) {
  const { t, tf, te } = useI18n();
  const text = (n: number | null | undefined) => (n == null ? "" : String(n));
  const [title, setTitle] = useState(source ? (duplicate ? tf("diet.copyOf", { title: source.title }) : source.title) : "");
  const [emoji, setEmoji] = useState(source?.emoji ?? "");
  const [imageUrl, setImageUrl] = useState(source?.imageUrl ?? "");
  const [servings, setServings] = useState(text(source?.servings ?? 1));
  const [kcal, setKcal] = useState(text(source?.kcal));
  const [protein, setProtein] = useState(text(source?.proteinG));
  const [carbs, setCarbs] = useState(text(source?.carbsG));
  const [fat, setFat] = useState(text(source?.fatG));
  const [fiber, setFiber] = useState(text(source?.fiberG));
  const [prep, setPrep] = useState(text(source?.prepMin));
  const [cook, setCook] = useState(text(source?.cookMin));
  const [tags, setTags] = useState(source?.tags.join(", ") ?? "");
  const [note, setNote] = useState(source?.note ?? "");
  const [ingredients, setIngredients] = useState<IngredientRow[]>(
    source?.ingredients.length ? source.ingredients.map((i) => ({ qty: text(i.qty), unit: i.unit ?? "", item: i.item })) : [{ qty: "", unit: "", item: "" }],
  );
  const [steps, setSteps] = useState<string[]>(source?.steps.length ? source.steps : [""]);
  const [problem, setProblem] = useState<string | null>(null);

  const num = (s: string) => {
    const n = Number(s.trim().replace(",", "."));
    return s.trim() && Number.isFinite(n) ? n : null;
  };
  const save = useMutation({
    mutationFn: (input: RecipeInput) => (id ? api.updateRecipe(id, input) : api.addRecipe(input)),
    onSuccess: onSaved,
    onError: (e) => setProblem(te(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    save.mutate({
      title: title.trim(),
      emoji: emoji.trim() || null,
      imageUrl: imageUrl.trim() || null,
      servings: num(servings) ?? 1,
      kcal: num(kcal) ?? 0,
      proteinG: num(protein),
      carbsG: num(carbs),
      fatG: num(fat),
      fiberG: num(fiber),
      prepMin: num(prep) === null ? null : Math.round(num(prep)!),
      cookMin: num(cook) === null ? null : Math.round(num(cook)!),
      tags: tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      ingredients: ingredients.filter((i) => i.item.trim()).map((i) => ({ qty: num(i.qty), unit: i.unit.trim() || null, item: i.item.trim() })),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      note: note.trim() || null,
      ...(duplicate ? { favorite: false } : {}),
    });
  };
  const setIngredient = (i: number, patch: Partial<IngredientRow>) => setIngredients(ingredients.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const small = "h-12 w-full min-w-0 rounded-2xl border border-line bg-surface px-3 font-semibold text-ink outline-none focus:border-2 focus:border-brand";

  return (
    <div className="flex flex-col gap-3.5">
      <BackLink to={id ? `/comida/receta/${id}` : "/comida/dieta"} label={t("diet.back")} />
      <h1 className="px-1 text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{t(id ? "diet.form.editTitle" : "diet.form.newTitle")}</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-end gap-3">
          <RecipeThumb recipe={{ title, emoji, imageUrl: /^https:\/\//.test(imageUrl.trim()) ? imageUrl.trim() : null }} size={54} />
          <div className="w-20">
            <Field label={t("diet.form.emoji")} value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={16} />
          </div>
          <div className="min-w-0 flex-1">
            <Field label={t("diet.form.title")} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} />
          </div>
        </div>
        <Field label={t("diet.form.imageUrl")} type="url" inputMode="url" placeholder="https://" help={t("diet.form.imageHint")} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("diet.form.servings")} inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} required />
          <Field label={t("diet.form.kcal")} inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} required />
          <Field label={`${t("food.protein")} (g)`} inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
          <Field label={`${t("food.carbs")} (g)`} inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          <Field label={`${t("food.fat")} (g)`} inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
          <Field label={`${t("food.fiber")} (g)`} inputMode="decimal" value={fiber} onChange={(e) => setFiber(e.target.value)} />
          <Field label={t("diet.form.prepMin")} inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} />
          <Field label={t("diet.form.cookMin")} inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value)} />
        </div>
        <Field label={t("diet.form.tags")} value={tags} onChange={(e) => setTags(e.target.value)} />

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold text-ink-2">{t("diet.ingredients")}</span>
          {ingredients.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={t("diet.form.qty")} placeholder={t("diet.form.qty")} inputMode="decimal" value={row.qty} onChange={(e) => setIngredient(i, { qty: e.target.value })} className={`${small} w-16! flex-none`} />
              <input aria-label={t("diet.form.unit")} placeholder="g" value={row.unit} onChange={(e) => setIngredient(i, { unit: e.target.value })} className={`${small} w-16! flex-none`} />
              <input aria-label={t("diet.form.item")} placeholder={t("diet.form.item")} value={row.item} onChange={(e) => setIngredient(i, { item: e.target.value })} className={small} />
              <button type="button" aria-label={t("diet.form.remove")} onClick={() => setIngredients(ingredients.filter((_, j) => j !== i))} className="flex h-10 w-10 shrink-0 items-center justify-center text-muted">
                <FiX aria-hidden />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setIngredients([...ingredients, { qty: "", unit: "", item: "" }])} className="flex min-h-10 items-center gap-1.5 self-start text-sm font-bold text-brand-text">
            <FiPlus aria-hidden /> {t("diet.form.addIngredient")}
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold text-ink-2">{t("diet.steps")}</span>
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-brand-text">{i + 1}</span>
              <textarea
                aria-label={tf("diet.form.step", { n: i + 1 })}
                rows={2}
                value={step}
                onChange={(e) => setSteps(steps.map((s, j) => (j === i ? e.target.value : s)))}
                className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-3 py-2.5 font-medium text-ink outline-none focus:border-2 focus:border-brand"
              />
              <button type="button" aria-label={t("diet.form.remove")} onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="mt-2 flex h-10 w-10 shrink-0 items-center justify-center text-muted">
                <FiX aria-hidden />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setSteps([...steps, ""])} className="flex min-h-10 items-center gap-1.5 self-start text-sm font-bold text-brand-text">
            <FiPlus aria-hidden /> {t("diet.form.addStep")}
          </button>
        </div>

        <TextArea label={t("diet.note")} value={note} onChange={setNote} />
        {problem && <p className="text-sm font-semibold text-bad-text">{problem}</p>}
        <Button type="submit" disabled={save.isPending}>
          {t("diet.form.save")}
        </Button>
      </form>
    </div>
  );
}

// ---- Plan ---------------------------------------------------------------------------------------

type SlotRow = { id?: string; name: string; time: string; options: string[] };

export function PlanFormPage() {
  const { id } = useParams();
  const diet = useDiet().data;
  if (!diet) return <p className="py-10 text-center text-muted">…</p>;
  const plan = id ? diet.plans.find((p) => p.id === id) : undefined;
  return <PlanForm key={id ?? "new"} diet={diet} plan={plan} />;
}

function PlanForm({ diet, plan }: { diet: DietDto; plan?: PlanDto }) {
  const { t, te } = useI18n();
  const navigate = useNavigate();
  const refresh = useRefreshDiet();
  const [name, setName] = useState(plan?.name ?? "");
  const [month, setMonth] = useState(plan?.month ?? localIso(Date.now()).slice(0, 7));
  const [author, setAuthor] = useState<PlanAuthor>(plan?.author ?? "me");
  const [source, setSource] = useState(plan?.source ?? "");
  const [kcalTarget, setKcalTarget] = useState(plan?.kcalTarget ? String(plan.kcalTarget) : "");
  const [activate, setActivate] = useState(!plan);
  const [slots, setSlots] = useState<SlotRow[]>(
    plan ? plan.slots.map((s) => ({ id: s.id, name: s.name, time: s.time ?? "", options: s.options })) : t("diet.plan.defaultSlots").split(",").map((n) => ({ name: n, time: "", options: [] })),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const byId = useMemo(() => new Map(diet.recipes.map((r) => [r.id, r])), [diet.recipes]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        month: month || null,
        author,
        source: source.trim() || null,
        kcalTarget: kcalTarget.trim() ? Number(kcalTarget) : null,
        slots: slots.filter((s) => s.name.trim()).map((s) => ({ id: s.id, name: s.name.trim(), time: s.time || null, options: s.options })),
      };
      return plan ? api.updatePlan(plan.id, input) : api.addPlan({ ...input, activate });
    },
    onSuccess: async () => {
      await refresh();
      navigate("/comida/dieta", { replace: true });
    },
    onError: (e) => setProblem(te(e)),
  });
  const setSlot = (i: number, patch: Partial<SlotRow>) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const select = "h-12 w-full min-w-0 rounded-2xl border border-line bg-surface px-3 font-semibold text-ink outline-none focus:border-2 focus:border-brand";

  return (
    <div className="flex flex-col gap-3.5">
      <BackLink to="/comida/dieta" label={t("diet.back")} />
      <h1 className="px-1 text-[28px] leading-8.5 font-extrabold tracking-[-0.02em]">{t(plan ? "diet.plan.editTitle" : "diet.plan.newTitle")}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setProblem(null);
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <Field label={t("diet.plan.name")} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("diet.plan.month")} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <Field label={t("diet.plan.kcalTarget")} inputMode="numeric" value={kcalTarget} onChange={(e) => setKcalTarget(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">{t("diet.plan.author")}</span>
          <Segmented label={t("diet.plan.author")} value={author} onChange={setAuthor} options={PLAN_AUTHORS.map((a) => ({ value: a, label: t(`diet.author.${a}`) }))} />
        </div>
        <Field label={t("diet.plan.source")} value={source} onChange={(e) => setSource(e.target.value)} maxLength={80} />

        <span className="text-[13px] font-bold text-ink-2">{t("diet.plan.slots")}</span>
        {diet.recipes.length === 0 && (
          <Callout icon={FiInfo} tone="brand">
            {t("diet.plan.needRecipes")}
          </Callout>
        )}
        {slots.map((slot, i) => (
          <Card key={i} className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Field label={t("diet.plan.slotName")} value={slot.name} onChange={(e) => setSlot(i, { name: e.target.value })} maxLength={40} />
              </div>
              <button type="button" aria-label={t("diet.form.remove")} onClick={() => setSlots(slots.filter((_, j) => j !== i))} className="flex h-13 w-10 shrink-0 items-center justify-center text-muted">
                <FiTrash2 aria-hidden />
              </button>
            </div>
            <div className="w-44">
              <Field label={t("diet.plan.slotTime")} type="time" value={slot.time} onChange={(e) => setSlot(i, { time: e.target.value })} />
            </div>
            {slot.options.map((rid) => (
              <div key={rid} className="flex items-center gap-2 rounded-2xl bg-surface-2 py-1.5 pr-1 pl-2">
                {byId.get(rid) && <RecipeThumb recipe={byId.get(rid)!} size={32} className="rounded-xl" />}
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{byId.get(rid)?.title ?? "?"}</span>
                <button type="button" aria-label={t("diet.form.remove")} onClick={() => setSlot(i, { options: slot.options.filter((x) => x !== rid) })} className="flex h-9 w-9 items-center justify-center text-muted">
                  <FiX aria-hidden />
                </button>
              </div>
            ))}
            {diet.recipes.some((r) => !slot.options.includes(r.id)) && slot.options.length < 8 && (
              <select
                aria-label={t("diet.plan.addOption")}
                value=""
                onChange={(e) => e.target.value && setSlot(i, { options: [...slot.options, e.target.value] })}
                className={select}
              >
                <option value="">{t("diet.plan.addOption")}…</option>
                {diet.recipes
                  .filter((r) => !slot.options.includes(r.id))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.favorite ? "★ " : ""}
                      {r.title} · {r.kcal} kcal
                    </option>
                  ))}
              </select>
            )}
          </Card>
        ))}
        <button type="button" onClick={() => setSlots([...slots, { name: "", time: "", options: [] }])} className="flex min-h-10 items-center gap-1.5 self-start text-sm font-bold text-brand-text">
          <FiPlus aria-hidden /> {t("diet.plan.addSlot")}
        </button>
        {!plan && (
          <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} className="h-5 w-5 accent-(--color-brand)" />
            {t("diet.plan.activate")}
          </label>
        )}
        {problem && <p className="text-sm font-semibold text-bad-text">{problem}</p>}
        <Button type="submit" disabled={save.isPending}>
          {t("diet.plan.save")}
        </Button>
      </form>
    </div>
  );
}

// ---- Groceries ----------------------------------------------------------------------------------

export function ShoppingPage() {
  const { t, tf } = useI18n();
  const amount = useAmount();
  const query = useDiet();
  const queryClient = useQueryClient();
  const diet = query.data;
  const [state, setState] = useState<DietDto["week"]["shopping"] | null>(null);
  useEffect(() => {
    if (diet && !state) setState(diet.week.shopping);
  }, [diet, state]);
  const save = useMutation({
    mutationFn: (next: DietDto["week"]["shopping"]) => api.saveShopping(diet!.week.week, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diet"] }),
  });
  const update = (next: DietDto["week"]["shopping"]) => {
    setState(next);
    save.mutate(next);
  };

  if (!diet || !state) {
    return (
      <div className="flex flex-col gap-3.5">
        <FoodTabs />
        <p className="py-10 text-center text-muted">…</p>
      </div>
    );
  }
  const byId = new Map(diet.recipes.map((r) => [r.id, r]));
  const chosen = Object.values(diet.week.choices).flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
  const items = shoppingList(chosen, state.days, state.servings);
  const checked = new Set(state.checked);
  const left = items.filter((i) => !checked.has(i.key)).length;
  const stepper = (label: string, value: number, steps: number[], set: (v: number) => void) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-bold text-ink-2">{label}</span>
      <Segmented label={label} value={String(value)} onChange={(v) => set(Number(v))} options={steps.map((s) => ({ value: String(s), label: amount(s) }))} />
    </div>
  );

  return (
    <div className="flex flex-col gap-3.5">
      <FoodTabs />
      {chosen.length === 0 ? (
        <Card className="text-center text-[15px] font-semibold text-ink-2">{t("diet.shop.empty")}</Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <div className="flex flex-col">
              <span className="text-lg font-extrabold">{t("diet.shop.title")}</span>
              <span className="text-xs font-semibold text-muted">{t("diet.shop.for")}: {chosen.map((r) => r.title).join(", ")}</span>
            </div>
            {stepper(t("diet.shop.days"), state.days, [3, 5, 7, 14], (days) => update({ ...state, days }))}
            {stepper(t("diet.shop.servings"), state.servings, [1, 2, 3, 4], (servings) => update({ ...state, servings }))}
            <span className="text-sm font-bold">{left === 0 ? t("diet.shop.done") : tf("diet.shop.left", { n: left, total: items.length })}</span>
            <Progress fraction={items.length ? (items.length - left) / items.length : 0} />
          </Card>
          <Card padded={false}>
            {items.map((item) => {
              const on = checked.has(item.key);
              return (
                <label key={item.key} className="flex min-h-13 cursor-pointer items-center gap-3 border-t border-line px-4 py-2 first:border-t-0">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => update({ ...state, checked: on ? state.checked.filter((k) => k !== item.key) : [...state.checked, item.key] })}
                    className="h-5 w-5 shrink-0 accent-(--color-brand)"
                  />
                  <span className={`flex min-w-0 flex-1 flex-col ${on ? "text-muted line-through" : ""}`}>
                    <span className="text-[15px] font-bold">{item.item}</span>
                    <span className="truncate text-xs font-semibold text-muted">{item.recipes.join(", ")}</span>
                  </span>
                  <span className={`text-sm font-extrabold ${on ? "text-muted" : ""}`}>{item.qty == null ? t("diet.shop.toTaste") : `${amount(item.qty)} ${item.unit ?? ""}`.trim()}</span>
                </label>
              );
            })}
          </Card>
          {state.checked.length > 0 && (
            <Button variant="subtle" className="self-center" onClick={() => update({ ...state, checked: [] })}>
              {t("diet.shop.uncheck")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
