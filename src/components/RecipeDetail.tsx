import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  Users,
  Star,
  Pencil,
  Trash2,
  ChefHat,
  Check,
  CalendarPlus,
  Image as ImageIcon,
  Minus,
  Plus,
  RotateCcw,
  Maximize2,
  X,
} from 'lucide-react';
import { Recipe } from '../types/recipe';
import { formatAverageScore, getRecipeRatingStats } from '../utils/ratings';
import { CookingModeModal, scaleQuantity } from './CookingModeModal';

interface RecipeDetailProps {
  recipe: Recipe;
  initialServings?: number;
  backLabel?: string;
  currentUserId: string;
  canEdit?: boolean;
  isInFoyer?: boolean;
  onBack: () => void;
  onEdit: (recipe: Recipe) => void;
  onDelete?: (id: string) => void;
  onToggleWeekly: (id: string) => void;
  onPlanRecipe: (recipe: Recipe) => void;
  onRate: (recipeId: string, score: number | null) => void;
}

export const RecipeDetail: React.FC<RecipeDetailProps> = ({
  recipe,
  initialServings,
  backLabel = 'Catalogue',
  currentUserId,
  canEdit = true,
  isInFoyer = false,
  onBack,
  onEdit,
  onDelete,
  onToggleWeekly,
  onPlanRecipe,
  onRate,
}) => {
  const [activePhoto, setActivePhoto] = useState<'front' | 'back'>('front');
  const [targetServings, setTargetServings] = useState<number>(
    initialServings ?? recipe.servings ?? 2
  );

  useEffect(() => {
    setTargetServings(initialServings ?? recipe.servings ?? 2);
  }, [recipe.id, recipe.servings, initialServings]);
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>({});
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const [cookingModeOpen, setCookingModeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const ratingStats = getRecipeRatingStats(recipe);
  const myRating = recipe.ratings?.[currentUserId]?.score ?? 0;

  const multiplier = recipe.servings > 0 ? targetServings / recipe.servings : 1;

  const currentImage =
    activePhoto === 'back' && recipe.imageBack ? recipe.imageBack : recipe.imageFront;

  const toggleIngredient = (id: string) => {
    setCheckedIngredients((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleStep = (idx: number) => {
    setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const resetProgress = () => {
    setCheckedIngredients({});
    setCheckedSteps({});
  };

  const completedStepsCount = Object.values(checkedSteps).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-4xl pb-20 sm:pb-10">
      {/* Barre d'actions supérieure */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-semibold text-stone-700 shadow-sm hover:bg-stone-50"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {isInFoyer && !canEdit && (
            <span className="inline-flex items-center rounded-xl bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-600">
              Par {recipe.ownerName || 'un membre'} · Lecture &amp; note
            </span>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={() => onToggleWeekly(recipe.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                recipe.isWeekly
                  ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300 hover:bg-amber-200'
                  : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
              }`}
            >
              <Star className={`h-4 w-4 ${recipe.isWeekly ? 'fill-amber-500 text-amber-500' : ''}`} />
              <span className="hidden sm:inline">
                {recipe.isWeekly ? 'Recette de la semaine' : 'Semaine'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onPlanRecipe(recipe)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
          >
            <CalendarPlus className="h-4 w-4 text-fresh-600" />
            <span className="hidden sm:inline">Planifier</span>
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(recipe)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50"
            >
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Modifier</span>
            </button>
          )}

          {canEdit && onDelete && (!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 hover:border-red-200"
              aria-label="Supprimer la recette"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 rounded-xl bg-red-50 px-2.5 py-1.5 ring-1 ring-red-200">
              <span className="text-xs font-semibold text-red-800">Supprimer ?</span>
              <button
                type="button"
                onClick={() => onDelete(recipe.id)}
                className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700"
              >
                Oui
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
              >
                Non
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Carte principale */}
      <div className="overflow-hidden rounded-3xl border border-stone-200/80 bg-white shadow-sm">
        {/* Visuel Recto / Verso */}
        <div className="relative bg-stone-100">
          {currentImage ? (
            <div className="relative aspect-[16/9] max-h-[380px] w-full overflow-hidden">
              <img
                src={currentImage}
                alt={recipe.title}
                onClick={() => setLightboxOpen(true)}
                className="h-full w-full object-cover cursor-zoom-in"
              />
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                title="Agrandir l'image"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex h-48 w-full flex-col items-center justify-center bg-gradient-to-br from-fresh-50 to-fresh-100 text-fresh-700">
              <ChefHat className="h-12 w-12 opacity-60" />
              <span className="mt-2 text-sm font-medium">Aucune photo associée</span>
            </div>
          )}

          {/* Switcher Recto / Verso si les deux existent */}
          {(recipe.imageFront || recipe.imageBack) && recipe.imageBack && (
            <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1 rounded-xl bg-black/60 p-1 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setActivePhoto('front')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activePhoto === 'front' ? 'bg-white text-stone-900' : 'text-white/90 hover:text-white'
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Recto (Plat)
              </button>
              <button
                type="button"
                onClick={() => setActivePhoto('back')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  activePhoto === 'back' ? 'bg-white text-stone-900' : 'text-white/90 hover:text-white'
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Verso (Fiche)
              </button>
            </div>
          )}
        </div>

        {/* En-tête Recette */}
        <div className="p-4 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {recipe.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-lg bg-fresh-50 px-2.5 py-1 text-xs font-semibold text-fresh-800 ring-1 ring-inset ring-fresh-200"
              >
                #{tag}
              </span>
            ))}
          </div>

          <h1 className="break-words font-display text-2xl font-extrabold tracking-tight text-stone-900 sm:text-3xl">
            {recipe.title}
          </h1>
          {recipe.subtitle && (
            <p className="mt-1.5 text-base text-stone-600">{recipe.subtitle}</p>
          )}

          {/* Métadonnées + Bouton Mode Cuisine */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-stone-50 p-4 border border-stone-200/70">
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fresh-100 text-fresh-700">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                    Préparation
                  </p>
                  <p className="text-sm font-bold text-stone-900">
                    {recipe.prepTimeRange || `${recipe.prepTimeMinutes} min`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                    Portions
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTargetServings((s) => Math.max(1, s - 1))}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                      aria-label="Diminuer les portions"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="min-w-[3.5rem] text-center text-sm font-bold text-stone-900">
                      {targetServings} pers.
                    </span>
                    <button
                      type="button"
                      onClick={() => setTargetServings((s) => Math.min(12, s + 1))}
                      className="flex h-6 w-6 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                      aria-label="Augmenter les portions"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCookingModeOpen(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-fresh-600 px-5 py-3 text-sm font-bold text-white shadow-sm shadow-fresh-600/20 transition-all hover:bg-fresh-700 active:scale-[0.99]"
            >
              <ChefHat className="h-5 w-5" />
              Mode Cuisine pas à pas
            </button>
          </div>

          {/* Notes & Avis par personne */}
          <div className="mt-5 rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                  <Star className="h-5 w-5 fill-amber-400 text-amber-500" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-stone-500">
                    Note moyenne
                  </p>
                  {ratingStats.count > 0 ? (
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-xl font-extrabold text-stone-900">
                        {formatAverageScore(ratingStats.average)}
                        <span className="text-sm font-semibold text-stone-500"> / 5</span>
                      </span>
                      <span className="text-xs text-stone-500">
                        ({ratingStats.count} {ratingStats.count > 1 ? 'avis' : 'avis'})
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-stone-600">
                      Aucune note pour l&apos;instant
                    </p>
                  )}
                </div>
              </div>

              {/* Sélecteur de note personnelle */}
              <div className="flex flex-col items-start sm:items-end gap-1">
                <span className="text-xs font-semibold text-stone-600">
                  {myRating > 0 ? `Votre note : ${myRating}/5` : 'Noter cette recette'}
                </span>
                <div
                  className="flex items-center gap-1"
                  onMouseLeave={() => setHoverRating(null)}
                >
                  {[1, 2, 3, 4, 5].map((starValue) => {
                    const active = (hoverRating ?? myRating) >= starValue;
                    return (
                      <button
                        key={starValue}
                        type="button"
                        onMouseEnter={() => setHoverRating(starValue)}
                        onClick={() =>
                          onRate(recipe.id, myRating === starValue ? null : starValue)
                        }
                        className="rounded-lg p-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-400"
                        title={
                          myRating === starValue
                            ? 'Cliquer pour retirer votre note'
                            : `Donner ${starValue} étoile${starValue > 1 ? 's' : ''}`
                        }
                        aria-label={`Noter ${starValue} sur 5`}
                      >
                        <Star
                          className={`h-6 w-6 transition-colors ${
                            active
                              ? 'fill-amber-400 text-amber-500'
                              : 'text-stone-300 hover:text-amber-300'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {ratingStats.entries.length > 0 && (
              <div className="mt-4 pt-3 border-t border-amber-200/60 flex flex-wrap gap-2">
                {ratingStats.entries.map((entry) => {
                  const isMe = entry.uid === currentUserId;
                  return (
                    <div
                      key={entry.uid}
                      className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs border ${
                        isMe
                          ? 'border-amber-300 bg-amber-100/80 text-stone-900 font-semibold'
                          : 'border-stone-200 bg-white text-stone-700'
                      }`}
                    >
                      <span>
                        {entry.userName}
                        {isMe ? ' (vous)' : ''}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-amber-500">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`h-3 w-3 ${
                              entry.score >= s ? 'fill-amber-400 text-amber-500' : 'text-stone-200'
                            }`}
                          />
                        ))}
                      </span>
                      <span className="text-[11px] font-bold text-stone-600">
                        {entry.score}/5
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Grille Ingrédients + Étapes */}
          <div className="mt-8 grid gap-6 sm:gap-8 lg:grid-cols-12">
            {/* Colonne gauche : Ustensiles, Ingrédients, Nutrition, Allergènes */}
            <section className="min-w-0 lg:col-span-5 space-y-6">
              {recipe.utensils && recipe.utensils.length > 0 && (
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-600">
                    Mes ustensiles
                  </h2>
                  <p className="text-sm text-stone-700 leading-relaxed">
                    {recipe.utensils.join(', ')}
                  </p>
                </div>
              )}

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-stone-900">
                    Ingrédients ({recipe.ingredients.length})
                  </h2>
                  {targetServings !== recipe.servings && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      Ajusté ×{Math.round(multiplier * 100) / 100}
                    </span>
                  )}
                </div>

                {(() => {
                  const boxIngs = recipe.ingredients.filter((i) => !i.fromPantry);
                  const pantryIngs = recipe.ingredients.filter((i) => i.fromPantry);
                  const renderIng = (ing: (typeof recipe.ingredients)[number]) => {
                    const checked = !!checkedIngredients[ing.id];
                    const qty = scaleQuantity(ing.quantity, multiplier);
                    return (
                      <li key={ing.id}>
                        <button
                          type="button"
                          onClick={() => toggleIngredient(ing.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all ${
                            checked
                              ? 'border-stone-200 bg-stone-50 text-stone-400 line-through'
                              : 'border-stone-200/80 bg-white text-stone-800 hover:border-fresh-300 hover:bg-fresh-50/40'
                          }`}
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                              checked
                                ? 'border-fresh-600 bg-fresh-600 text-white'
                                : 'border-stone-300 bg-white'
                            }`}
                          >
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </span>
                          <span className="min-w-0 flex-1 flex items-baseline justify-between gap-2">
                            <span className="min-w-0 break-words">{ing.name}</span>
                            {(qty || ing.unit) && (
                              <span className="shrink-0 text-xs font-bold text-fresh-700">
                                {qty} {ing.unit}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  };

                  return (
                    <div className="space-y-4">
                      <ul className="space-y-2">{boxIngs.map(renderIng)}</ul>
                      {pantryIngs.length > 0 && (
                        <div>
                          <p className="mb-2 rounded-lg bg-fresh-600 px-3 py-1 text-xs font-bold text-white">
                            À ajouter vous-même
                          </p>
                          <ul className="space-y-2">{pantryIngs.map(renderIng)}</ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {recipe.nutrition && recipe.nutrition.length > 0 && (
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                  <h2 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-stone-600">
                    Valeurs nutritionnelles
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-stone-200 text-stone-500">
                          <th className="py-1 text-left font-semibold"></th>
                          <th className="py-1 text-right font-semibold">Par portion</th>
                          <th className="py-1 text-right font-semibold">Pour 100 g</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-200/60">
                        {recipe.nutrition.map((row, i) => (
                          <tr key={i}>
                            <td className="py-1.5 text-stone-700">{row.label}</td>
                            <td className="py-1.5 text-right font-semibold text-stone-900">
                              {row.perServing}
                            </td>
                            <td className="py-1.5 text-right text-stone-600">{row.per100g}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {recipe.allergens && (
                <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                  <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-stone-600">
                    Allergènes
                  </h2>
                  <p className="break-words text-xs leading-relaxed text-stone-600">{recipe.allergens}</p>
                </div>
              )}
            </section>

            {/* Étapes cochables */}
            <section className="min-w-0 lg:col-span-7">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-stone-900">
                  Préparation ({completedStepsCount}/
                  {recipe.stepDetails?.length || recipe.steps.length})
                </h2>
                {(completedStepsCount > 0 || Object.values(checkedIngredients).some(Boolean)) && (
                  <button
                    type="button"
                    onClick={resetProgress}
                    className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Réinitialiser
                  </button>
                )}
              </div>

              <ol className="space-y-3">
                {(recipe.stepDetails && recipe.stepDetails.length > 0
                  ? recipe.stepDetails
                  : recipe.steps.map((s) => ({ title: undefined, bullets: [s], chefTip: undefined }))
                ).map((step, idx) => {
                  const done = !!checkedSteps[idx];
                  return (
                    <li key={idx}>
                      <button
                        type="button"
                        onClick={() => toggleStep(idx)}
                        className={`flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition-all ${
                          done
                            ? 'border-fresh-200 bg-fresh-50/50 text-stone-500'
                            : 'border-stone-200/80 bg-white text-stone-800 hover:border-fresh-300 shadow-xs'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                            done
                              ? 'bg-fresh-600 text-white'
                              : 'bg-fresh-100 text-fresh-800'
                          }`}
                        >
                          {done ? <Check className="h-4 w-4" /> : idx + 1}
                        </span>
                        <div className={`min-w-0 flex-1 space-y-2 break-words ${done ? 'line-through opacity-75' : ''}`}>
                          {step.title && (
                            <h3 className="font-display text-sm font-bold text-stone-900 sm:text-base">
                              {step.title}
                            </h3>
                          )}
                          <ul className="space-y-1.5 text-sm leading-relaxed sm:text-[15px]">
                            {step.bullets.map((b, bIdx) => (
                              <li key={bIdx} className="flex items-start gap-2">
                                {step.bullets.length > 1 && (
                                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-fresh-500" />
                                )}
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                          {step.chefTip && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                              <strong className="font-bold">L’astuce du chef :</strong>{' '}
                              {step.chefTip}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {recipe.notes && (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
                  <strong className="font-semibold">Note / Astuce :</strong> {recipe.notes}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Mode Cuisine pas à pas */}
      {cookingModeOpen && (
        <CookingModeModal
          recipe={recipe}
          servingsMultiplier={multiplier}
          checkedIngredients={checkedIngredients}
          onToggleIngredient={toggleIngredient}
          checkedSteps={checkedSteps}
          onToggleStep={toggleStep}
          onClose={() => setCookingModeOpen(false)}
        />
      )}

      {/* Lightbox photo */}
      {lightboxOpen && currentImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label="Fermer l'image"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={currentImage}
            alt={recipe.title}
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
