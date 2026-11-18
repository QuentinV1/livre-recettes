import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Plus,
  Search,
  Settings,
  Star,
  X,
  UtensilsCrossed,
  Sun,
  Moon,
  Minus,
  Users,
} from 'lucide-react';
import {
  DAYS_OF_WEEK,
  DayOfWeek,
  MealSlot,
  Recipe,
  RecipeBookBackup,
  WeeklyPlan,
  createEmptyWeeklyPlan,
} from './types/recipe';
import {
  deleteRecipeById,
  loadGeminiApiKey,
  loadRecipes,
  loadWeeklyPlan,
  saveAllRecipes,
  saveGeminiApiKey,
  saveRecipe,
  saveWeeklyPlan,
} from './utils/storage';
import { SAMPLE_RECIPES } from './data/sampleRecipes';
import { RecipeCard } from './components/RecipeCard';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeFormModal } from './components/RecipeFormModal';
import { WeeklyPlanner } from './components/WeeklyPlanner';
import { SettingsBackupModal } from './components/SettingsBackupModal';

type ActiveTab = 'catalog' | 'planner';

export function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan>(createEmptyWeeklyPlan);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [selectedRecipeInitialServings, setSelectedRecipeInitialServings] = useState<
    number | undefined
  >(undefined);

  // Recherche & filtres
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [onlyWeekly, setOnlyWeekly] = useState(false);

  // Modales
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickPlanRecipe, setQuickPlanRecipe] = useState<Recipe | null>(null);
  const [quickPlanServings, setQuickPlanServings] = useState(2);

  // Remonter automatiquement en haut de page lors du changement de vue ou d'onglet
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeTab, selectedRecipeId]);

  useEffect(() => {
    (async () => {
      const loaded = await loadRecipes();
      setRecipes(loaded);
      setWeeklyPlan(loadWeeklyPlan());
      setGeminiApiKey(loadGeminiApiKey());
      setLoading(false);
    })();
  }, []);

  const selectedRecipe = useMemo(
    () => recipes.find((r) => r.id === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId]
  );

  // Tous les tags disponibles dans le catalogue
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes) {
      for (const t of r.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
      .map(([tag, count]) => ({ tag, count }));
  }, [recipes]);

  // Filtrage multi-critères (titre, sous-titre, ingrédients, tags, étapes)
  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recipes.filter((r) => {
      if (onlyWeekly && !r.isWeekly) return false;
      if (selectedTags.length > 0 && !selectedTags.every((t) => r.tags.includes(t))) {
        return false;
      }
      if (!q) return true;

      const haystack = [
        r.title,
        r.subtitle ?? '',
        ...r.tags,
        ...r.ingredients.map((i) => i.name),
        ...r.steps,
      ]
        .join(' ')
        .toLowerCase();

      return q.split(/\s+/).every((word) => haystack.includes(word));
    });
  }, [recipes, searchQuery, selectedTags, onlyWeekly]);

  const weeklyCount = useMemo(() => recipes.filter((r) => r.isWeekly).length, [recipes]);

  const handleSaveRecipe = async (recipe: Recipe) => {
    await saveRecipe(recipe);
    setRecipes((prev) => {
      const exists = prev.some((r) => r.id === recipe.id);
      return exists ? prev.map((r) => (r.id === recipe.id ? recipe : r)) : [recipe, ...prev];
    });
    setFormModalOpen(false);
    setEditingRecipe(null);
    setSelectedRecipeId(recipe.id);
    setActiveTab('catalog');
  };

  const handleDeleteRecipe = async (id: string) => {
    await deleteRecipeById(id);
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    // Nettoyer aussi le planning si cette recette était placée
    const nextPlan = { ...weeklyPlan };
    let changed = false;
    for (const d of DAYS_OF_WEEK) {
      if (nextPlan[d.key].midi === id) {
        nextPlan[d.key] = { ...nextPlan[d.key], midi: null };
        changed = true;
      }
      if (nextPlan[d.key].soir === id) {
        nextPlan[d.key] = { ...nextPlan[d.key], soir: null };
        changed = true;
      }
    }
    if (changed) {
      setWeeklyPlan(nextPlan);
      saveWeeklyPlan(nextPlan);
    }
    setSelectedRecipeId(null);
  };

  const handleToggleWeekly = async (recipeId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const target = recipes.find((r) => r.id === recipeId);
    if (!target) return;
    const updated: Recipe = {
      ...target,
      isWeekly: !target.isWeekly,
      updatedAt: new Date().toISOString(),
    };
    await saveRecipe(updated);
    setRecipes((prev) => prev.map((r) => (r.id === recipeId ? updated : r)));
  };

  const handleAssignSlot = (
    day: DayOfWeek,
    slot: MealSlot,
    recipeId: string | null,
    servings?: number
  ) => {
    const servingsKey = slot === 'midi' ? 'midiServings' : 'soirServings';
    const nextDay = { ...weeklyPlan[day], [slot]: recipeId };
    if (recipeId === null) {
      delete nextDay[servingsKey];
    } else if (servings !== undefined) {
      nextDay[servingsKey] = servings;
    }

    const nextPlan: WeeklyPlan = {
      ...weeklyPlan,
      [day]: nextDay,
    };
    setWeeklyPlan(nextPlan);
    saveWeeklyPlan(nextPlan);
  };

  const handleClearWeek = () => {
    const empty = createEmptyWeeklyPlan();
    setWeeklyPlan(empty);
    saveWeeklyPlan(empty);
  };

  const handleImportBackup = async (backup: RecipeBookBackup, mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      await saveAllRecipes(backup.recipes);
      setRecipes(backup.recipes);
      const nextPlan = backup.weeklyPlan ?? createEmptyWeeklyPlan();
      setWeeklyPlan(nextPlan);
      saveWeeklyPlan(nextPlan);
    } else {
      const existingIds = new Set(recipes.map((r) => r.id));
      const newOnes = backup.recipes.filter((r) => !existingIds.has(r.id));
      const merged = [...newOnes, ...recipes];
      await saveAllRecipes(merged);
      setRecipes(merged);
    }
  };

  const handleRestoreSamples = async () => {
    const existingIds = new Set(recipes.map((r) => r.id));
    const missing = SAMPLE_RECIPES.filter((s) => !existingIds.has(s.id));
    if (missing.length === 0) return;
    const merged = [...recipes, ...missing];
    await saveAllRecipes(merged);
    setRecipes(merged);
  };

  const toggleFilterTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="min-h-screen bg-cream text-stone-900 flex flex-col">
      {/* Header Desktop & Mobile */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Logo */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('catalog');
              setSelectedRecipeId(null);
            }}
            className="flex items-center gap-2.5 text-left"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fresh-600 text-white shadow-sm shadow-fresh-600/25">
              <UtensilsCrossed className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display text-base font-extrabold tracking-tight text-stone-900 sm:text-lg">
                Carnet HelloFresh
              </span>
              <p className="hidden text-[11px] font-medium text-stone-500 sm:block">
                {recipes.length} recette{recipes.length > 1 ? 's' : ''} · {weeklyCount} cette semaine
              </p>
            </div>
          </button>

          {/* Navigation Desktop */}
          <nav className="hidden items-center gap-1.5 rounded-2xl bg-stone-100 p-1 md:flex">
            <button
              type="button"
              onClick={() => {
                setActiveTab('catalog');
                setSelectedRecipeId(null);
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                activeTab === 'catalog'
                  ? 'bg-white text-fresh-700 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <BookOpen className="h-4 w-4" />
              Catalogue
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('planner');
                setSelectedRecipeId(null);
              }}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                activeTab === 'planner'
                  ? 'bg-white text-fresh-700 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Calendar className="h-4 w-4" />
              Semaine & Planning
              {weeklyCount > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                  {weeklyCount}
                </span>
              )}
            </button>
          </nav>

          {/* Actions droite */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900"
              title="Sauvegarde JSON & Réglages"
              aria-label="Sauvegarde JSON & Réglages"
            >
              <Settings className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingRecipe(null);
                setFormModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-fresh-600 px-3.5 py-2.5 text-sm font-bold text-white shadow-sm shadow-fresh-600/20 transition-all hover:bg-fresh-700"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Ajouter une recette</span>
              <span className="sm:hidden">Ajouter</span>
            </button>
          </div>
        </div>
      </header>

      {/* Contenu Principal */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-7">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm font-medium text-stone-500">
            Chargement de votre livre de recettes…
          </div>
        ) : activeTab === 'planner' ? (
          <WeeklyPlanner
            recipes={recipes}
            weeklyPlan={weeklyPlan}
            onAssignSlot={handleAssignSlot}
            onClearWeek={handleClearWeek}
            onToggleWeekly={(id) => handleToggleWeekly(id)}
            onOpenRecipe={(rec, plannedServings) => {
              setSelectedRecipeInitialServings(plannedServings);
              setSelectedRecipeId(rec.id);
              setActiveTab('catalog');
            }}
          />
        ) : selectedRecipe ? (
          <RecipeDetail
            recipe={selectedRecipe}
            initialServings={selectedRecipeInitialServings}
            onBack={() => {
              setSelectedRecipeId(null);
              setSelectedRecipeInitialServings(undefined);
            }}
            onEdit={(rec) => {
              setEditingRecipe(rec);
              setFormModalOpen(true);
            }}
            onDelete={handleDeleteRecipe}
            onToggleWeekly={(id) => handleToggleWeekly(id)}
            onPlanRecipe={(rec) => {
              setQuickPlanServings(rec.servings || 2);
              setQuickPlanRecipe(rec);
            }}
          />
        ) : (
          <div className="space-y-5 pb-20 sm:pb-10">
            {/* Barre de recherche & filtres */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs space-y-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher par titre, ingrédient (ex: poulet, parmesan), tag…"
                    className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-9 text-sm text-stone-900 placeholder:text-stone-400 focus:border-fresh-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-fresh-500/15"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                      aria-label="Effacer la recherche"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setOnlyWeekly((v) => !v)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors sm:text-sm ${
                    onlyWeekly
                      ? 'bg-amber-400 text-stone-950 shadow-2xs'
                      : 'border border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  <Star className={`h-4 w-4 ${onlyWeekly ? 'fill-current' : 'text-amber-500'}`} />
                  Recettes de la semaine ({weeklyCount})
                </button>
              </div>

              {/* Tags rapides */}
              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-stone-400">
                    Tags :
                  </span>
                  {allTags.map(({ tag, count }) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleFilterTag(tag)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-fresh-600 text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        #{tag}
                        <span className={`text-[10px] ${active ? 'text-fresh-100' : 'text-stone-400'}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}

                  {(selectedTags.length > 0 || searchQuery || onlyWeekly) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTags([]);
                        setSearchQuery('');
                        setOnlyWeekly(false);
                      }}
                      className="ml-auto text-xs font-semibold text-fresh-700 hover:underline"
                    >
                      Réinitialiser les filtres
                    </button>
                  )}
                </div>
              )}
            </section>

            {/* Grille des recettes */}
            {filteredRecipes.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-stone-300 bg-white/70 py-16 px-4 text-center">
                <UtensilsCrossed className="h-10 w-10 text-stone-300 mb-3" />
                <h3 className="font-display text-base font-bold text-stone-800">
                  Aucune recette ne correspond à votre recherche
                </h3>
                <p className="mt-1 text-xs text-stone-500 max-w-sm">
                  Essayez d’élargir vos filtres ou ajoutez une nouvelle fiche recette HelloFresh.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTags([]);
                    setSearchQuery('');
                    setOnlyWeekly(false);
                  }}
                  className="mt-4 rounded-xl bg-fresh-600 px-4 py-2 text-xs font-bold text-white hover:bg-fresh-700"
                >
                  Tout afficher
                </button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredRecipes.map((rec) => (
                  <RecipeCard
                    key={rec.id}
                    recipe={rec}
                    onOpen={(r) => {
                      setSelectedRecipeInitialServings(undefined);
                      setSelectedRecipeId(r.id);
                    }}
                    onToggleWeekly={handleToggleWeekly}
                    onQuickPlan={(r, e) => {
                      e.stopPropagation();
                      setQuickPlanServings(r.servings || 2);
                      setQuickPlanRecipe(r);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Barre de navigation Mobile (en bas) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-stone-200 bg-white/95 py-2 backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => {
            setActiveTab('catalog');
            setSelectedRecipeId(null);
          }}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[11px] font-bold ${
            activeTab === 'catalog' ? 'text-fresh-700' : 'text-stone-500'
          }`}
        >
          <BookOpen className="h-5 w-5" />
          Catalogue
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('planner');
            setSelectedRecipeId(null);
          }}
          className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[11px] font-bold ${
            activeTab === 'planner' ? 'text-fresh-700' : 'text-stone-500'
          }`}
        >
          <Calendar className="h-5 w-5" />
          Semaine
        </button>
        <button
          type="button"
          onClick={() => {
            setEditingRecipe(null);
            setFormModalOpen(true);
          }}
          className="flex flex-col items-center gap-0.5 px-3 py-1 text-[11px] font-bold text-fresh-600"
        >
          <Plus className="h-5 w-5" />
          Ajouter
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex flex-col items-center gap-0.5 px-3 py-1 text-[11px] font-bold text-stone-500"
        >
          <Settings className="h-5 w-5" />
          Sauvegarde
        </button>
      </nav>

      {/* Modal Ajout / Édition */}
      {formModalOpen && (
        <RecipeFormModal
          initialRecipe={editingRecipe}
          geminiApiKey={geminiApiKey}
          onSave={handleSaveRecipe}
          onClose={() => {
            setFormModalOpen(false);
            setEditingRecipe(null);
          }}
        />
      )}

      {/* Modal Sauvegarde & Réglages */}
      {settingsOpen && (
        <SettingsBackupModal
          recipes={recipes}
          weeklyPlan={weeklyPlan}
          geminiApiKey={geminiApiKey}
          onSaveGeminiKey={(k) => {
            saveGeminiApiKey(k);
            setGeminiApiKey(k);
          }}
          onImportBackup={handleImportBackup}
          onRestoreSamples={handleRestoreSamples}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Modal Planification rapide Midi / Soir */}
      {quickPlanRecipe && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => setQuickPlanRecipe(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-fresh-700">
                  Planifier cette recette
                </p>
                <h3 className="truncate font-display text-base font-bold text-stone-900">
                  {quickPlanRecipe.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuickPlanRecipe(null)}
                className="rounded-xl p-1.5 text-stone-400 hover:bg-stone-100"
                aria-label="Fermer la fenêtre de planification"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-stone-700">
                <Users className="h-4 w-4 text-amber-600" />
                Nombre de personnes
              </span>
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setQuickPlanServings((s) => Math.max(1, s - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                  aria-label="Diminuer le nombre de personnes"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[3.5rem] text-center text-sm font-bold text-stone-900">
                  {quickPlanServings} pers.
                </span>
                <button
                  type="button"
                  onClick={() => setQuickPlanServings((s) => Math.min(12, s + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                  aria-label="Augmenter le nombre de personnes"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {DAYS_OF_WEEK.map((d) => (
                <div
                  key={d.key}
                  className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2"
                >
                  <span className="text-sm font-bold text-stone-800">{d.label}</span>
                  <div className="flex gap-2">
                    {(['midi', 'soir'] as MealSlot[]).map((slot) => {
                      const occupied = !!weeklyPlan[d.key]?.[slot];
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => {
                            handleAssignSlot(d.key, slot, quickPlanRecipe.id, quickPlanServings);
                            setQuickPlanRecipe(null);
                            setActiveTab('planner');
                            setSelectedRecipeId(null);
                          }}
                          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                            occupied
                              ? 'bg-stone-100 text-stone-600 hover:bg-fresh-100 hover:text-fresh-800'
                              : 'bg-fresh-50 text-fresh-800 border border-fresh-200 hover:bg-fresh-600 hover:text-white'
                          }`}
                        >
                          {slot === 'midi' ? (
                            <Sun className="h-3.5 w-3.5" />
                          ) : (
                            <Moon className="h-3.5 w-3.5" />
                          )}
                          {slot === 'midi' ? 'Midi' : 'Soir'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
