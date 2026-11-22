import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
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
  AlertCircle,
  Cloud,
  User as UserIcon,
  FileStack,
} from 'lucide-react';
import { deconnexionFirebase, observerAuth } from './lib/firebase';
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
  activerSyncCloud,
  arreterListenersFirestore,
  cloudState as initialCloudState,
  CloudState,
  forcerSyncCloud,
  loadGeminiApiKey,
  loadLocalRecipes,
  loadLocalWeeklyPlan,
  reinitialiserEtatCloud,
  sauvegarderDonnees,
  saveGeminiApiKey,
  subscribeCloudState,
} from './utils/storage';
import { CloudAuthModal } from './components/AuthScreen';
import { RecipeCard } from './components/RecipeCard';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipeFormModal } from './components/RecipeFormModal';
import { BatchImportModal } from './components/BatchImportModal';
import { WeeklyPlanner } from './components/WeeklyPlanner';
import { SettingsBackupModal } from './components/SettingsBackupModal';

type ActiveTab = 'catalog' | 'planner';

const APP_VERSION = '1.1.0';

export function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan>(createEmptyWeeklyPlan);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [cloud, setCloud] = useState<CloudState>(initialCloudState);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  const recipesRef = useRef<Recipe[]>([]);
  const weeklyPlanRef = useRef<WeeklyPlan>(createEmptyWeeklyPlan());

  const updateRecipesState = useCallback((next: Recipe[]) => {
    recipesRef.current = next;
    setRecipes(next);
  }, []);

  const updateWeeklyPlanState = useCallback((next: WeeklyPlan) => {
    weeklyPlanRef.current = next;
    setWeeklyPlan(next);
  }, []);

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
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickPlanRecipe, setQuickPlanRecipe] = useState<Recipe | null>(null);
  const [quickPlanServings, setQuickPlanServings] = useState(2);

  // Remonter automatiquement en haut de page lors du changement de vue ou d'onglet
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeTab, selectedRecipeId]);

  useEffect(() => {
    return subscribeCloudState((state) => {
      setCloud(state);
      if (!state.syncError) {
        setDismissedError(null);
      }
    });
  }, []);

  const startCloudSync = useCallback(async () => {
    await activerSyncCloud({
      getLocalRecipes: () => recipesRef.current,
      getLocalWeeklyPlan: () => weeklyPlanRef.current,
      onRecipesChange: (syncedRecipes) => {
        updateRecipesState(syncedRecipes);
      },
      onWeeklyPlanChange: (syncedPlan) => {
        updateWeeklyPlanState(syncedPlan);
      },
    });
  }, [updateRecipesState, updateWeeklyPlanState]);

  // Chargement initial local-first puis écoute Auth
  useEffect(() => {
    let unsubAuth: (() => void) | null = null;
    let cancelled = false;

    setGeminiApiKey(loadGeminiApiKey());
    const localPlan = loadLocalWeeklyPlan();
    updateWeeklyPlanState(localPlan);

    loadLocalRecipes()
      .then((localRecs) => {
        if (cancelled) return;
        updateRecipesState(localRecs);
        setLoading(false);

        unsubAuth = observerAuth((firebaseUser) => {
          if (cancelled) return;
          setUser(firebaseUser);
          if (firebaseUser) {
            void startCloudSync();
          } else {
            arreterListenersFirestore();
            reinitialiserEtatCloud();
          }
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (unsubAuth) unsubAuth();
      arreterListenersFirestore();
    };
  }, [startCloudSync, updateRecipesState, updateWeeklyPlanState]);

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
    const nextRecipes = [
      recipe,
      ...recipesRef.current.filter((r) => r.id !== recipe.id),
    ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

    updateRecipesState(nextRecipes);
    await sauvegarderDonnees(nextRecipes, weeklyPlanRef.current);

    setFormModalOpen(false);
    setEditingRecipe(null);
    setSelectedRecipeId(recipe.id);
    setActiveTab('catalog');
  };

  const handleBatchImportRecipe = useCallback(
    async (recipe: Recipe) => {
      const nextRecipes = [
        recipe,
        ...recipesRef.current.filter((r) => r.id !== recipe.id),
      ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

      updateRecipesState(nextRecipes);
      await sauvegarderDonnees(nextRecipes, weeklyPlanRef.current);
    },
    [updateRecipesState]
  );

  const handleDeleteRecipe = async (id: string) => {
    const nextRecipes = recipesRef.current.filter((r) => r.id !== id);

    const nextPlan = { ...weeklyPlanRef.current };
    for (const d of DAYS_OF_WEEK) {
      if (nextPlan[d.key].midi === id) {
        nextPlan[d.key] = { ...nextPlan[d.key], midi: null };
      }
      if (nextPlan[d.key].soir === id) {
        nextPlan[d.key] = { ...nextPlan[d.key], soir: null };
      }
    }

    updateRecipesState(nextRecipes);
    updateWeeklyPlanState(nextPlan);
    await sauvegarderDonnees(nextRecipes, nextPlan);
    setSelectedRecipeId(null);
  };

  const handleToggleWeekly = async (recipeId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const target = recipesRef.current.find((r) => r.id === recipeId);
    if (!target) return;
    const updated: Recipe = {
      ...target,
      isWeekly: !target.isWeekly,
      updatedAt: new Date().toISOString(),
    };
    const nextRecipes = recipesRef.current.map((r) => (r.id === recipeId ? updated : r));
    updateRecipesState(nextRecipes);
    await sauvegarderDonnees(nextRecipes, weeklyPlanRef.current);
  };

  const handleAssignSlot = (
    day: DayOfWeek,
    slot: MealSlot,
    recipeId: string | null,
    servings?: number
  ) => {
    const servingsKey = slot === 'midi' ? 'midiServings' : 'soirServings';
    const nextDay = { ...weeklyPlanRef.current[day], [slot]: recipeId };
    if (recipeId === null) {
      delete nextDay[servingsKey];
    } else if (servings !== undefined) {
      nextDay[servingsKey] = servings;
    }

    const nextPlan: WeeklyPlan = {
      ...weeklyPlanRef.current,
      [day]: nextDay,
    };
    updateWeeklyPlanState(nextPlan);
    void sauvegarderDonnees(recipesRef.current, nextPlan);
  };

  const handleClearWeek = () => {
    const empty = createEmptyWeeklyPlan();
    updateWeeklyPlanState(empty);
    void sauvegarderDonnees(recipesRef.current, empty);
  };

  const handleImportBackup = async (backup: RecipeBookBackup, mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const nextRecipes = backup.recipes.map((r) => ({ ...r, id: String(r.id) }));
      const nextPlan = backup.weeklyPlan ?? createEmptyWeeklyPlan();
      updateRecipesState(nextRecipes);
      updateWeeklyPlanState(nextPlan);
      await sauvegarderDonnees(nextRecipes, nextPlan);
    } else {
      const existingIds = new Set(recipesRef.current.map((r) => String(r.id)));
      const newOnes = backup.recipes
        .filter((r) => r && r.id && !existingIds.has(String(r.id)))
        .map((r) => ({ ...r, id: String(r.id) }));
      const nextRecipes = [...recipesRef.current, ...newOnes].sort((a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      );
      updateRecipesState(nextRecipes);
      await sauvegarderDonnees(nextRecipes, weeklyPlanRef.current);
    }
  };

  const handleSignOut = async () => {
    arreterListenersFirestore();
    await deconnexionFirebase();
    reinitialiserEtatCloud();
    setUser(null);
  };

  const handleForceSync = async () => {
    await forcerSyncCloud(recipesRef.current, weeklyPlanRef.current);
  };

  const toggleFilterTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const authLabel = user
    ? (user.email || user.displayName || 'Cloud').split('@')[0]
    : 'Connexion';

  const visibleSyncError =
    cloud.syncError && cloud.syncError !== dismissedError ? cloud.syncError : null;

  return (
    <div className="min-h-screen bg-cream text-stone-900 flex flex-col">
      {/* Header Desktop & Mobile */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          {/* Logo */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('catalog');
              setSelectedRecipeId(null);
            }}
            className="flex min-w-0 items-center gap-2 text-left sm:gap-2.5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-fresh-600 text-white shadow-sm shadow-fresh-600/25 sm:h-10 sm:w-10">
              <UtensilsCrossed className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-display text-sm font-extrabold tracking-tight text-stone-900 sm:text-lg">
                  Carnet HelloFresh
                </span>
                <span
                  id="header-version-badge"
                  className="hidden rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-stone-500 sm:inline-block"
                >
                  v{APP_VERSION}
                </span>
              </div>
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
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              id="btn-auth-header"
              onClick={() => setAuthModalOpen(true)}
              title={
                user
                  ? `Connecté : ${user.email || user.uid}`
                  : 'Se connecter au Cloud'
              }
              aria-label="Compte Cloud"
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition-colors sm:h-10 sm:px-3 ${
                user
                  ? cloud.syncStatus === 'error'
                    ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                    : 'border-fresh-200 bg-fresh-50/70 text-fresh-800 hover:bg-fresh-100'
                  : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50 hover:text-stone-900'
              }`}
            >
              {user ? (
                <UserIcon className="h-4 w-4 shrink-0" />
              ) : (
                <Cloud className="h-4 w-4 shrink-0 text-fresh-600" />
              )}
              <span className="btn-text hidden max-w-[110px] truncate sm:inline">{authLabel}</span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-900 sm:h-10 sm:w-10"
              title="Sauvegarde JSON & Réglages"
              aria-label="Sauvegarde JSON & Réglages"
            >
              <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>

            <button
              type="button"
              onClick={() => setBatchImportOpen(true)}
              title="Importer un dossier de scans JPEG en masse"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 text-xs font-bold text-stone-700 transition-colors hover:bg-stone-50 hover:text-stone-900 sm:h-10 sm:px-3 sm:text-sm"
            >
              <FileStack className="h-4 w-4 text-fresh-600" />
              <span className="hidden lg:inline">Import en masse</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingRecipe(null);
                setFormModalOpen(true);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-fresh-600 px-2.5 text-xs font-bold text-white shadow-sm shadow-fresh-600/20 transition-all hover:bg-fresh-700 sm:h-10 sm:px-3.5 sm:text-sm"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Ajouter une recette</span>
              <span className="sm:hidden">Ajouter</span>
            </button>
          </div>
        </div>
      </header>

      {/* Contenu Principal */}
      <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-3 py-4 pb-24 sm:px-6 sm:py-7 md:pb-7">
        {visibleSyncError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {visibleSyncError}
            </span>
            <button
              type="button"
              onClick={() => setDismissedError(visibleSyncError)}
              className="rounded-lg p-1 hover:bg-red-100"
              aria-label="Fermer l'alerte"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm font-medium text-stone-500">
            Chargement de votre livre de recettes…
          </div>
        ) : selectedRecipe ? (
          <RecipeDetail
            recipe={selectedRecipe}
            initialServings={selectedRecipeInitialServings}
            backLabel={activeTab === 'planner' ? 'Semaine' : 'Catalogue'}
            onBack={() => {
              setSelectedRecipeId(null);
              setSelectedRecipeInitialServings(undefined);
            }}
            onEdit={(rec) => {
              setEditingRecipe(rec);
              setFormModalOpen(true);
            }}
            onDelete={activeTab === 'catalog' ? handleDeleteRecipe : undefined}
            onToggleWeekly={(id) => handleToggleWeekly(id)}
            onPlanRecipe={(rec) => {
              setQuickPlanServings(rec.servings || 2);
              setQuickPlanRecipe(rec);
            }}
          />
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
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-stone-200 bg-white/95 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-md md:hidden">
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

      {/* Modal Connexion Cloud */}
      {authModalOpen && (
        <CloudAuthModal
          user={user}
          cloudState={cloud}
          recipesCount={recipes.length}
          onForceSync={handleForceSync}
          onRestartSync={startCloudSync}
          onUserReloaded={(u) => setUser(u)}
          onSignOut={handleSignOut}
          onClose={() => setAuthModalOpen(false)}
        />
      )}

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

      {/* Modal Import en masse */}
      {batchImportOpen && (
        <BatchImportModal
          existingRecipes={recipes}
          geminiApiKey={geminiApiKey}
          onImportRecipe={handleBatchImportRecipe}
          onClose={() => setBatchImportOpen(false)}
        />
      )}

      {/* Modal Sauvegarde & Réglages */}
      {settingsOpen && (
        <SettingsBackupModal
          recipes={recipes}
          weeklyPlan={weeklyPlan}
          geminiApiKey={geminiApiKey}
          userEmail={user?.email}
          userDisplayName={user?.displayName}
          onOpenCloudModal={() => setAuthModalOpen(true)}
          onSaveGeminiKey={(k) => {
            saveGeminiApiKey(k);
            setGeminiApiKey(k);
          }}
          onImportBackup={handleImportBackup}
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
            className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5"
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
