import React, { useEffect, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  ShoppingBasket,
  ChefHat,
  Check,
  Sparkles,
} from 'lucide-react';
import { Recipe } from '../types/recipe';

interface CookingModeModalProps {
  recipe: Recipe;
  servingsMultiplier: number;
  checkedIngredients: Record<string, boolean>;
  onToggleIngredient: (id: string) => void;
  checkedSteps: Record<number, boolean>;
  onToggleStep: (index: number) => void;
  onClose: () => void;
}

export function scaleQuantity(qty: string, multiplier: number): string {
  if (!qty || multiplier === 1) return qty;
  const num = parseFloat(qty.replace(',', '.'));
  if (Number.isNaN(num)) return qty;
  const scaled = Math.round(num * multiplier * 100) / 100;
  return Number.isInteger(scaled) ? String(scaled) : String(scaled).replace('.', ',');
}

export const CookingModeModal: React.FC<CookingModeModalProps> = ({
  recipe,
  servingsMultiplier,
  checkedIngredients,
  onToggleIngredient,
  checkedSteps,
  onToggleStep,
  onClose,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);

  const totalSteps = recipe.steps.length;
  const progress = totalSteps > 0 ? Math.round(((currentStep + 1) / totalSteps) * 100) : 100;

  // Empêche l'écran du téléphone/tablette de se mettre en veille pendant la cuisine (si supporté)
  useEffect(() => {
    let wakeLock: { release: () => Promise<void> } | null = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen');
        }
      } catch {
        // Ignorer silencieusement si non supporté ou refusé
      }
    };
    requestWakeLock();
    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, []);

  // Navigation clavier (flèches gauche/droite + Échap)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && currentStep < totalSteps - 1) setCurrentStep((s) => s + 1);
      if (e.key === 'ArrowLeft' && currentStep > 0) setCurrentStep((s) => s - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentStep, totalSteps, onClose]);

  const handleCompleteAndNext = () => {
    if (!checkedSteps[currentStep]) {
      onToggleStep(currentStep);
    }
    if (currentStep < totalSteps - 1) {
      setCurrentStep((s) => s + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-950 text-stone-50">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-stone-800 px-3 py-2.5 sm:px-6 sm:py-3">
        <div className="flex items-center gap-2.5 min-w-0 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fresh-600 text-white">
            <ChefHat className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-fresh-400 sm:text-xs">
              Mode Cuisine pas à pas
            </p>
            <h2 className="truncate text-sm font-bold text-white sm:text-base">{recipe.title}</h2>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowIngredients((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors sm:text-sm ${
              showIngredients
                ? 'bg-fresh-600 text-white'
                : 'bg-stone-800 text-stone-200 hover:bg-stone-700'
            }`}
          >
            <ShoppingBasket className="h-4 w-4" />
            <span className="hidden sm:inline">Ingrédients</span>
            <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[11px]">
              {recipe.ingredients.length}
            </span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-stone-800 text-stone-300 hover:bg-stone-700 hover:text-white"
            aria-label="Fermer le mode cuisine"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Barre de progression */}
      <div className="h-1.5 w-full bg-stone-800">
        <div
          className="h-full bg-fresh-500 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Corps principal */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Étape courante */}
        <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-6 sm:px-10 sm:py-8">
          {totalSteps === 0 ? (
            <p className="text-stone-400">Aucune étape enregistrée pour cette recette.</p>
          ) : (
            <div className="w-full min-w-0 max-w-2xl break-words">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-fresh-500/20 px-3.5 py-1.5 text-sm font-bold text-fresh-300">
                  Étape {currentStep + 1} sur {totalSteps}
                </span>

                <button
                  type="button"
                  onClick={() => onToggleStep(currentStep)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    checkedSteps[currentStep]
                      ? 'bg-fresh-600 text-white'
                      : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {checkedSteps[currentStep] ? 'Étape terminée' : 'Marquer faite'}
                </button>
              </div>

              {recipe.stepDetails?.[currentStep] ? (
                <div className="space-y-4">
                  {recipe.stepDetails[currentStep].title && (
                    <h3 className="font-display text-2xl font-bold text-fresh-300 sm:text-3xl">
                      {recipe.stepDetails[currentStep].title}
                    </h3>
                  )}
                  <ul className="space-y-3 text-lg leading-relaxed text-white sm:text-xl sm:leading-relaxed">
                    {recipe.stepDetails[currentStep].bullets.map((b, bIdx) => (
                      <li key={bIdx} className="flex items-start gap-3">
                        <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-fresh-400" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  {recipe.stepDetails[currentStep].chefTip && (
                    <div className="rounded-2xl border border-amber-500/40 bg-amber-950/50 p-4 text-sm text-amber-200">
                      <strong className="font-bold text-amber-300">L’astuce du chef :</strong>{' '}
                      {recipe.stepDetails[currentStep].chefTip}
                    </div>
                  )}
                </div>
              ) : (
                <p className="font-display text-2xl font-semibold leading-relaxed text-white sm:text-3xl sm:leading-relaxed">
                  {recipe.steps[currentStep]}
                </p>
              )}

              {/* Pastilles rapides d'étapes */}
              <div className="mt-10 flex flex-wrap items-center gap-2">
                {recipe.steps.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentStep(idx)}
                    className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold transition-all ${
                      idx === currentStep
                        ? 'bg-fresh-500 text-stone-950 scale-110 shadow-lg shadow-fresh-500/25'
                        : checkedSteps[idx]
                          ? 'bg-fresh-900/70 text-fresh-300 border border-fresh-700'
                          : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
                    }`}
                  >
                    {checkedSteps[idx] && idx !== currentStep ? <Check className="h-4 w-4" /> : idx + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Tiroir Ingrédients */}
        {showIngredients && (
          <aside className="absolute inset-y-0 right-0 z-10 w-full max-w-sm overflow-y-auto border-l border-stone-800 bg-stone-900 p-5 shadow-2xl sm:static">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-white">
                Ingrédients ({Math.round(recipe.servings * servingsMultiplier)} pers.)
              </h3>
              <button
                type="button"
                onClick={() => setShowIngredients(false)}
                className="rounded-lg p-1 text-stone-400 hover:bg-stone-800 hover:text-white sm:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="space-y-2">
              {recipe.ingredients.map((ing) => {
                const isChecked = !!checkedIngredients[ing.id];
                const qty = scaleQuantity(ing.quantity, servingsMultiplier);
                return (
                  <li key={ing.id}>
                    <button
                      type="button"
                      onClick={() => onToggleIngredient(ing.id)}
                      className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left text-sm transition-colors ${
                        isChecked
                          ? 'bg-stone-800/50 text-stone-500 line-through'
                          : 'bg-stone-800 text-stone-100 hover:bg-stone-700/80'
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          isChecked
                            ? 'border-fresh-500 bg-fresh-500 text-stone-950'
                            : 'border-stone-600'
                        }`}
                      >
                        {isChecked && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="flex-1">
                        {qty && (
                          <strong className="mr-1.5 font-semibold text-fresh-300">
                            {qty} {ing.unit}
                          </strong>
                        )}
                        {ing.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>

      {/* Footer Contrôles */}
      <footer className="flex items-center justify-between gap-2 border-t border-stone-800 bg-stone-900/90 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-4">
        <button
          type="button"
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          className="inline-flex items-center gap-1.5 rounded-xl bg-stone-800 px-3.5 py-2.5 text-sm font-semibold text-stone-200 transition-colors hover:bg-stone-700 disabled:opacity-40 disabled:pointer-events-none sm:gap-2 sm:px-4 sm:py-3"
        >
          <ChevronLeft className="h-5 w-5" />
          Précédent
        </button>

        {currentStep < totalSteps - 1 ? (
          <button
            type="button"
            onClick={handleCompleteAndNext}
            className="inline-flex items-center gap-1.5 rounded-xl bg-fresh-500 px-4 py-2.5 text-sm font-bold text-stone-950 shadow-lg shadow-fresh-500/20 transition-all hover:bg-fresh-400 sm:gap-2 sm:px-6 sm:py-3"
          >
            Étape suivante
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!checkedSteps[currentStep]) onToggleStep(currentStep);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-stone-950 shadow-lg transition-all hover:bg-amber-300 sm:gap-2 sm:px-6 sm:py-3"
          >
            <Sparkles className="h-5 w-5" />
            Bon appétit ! Terminer
          </button>
        )}
      </footer>
    </div>
  );
};
