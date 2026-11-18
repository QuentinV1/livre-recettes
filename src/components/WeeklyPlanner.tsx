import React, { useMemo, useState } from 'react';
import {
  Star,
  Calendar,
  Sun,
  Moon,
  Plus,
  X,
  Trash2,
  ShoppingCart,
  Clock,
  Search,
  Minus,
  Users,
} from 'lucide-react';
import {
  DAYS_OF_WEEK,
  DayOfWeek,
  MealSlot,
  Recipe,
  WeeklyPlan,
} from '../types/recipe';
import { scaleQuantity } from './CookingModeModal';

interface WeeklyPlannerProps {
  recipes: Recipe[];
  weeklyPlan: WeeklyPlan;
  onAssignSlot: (day: DayOfWeek, slot: MealSlot, recipeId: string | null, servings?: number) => void;
  onClearWeek: () => void;
  onToggleWeekly: (recipeId: string) => void;
  onOpenRecipe: (recipe: Recipe, plannedServings?: number) => void;
}

export const WeeklyPlanner: React.FC<WeeklyPlannerProps> = ({
  recipes,
  weeklyPlan,
  onAssignSlot,
  onClearWeek,
  onToggleWeekly,
  onOpenRecipe,
}) => {
  const [pickingSlot, setPickingSlot] = useState<{ day: DayOfWeek; slot: MealSlot } | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerServings, setPickerServings] = useState(2);
  const [includeAlreadyPlanned, setIncludeAlreadyPlanned] = useState(false);
  const [showShoppingList, setShowShoppingList] = useState(false);

  const recipeMap = useMemo(() => {
    const map = new Map<string, Recipe>();
    for (const r of recipes) map.set(r.id, r);
    return map;
  }, [recipes]);

  const weeklyRecipes = useMemo(() => recipes.filter((r) => r.isWeekly), [recipes]);

  const plannedCount = useMemo(() => {
    let count = 0;
    for (const d of DAYS_OF_WEEK) {
      if (weeklyPlan[d.key]?.midi) count++;
      if (weeklyPlan[d.key]?.soir) count++;
    }
    return count;
  }, [weeklyPlan]);

  const plannedRecipeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of DAYS_OF_WEEK) {
      const m = weeklyPlan[d.key]?.midi;
      const s = weeklyPlan[d.key]?.soir;
      if (m) ids.add(m);
      if (s) ids.add(s);
    }
    return ids;
  }, [weeklyPlan]);

  // Liste de courses agrégée depuis les repas planifiés (avec recalcul selon le nombre de personnes)
  const shoppingIngredients = useMemo(() => {
    const plannedMeals: { recipe: Recipe; servings: number }[] = [];
    for (const d of DAYS_OF_WEEK) {
      const dayData = weeklyPlan[d.key];
      if (dayData?.midi) {
        const rec = recipeMap.get(dayData.midi);
        if (rec) plannedMeals.push({ recipe: rec, servings: dayData.midiServings ?? rec.servings });
      }
      if (dayData?.soir) {
        const rec = recipeMap.get(dayData.soir);
        if (rec) plannedMeals.push({ recipe: rec, servings: dayData.soirServings ?? rec.servings });
      }
    }

    const sourceMeals =
      plannedMeals.length > 0
        ? plannedMeals
        : weeklyRecipes.map((rec) => ({ recipe: rec, servings: rec.servings }));

    const grouped = new Map<
      string,
      {
        name: string;
        unitTotals: Map<string, { unit: string; total: number }>;
        otherLabels: string[];
        count: number;
      }
    >();

    for (const { recipe: rec, servings } of sourceMeals) {
      const multiplier = rec.servings > 0 ? servings / rec.servings : 1;
      for (const ing of rec.ingredients) {
        const key = ing.name.trim().toLowerCase();
        if (!grouped.has(key)) {
          grouped.set(key, {
            name: ing.name,
            unitTotals: new Map(),
            otherLabels: [],
            count: 0,
          });
        }
        const entry = grouped.get(key)!;
        entry.count += 1;

        const scaledQty = scaleQuantity(ing.quantity, multiplier);
        const numericVal = scaledQty ? parseFloat(scaledQty.replace(',', '.')) : Number.NaN;
        if (scaledQty && !Number.isNaN(numericVal)) {
          const unitKey = ing.unit.trim().toLowerCase();
          const prev = entry.unitTotals.get(unitKey);
          if (prev) {
            prev.total = Math.round((prev.total + numericVal) * 100) / 100;
          } else {
            entry.unitTotals.set(unitKey, { unit: ing.unit.trim(), total: numericVal });
          }
        } else {
          const qtyLabel = [scaledQty, ing.unit].filter(Boolean).join(' ');
          if (qtyLabel) entry.otherLabels.push(qtyLabel);
        }
      }
    }

    return Array.from(grouped.values())
      .map((entry) => {
        const parts: string[] = [];
        for (const { unit, total } of entry.unitTotals.values()) {
          const formatted = Number.isInteger(total)
            ? String(total)
            : String(total).replace('.', ',');
          parts.push(unit ? `${formatted} ${unit}` : formatted);
        }
        parts.push(...entry.otherLabels);
        return {
          name: entry.name,
          quantities: parts,
          count: entry.count,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }, [weeklyPlan, recipeMap, weeklyRecipes]);

  const filteredPickerRecipes = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const list = recipes.filter((r) => {
      if (!includeAlreadyPlanned && plannedRecipeIds.has(r.id)) {
        return false;
      }
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    });

    // Mettre les recettes de la semaine en premier
    return [...list].sort((a, b) => Number(b.isWeekly) - Number(a.isWeekly));
  }, [recipes, pickerSearch, includeAlreadyPlanned, plannedRecipeIds]);

  return (
    <div className="space-y-6 pb-20 sm:pb-10">
      {/* En-tête Planning */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-5">
        <div>
          <h2 className="font-display text-xl font-extrabold text-stone-900 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-fresh-600" />
            Planning de la semaine
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            {plannedCount} repas planifié{plannedCount > 1 ? 's' : ''} · {weeklyRecipes.length}{' '}
            recette{weeklyRecipes.length > 1 ? 's' : ''} favorite{weeklyRecipes.length > 1 ? 's' : ''} cette semaine
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowShoppingList((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors sm:text-sm ${
              showShoppingList
                ? 'bg-fresh-600 text-white'
                : 'bg-fresh-50 text-fresh-800 border border-fresh-200 hover:bg-fresh-100'
            }`}
          >
            <ShoppingCart className="h-4 w-4" />
            Liste de courses ({shoppingIngredients.length})
          </button>

          {plannedCount > 0 && (
            <button
              type="button"
              onClick={onClearWeek}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Vider la semaine
            </button>
          )}
        </div>
      </div>

      {/* Panneau Liste de courses */}
      {showShoppingList && (
        <section className="rounded-2xl border border-fresh-200 bg-white p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-base font-bold text-stone-900">
              Ingrédients nécessaires ({plannedCount > 0 ? 'd’après le planning' : 'd’après les recettes de la semaine'})
            </h3>
            <button
              type="button"
              onClick={() => setShowShoppingList(false)}
              className="text-stone-400 hover:text-stone-700"
              aria-label="Fermer la liste de courses"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {shoppingIngredients.length === 0 ? (
            <p className="text-sm text-stone-500">
              Planifiez des repas ou marquez des recettes de la semaine pour générer la liste.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {shoppingIngredients.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50/80 px-3 py-2 text-xs"
                >
                  <span className="font-semibold text-stone-800">{item.name}</span>
                  <span className="text-fresh-700 font-medium ml-2 text-right">
                    {item.quantities.length > 0 ? item.quantities.join(' + ') : `×${item.count}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Bandeau Recettes de la semaine */}
      <section className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
            <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
            Recettes sélectionnées cette semaine ({weeklyRecipes.length})
          </h3>
          <span className="text-[11px] text-amber-800/80 hidden sm:inline">
            Cliquez sur un créneau Midi / Soir ci-dessous pour les placer
          </span>
        </div>

        {weeklyRecipes.length === 0 ? (
          <p className="text-xs text-amber-900/70">
            Aucune recette marquée pour cette semaine. Cliquez sur l’étoile ★ d’une recette dans le catalogue pour la retrouver ici rapidement.
          </p>
        ) : (
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {weeklyRecipes.map((rec) => (
              <div
                key={rec.id}
                className="flex shrink-0 items-center gap-2.5 rounded-xl border border-amber-200 bg-white p-2 pr-3 shadow-2xs"
              >
                {rec.imageFront && (
                  <img
                    src={rec.imageFront}
                    alt={rec.title}
                    className="h-10 w-10 rounded-lg object-cover cursor-pointer"
                    onClick={() => onOpenRecipe(rec)}
                  />
                )}
                <div className="max-w-[160px]">
                  <p
                    onClick={() => onOpenRecipe(rec)}
                    className="truncate text-xs font-bold text-stone-900 cursor-pointer hover:text-fresh-700"
                  >
                    {rec.title}
                  </p>
                  <p className="text-[11px] text-stone-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {rec.prepTimeMinutes} min
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleWeekly(rec.id)}
                  className="ml-1 rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  title="Retirer de la sélection semaine"
                  aria-label="Retirer de la sélection semaine"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Calendrier Lundi -> Dimanche (Midi / Soir) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {DAYS_OF_WEEK.map((day) => {
          const dayData = weeklyPlan[day.key] ?? { midi: null, soir: null };
          return (
            <div
              key={day.key}
              className="flex flex-col rounded-2xl border border-stone-200/80 bg-white shadow-xs overflow-hidden"
            >
              <div className="border-b border-stone-100 bg-stone-50 px-3 py-2.5 text-center">
                <span className="font-display text-sm font-bold text-stone-900">{day.label}</span>
              </div>

              <div className="flex flex-1 flex-col divide-y divide-stone-100">
                {(['midi', 'soir'] as MealSlot[]).map((slot) => {
                  const recipeId = dayData[slot];
                  const recipe = recipeId ? recipeMap.get(recipeId) : undefined;
                  const isMidi = slot === 'midi';
                  const plannedServings = recipe
                    ? (isMidi ? dayData.midiServings : dayData.soirServings) ?? recipe.servings
                    : 2;

                  return (
                    <div key={slot} className="flex flex-1 flex-col p-2.5 min-h-[115px]">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider ${
                            isMidi ? 'text-amber-600' : 'text-indigo-600'
                          }`}
                        >
                          {isMidi ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                          {isMidi ? 'Midi' : 'Soir'}
                        </span>
                        {recipe && (
                          <button
                            type="button"
                            onClick={() => onAssignSlot(day.key, slot, null)}
                            className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-red-600"
                            title="Retirer ce repas"
                            aria-label="Retirer ce repas"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {recipe ? (
                        <div
                          onClick={() => onOpenRecipe(recipe, plannedServings)}
                          className="group flex flex-1 flex-col justify-between rounded-xl border border-fresh-200/80 bg-fresh-50/40 p-2 cursor-pointer hover:border-fresh-400 hover:bg-fresh-50 transition-colors"
                        >
                          {recipe.imageFront && (
                            <img
                              src={recipe.imageFront}
                              alt={recipe.title}
                              className="mb-1.5 h-16 w-full rounded-lg object-cover"
                            />
                          )}
                          <p className="text-xs font-bold leading-snug text-stone-900 line-clamp-2 group-hover:text-fresh-800">
                            {recipe.title}
                          </p>
                          <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px] font-medium text-stone-500">
                            <span>{recipe.prepTimeMinutes} min</span>
                            <div
                              className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-1 py-0.5 text-stone-700"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  onAssignSlot(
                                    day.key,
                                    slot,
                                    recipe.id,
                                    Math.max(1, plannedServings - 1)
                                  )
                                }
                                className="rounded p-0.5 hover:bg-stone-100"
                                aria-label="Diminuer le nombre de personnes"
                              >
                                <Minus className="h-2.5 w-2.5" />
                              </button>
                              <span className="min-w-[2.2rem] text-center font-bold">
                                {plannedServings} p.
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  onAssignSlot(
                                    day.key,
                                    slot,
                                    recipe.id,
                                    Math.min(12, plannedServings + 1)
                                  )
                                }
                                className="rounded p-0.5 hover:bg-stone-100"
                                aria-label="Augmenter le nombre de personnes"
                              >
                                <Plus className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setPickerSearch('');
                            setIncludeAlreadyPlanned(false);
                            setPickingSlot({ day: day.key, slot });
                          }}
                          className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 text-stone-400 transition-colors hover:border-fresh-400 hover:bg-fresh-50/30 hover:text-fresh-700"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="mt-0.5 text-[11px] font-medium">Ajouter</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Sélecteur de recette pour un créneau */}
      {pickingSlot && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => setPickingSlot(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
              <div>
                <h3 className="font-display text-base font-bold text-stone-900">
                  Choisir une recette
                </h3>
                <p className="text-xs text-stone-500 capitalize">
                  {pickingSlot.day} — {pickingSlot.slot}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickingSlot(null)}
                className="rounded-xl p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Fermer la sélection de recette"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-stone-100 p-3 space-y-2.5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  type="text"
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Rechercher par titre ou tag…"
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2 pl-9 pr-3 text-sm focus:border-fresh-500 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-stone-600">
                    <Users className="h-3.5 w-3.5 text-amber-600" />
                    Portions :
                  </span>
                  <div className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-stone-50 px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => setPickerServings((s) => Math.max(1, s - 1))}
                      className="flex h-5 w-5 items-center justify-center rounded bg-white text-stone-700 shadow-2xs hover:bg-stone-100"
                      aria-label="Diminuer le nombre de personnes"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="min-w-[3.2rem] text-center text-xs font-bold text-stone-900">
                      {pickerServings} pers.
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickerServings((s) => Math.min(12, s + 1))}
                      className="flex h-5 w-5 items-center justify-center rounded bg-white text-stone-700 shadow-2xs hover:bg-stone-100"
                      aria-label="Augmenter le nombre de personnes"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {plannedRecipeIds.size > 0 && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-stone-600">
                    <input
                      type="checkbox"
                      checked={includeAlreadyPlanned}
                      onChange={(e) => setIncludeAlreadyPlanned(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-fresh-600"
                    />
                    Inclure déjà planifiées
                  </label>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {filteredPickerRecipes.length === 0 ? (
                <div className="py-8 text-center text-sm text-stone-500 space-y-2">
                  <p>
                    {plannedRecipeIds.size > 0 && !includeAlreadyPlanned && !pickerSearch.trim()
                      ? 'Toutes les recettes sont déjà planifiées cette semaine.'
                      : 'Aucune recette trouvée.'}
                  </p>
                  {plannedRecipeIds.size > 0 && !includeAlreadyPlanned && (
                    <button
                      type="button"
                      onClick={() => setIncludeAlreadyPlanned(true)}
                      className="text-xs font-semibold text-fresh-700 hover:underline"
                    >
                      Afficher les recettes déjà planifiées
                    </button>
                  )}
                </div>
              ) : (
                filteredPickerRecipes.map((rec) => (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => {
                      onAssignSlot(pickingSlot.day, pickingSlot.slot, rec.id, pickerServings);
                      setPickingSlot(null);
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-stone-200/80 p-2.5 text-left transition-colors hover:border-fresh-400 hover:bg-fresh-50/40"
                  >
                    {rec.imageFront ? (
                      <img
                        src={rec.imageFront}
                        alt={rec.title}
                        className="h-12 w-12 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-fresh-100 text-fresh-700 font-bold text-xs">
                        HF
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {rec.isWeekly && (
                          <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />
                        )}
                        <p className="truncate text-sm font-bold text-stone-900">{rec.title}</p>
                      </div>
                      <p className="text-xs text-stone-500">
                        {rec.prepTimeMinutes} min · {rec.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
