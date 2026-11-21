import React, { useState } from 'react';
import {
  X,
  Upload,
  Camera,
  ScanText,
  Sparkles,
  Plus,
  Trash2,
  ClipboardPaste,
  Loader2,
  Image as ImageIcon,
  Check,
  AlertCircle,
} from 'lucide-react';
import {
  Ingredient,
  NutritionRow,
  Recipe,
  RecipeStep,
  SUGGESTED_TAGS,
} from '../types/recipe';
import { compressImageFile } from '../utils/image';
import {
  extractRecipeWithGeminiVision,
  extractRecipeWithTesseract,
  formatStepSummary,
  parseRecipeText,
} from '../utils/ocrParser';

interface RecipeFormModalProps {
  initialRecipe?: Recipe | null;
  geminiApiKey: string;
  onSave: (recipe: Recipe) => void;
  onClose: () => void;
}

function makeIngId(): string {
  return `ing-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const RecipeFormModal: React.FC<RecipeFormModalProps> = ({
  initialRecipe,
  geminiApiKey,
  onSave,
  onClose,
}) => {
  const isEditing = !!initialRecipe;

  const [recipeNumber, setRecipeNumber] = useState(initialRecipe?.recipeNumber ?? '');
  const [title, setTitle] = useState(initialRecipe?.title ?? '');
  const [subtitle, setSubtitle] = useState(initialRecipe?.subtitle ?? '');
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(initialRecipe?.prepTimeMinutes ?? 30);
  const [prepTimeRange, setPrepTimeRange] = useState(initialRecipe?.prepTimeRange ?? '');
  const [servings, setServings] = useState(initialRecipe?.servings ?? 2);
  const [tags, setTags] = useState<string[]>(initialRecipe?.tags ?? []);
  const [customTag, setCustomTag] = useState('');
  const [utensilsText, setUtensilsText] = useState(
    initialRecipe?.utensils?.join(', ') ?? ''
  );
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    initialRecipe?.ingredients.length
      ? initialRecipe.ingredients
      : [{ id: makeIngId(), quantity: '', unit: 'g', name: '', fromPantry: false }]
  );
  const [stepDetails, setStepDetails] = useState<RecipeStep[]>(() => {
    if (initialRecipe?.stepDetails && initialRecipe.stepDetails.length > 0) {
      return initialRecipe.stepDetails;
    }
    if (initialRecipe?.steps.length) {
      return initialRecipe.steps.map((s) => ({ bullets: [s] }));
    }
    return [{ title: '', bullets: [''], chefTip: '' }];
  });
  const [nutrition, setNutrition] = useState<NutritionRow[]>(
    initialRecipe?.nutrition ?? []
  );
  const [allergens, setAllergens] = useState(initialRecipe?.allergens ?? '');
  const [notes, setNotes] = useState(initialRecipe?.notes ?? '');
  const [isWeekly, setIsWeekly] = useState(initialRecipe?.isWeekly ?? false);
  const [imageFront, setImageFront] = useState<string | undefined>(initialRecipe?.imageFront);
  const [imageBack, setImageBack] = useState<string | undefined>(initialRecipe?.imageBack);

  // Assistant OCR / Import texte
  const [importTab, setImportTab] = useState<'ocr' | 'paste'>('ocr');
  const [pastedText, setPastedText] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrStatus, setOcrStatus] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [formError, setFormError] = useState('');

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    side: 'front' | 'back'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 1200, 0.78);
      if (side === 'front') setImageFront(compressed);
      else setImageBack(compressed);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Erreur lors de la compression image.');
    }
  };

  const applyDraft = (draft: ReturnType<typeof parseRecipeText>) => {
    if (draft.recipeNumber) setRecipeNumber(draft.recipeNumber);
    if (draft.title) setTitle(draft.title);
    if (draft.subtitle) setSubtitle(draft.subtitle);
    if (draft.prepTimeMinutes) setPrepTimeMinutes(draft.prepTimeMinutes);
    if (draft.prepTimeRange) setPrepTimeRange(draft.prepTimeRange);
    if (draft.servings) setServings(draft.servings);
    if (draft.tags && draft.tags.length > 0) {
      setTags((prev) => Array.from(new Set([...prev, ...draft.tags!])));
    }
    if (draft.utensils && draft.utensils.length > 0) {
      setUtensilsText(draft.utensils.join(', '));
    }
    if (draft.ingredients.length > 0) setIngredients(draft.ingredients);
    if (draft.stepDetails && draft.stepDetails.length > 0) {
      setStepDetails(draft.stepDetails);
    } else if (draft.steps.length > 0) {
      setStepDetails(draft.steps.map((s) => ({ bullets: [s] })));
    }
    if (draft.nutrition && draft.nutrition.length > 0) setNutrition(draft.nutrition);
    if (draft.allergens) setAllergens(draft.allergens);
    if (draft.notes) setNotes(draft.notes);
  };

  const handleRunTesseract = async () => {
    if (!imageBack && !imageFront) {
      setOcrError('Ajoutez d’abord au moins une photo (recto et/ou verso) pour lancer la lecture OCR.');
      return;
    }
    setOcrError('');
    setOcrLoading(true);
    setOcrStatus('Initialisation de Tesseract OCR…');
    try {
      const draft = await extractRecipeWithTesseract(imageFront, imageBack, (pct, label) => {
        setOcrStatus(`${label} (${pct}%)`);
      });
      if (draft.rawText) setPastedText(draft.rawText);
      applyDraft(draft);
      setOcrStatus('Fiche analysée et champs pré-remplis ! Vérifiez les données ci-dessous.');
    } catch {
      setOcrError(
        'OCR local indisponible (hors-ligne sans cache ou image illisible). Utilisez le parseur de texte collé ou la saisie manuelle.'
      );
      setImportTab('paste');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleRunGeminiVision = async () => {
    if (!imageBack && !imageFront) {
      setOcrError('Ajoutez au moins une photo (verso ou recto) à analyser.');
      return;
    }
    setOcrError('');
    setOcrLoading(true);
    setOcrStatus('Analyse intelligente de la fiche via Gemini Vision…');
    try {
      const draft = await extractRecipeWithGeminiVision(geminiApiKey, imageFront, imageBack);
      applyDraft(draft);
      setOcrStatus('Recette extraite avec succès !');
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Erreur Gemini Vision.');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleParsePasted = () => {
    if (!pastedText.trim()) return;
    setOcrError('');
    const draft = parseRecipeText(pastedText);
    applyDraft(draft);
    setOcrStatus('Texte analysé et champs pré-remplis !');
  };

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const clean = customTag.trim().toLowerCase().replace(/^#/, '');
    if (clean && !tags.includes(clean)) {
      setTags((prev) => [...prev, clean]);
    }
    setCustomTag('');
  };

  const updateIngredient = (
    id: string,
    field: keyof Ingredient,
    value: string | boolean
  ) => {
    setIngredients((prev) =>
      prev.map((ing) => (ing.id === id ? { ...ing, [field]: value } : ing))
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError('Le titre de la recette est obligatoire.');
      return;
    }

    const cleanIngredients = ingredients.filter((i) => i.name.trim().length > 0);
    const cleanStepDetails: RecipeStep[] = stepDetails
      .map((s) => ({
        title: s.title?.trim() || undefined,
        bullets: s.bullets.map((b) => b.trim()).filter((b) => b.length > 0),
        chefTip: s.chefTip?.trim() || undefined,
      }))
      .filter((s) => s.bullets.length > 0 || !!s.title);
    const cleanSteps = cleanStepDetails.map(formatStepSummary);
    const cleanUtensils = utensilsText
      .split(/[,;]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    const cleanNutrition = nutrition.filter(
      (n) => n.label.trim().length > 0 && (n.perServing.trim() || n.per100g.trim())
    );

    const now = new Date().toISOString();
    const saved: Recipe = {
      id: initialRecipe?.id ?? `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      recipeNumber: recipeNumber.trim() || undefined,
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      prepTimeMinutes: Math.max(1, Number(prepTimeMinutes) || 20),
      prepTimeRange: prepTimeRange.trim() || undefined,
      servings: Math.max(1, Number(servings) || 2),
      tags,
      utensils: cleanUtensils.length > 0 ? cleanUtensils : undefined,
      ingredients: cleanIngredients,
      steps: cleanSteps,
      stepDetails: cleanStepDetails.length > 0 ? cleanStepDetails : undefined,
      nutrition: cleanNutrition.length > 0 ? cleanNutrition : undefined,
      allergens: allergens.trim() || undefined,
      notes: notes.trim() || undefined,
      isWeekly,
      imageFront,
      imageBack,
      createdAt: initialRecipe?.createdAt ?? now,
      updatedAt: now,
    };

    onSave(saved);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4 sm:px-6">
          <h2 className="font-display text-lg font-bold text-stone-900 sm:text-xl">
            {isEditing ? 'Modifier la recette' : 'Nouvelle recette HelloFresh'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            aria-label="Fermer le formulaire"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-6 sm:p-6">
          {/* Photos Recto & Verso */}
          <section className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
            <h3 className="mb-3 text-sm font-bold text-stone-800 flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-fresh-600" />
              Photos de la fiche (compression automatique)
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Recto */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-stone-600">
                  Recto — Photo du plat
                </label>
                {imageFront ? (
                  <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-stone-200 bg-white">
                    <img src={imageFront} alt="Recto" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImageFront(undefined)}
                      className="absolute right-2 top-2 rounded-lg bg-black/65 px-2 py-1 text-xs font-semibold text-white hover:bg-black/80"
                    >
                      Retirer
                    </button>
                  </div>
                ) : (
                  <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 bg-white p-3 text-stone-500">
                    <span className="text-xs font-medium text-stone-500">Photo recto du plat</span>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700 transition-colors hover:border-fresh-400 hover:bg-fresh-50 hover:text-fresh-700">
                        <Upload className="h-3.5 w-3.5" />
                        Importer
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e, 'front')}
                          className="hidden"
                        />
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-fresh-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-fresh-700">
                        <Camera className="h-3.5 w-3.5" />
                        Prendre photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleImageUpload(e, 'front')}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Verso */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-stone-600">
                  Verso — Fiche recette (texte)
                </label>
                {imageBack ? (
                  <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-stone-200 bg-white">
                    <img src={imageBack} alt="Verso" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImageBack(undefined)}
                      className="absolute right-2 top-2 rounded-lg bg-black/65 px-2 py-1 text-xs font-semibold text-white hover:bg-black/80"
                    >
                      Retirer
                    </button>
                  </div>
                ) : (
                  <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 bg-white p-3 text-stone-500">
                    <span className="text-xs font-medium text-stone-500">Photo verso de la fiche</span>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700 transition-colors hover:border-fresh-400 hover:bg-fresh-50 hover:text-fresh-700">
                        <Upload className="h-3.5 w-3.5" />
                        Importer
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e, 'back')}
                          className="hidden"
                        />
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-fresh-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-fresh-700">
                        <Camera className="h-3.5 w-3.5" />
                        Prendre photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleImageUpload(e, 'back')}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Assistant Extraction OCR / Texte */}
            <div className="mt-4 rounded-xl border border-fresh-200 bg-fresh-50/50 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-fresh-800">
                  Assistant de pré-remplissage
                </span>
                <div className="flex rounded-lg bg-white p-0.5 border border-stone-200">
                  <button
                    type="button"
                    onClick={() => setImportTab('ocr')}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      importTab === 'ocr' ? 'bg-fresh-600 text-white' : 'text-stone-600'
                    }`}
                  >
                    OCR Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportTab('paste')}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      importTab === 'paste' ? 'bg-fresh-600 text-white' : 'text-stone-600'
                    }`}
                  >
                    Coller texte
                  </button>
                </div>
              </div>

              {importTab === 'ocr' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={ocrLoading}
                    onClick={handleRunTesseract}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-stone-800 border border-stone-300 shadow-xs hover:bg-stone-50 disabled:opacity-50"
                  >
                    {ocrLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-fresh-600" />
                    ) : (
                      <ScanText className="h-4 w-4 text-fresh-600" />
                    )}
                    Extraire via OCR local (Tesseract)
                  </button>

                  <button
                    type="button"
                    disabled={ocrLoading}
                    onClick={handleRunGeminiVision}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-fresh-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-fresh-700 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    Extraire via Gemini Vision
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Collez ici le texte d'une fiche HelloFresh (titre, 25 min, Ingrédients, Étapes 1. 2. 3.)…"
                    className="w-full rounded-xl border border-stone-300 bg-white p-2.5 text-xs text-stone-800 focus:border-fresh-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleParsePasted}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-fresh-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-fresh-700"
                  >
                    <ClipboardPaste className="h-4 w-4" />
                    Analyser & pré-remplir
                  </button>
                </div>
              )}

              {ocrStatus && !ocrError && (
                <p className="mt-2 text-xs font-medium text-fresh-800">{ocrStatus}</p>
              )}
              {ocrError && (
                <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {ocrError}
                </p>
              )}
            </div>
          </section>

          {/* Informations générales */}
          <section className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                Titre de la recette *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setFormError('');
                }}
                placeholder="Ex: Poulet rôti au miel & pommes grenaille"
                className="w-full rounded-xl border border-stone-300 px-3.5 py-2.5 text-sm font-medium text-stone-900 focus:border-fresh-500 focus:outline-none focus:ring-2 focus:ring-fresh-500/20"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                Sous-titre / Accompagnement
              </label>
              <input
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Ex: Avec haricots verts croquants à l'ail"
                className="w-full rounded-xl border border-stone-300 px-3.5 py-2 text-sm text-stone-800 focus:border-fresh-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                  Temps (min)
                </label>
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={prepTimeMinutes}
                  onChange={(e) => setPrepTimeMinutes(Number(e.target.value))}
                  className="w-full rounded-xl border border-stone-300 px-3.5 py-2 text-sm font-semibold text-stone-900 focus:border-fresh-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                  Intervalle (fiche)
                </label>
                <input
                  type="text"
                  value={prepTimeRange}
                  onChange={(e) => setPrepTimeRange(e.target.value)}
                  placeholder="Ex: 35 - 45 min"
                  className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-fresh-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                  Personnes (réf.)
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={servings}
                  onChange={(e) => setServings(Number(e.target.value))}
                  title="Nombre de personnes de référence pour les quantités d'ingrédients"
                  className="w-full rounded-xl border border-stone-300 px-3.5 py-2 text-sm font-semibold text-stone-900 focus:border-fresh-500 focus:outline-none"
                />
              </div>
              <div className="flex items-end">
                <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={isWeekly}
                    onChange={(e) => setIsWeekly(e.target.checked)}
                    className="h-4 w-4 rounded accent-fresh-600"
                  />
                  Semaine
                </label>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                  N° Fiche (optionnel)
                </label>
                <input
                  type="text"
                  value={recipeNumber}
                  onChange={(e) => setRecipeNumber(e.target.value)}
                  placeholder="Ex: Recette 244"
                  className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-fresh-500 focus:outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                  Mes ustensiles (séparés par des virgules)
                </label>
                <input
                  type="text"
                  value={utensilsText}
                  onChange={(e) => setUtensilsText(e.target.value)}
                  placeholder="Ex: Bol, sauteuse, passoire, râpe, casserole"
                  className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-fresh-500 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Tags */}
          <section>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-stone-600">
              Tags
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {Array.from(new Set([...SUGGESTED_TAGS, ...tags])).map((tag) => {
                const active = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-fresh-600 text-white'
                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                    }`}
                  >
                    {active && <Check className="h-3 w-3" />}
                    #{tag}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomTag();
                  }
                }}
                placeholder="Ajouter un tag personnalisé…"
                className="flex-1 rounded-xl border border-stone-300 px-3 py-1.5 text-xs text-stone-800 focus:border-fresh-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={addCustomTag}
                className="rounded-xl bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-700"
              >
                Ajouter
              </button>
            </div>
          </section>

          {/* Ingrédients */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                  Ingrédients (Box & À ajouter vous-même)
                </label>
                <p className="text-[11px] text-stone-500">
                  Quantités saisies pour {Math.max(1, Number(servings) || 2)} pers. de référence (recalculées automatiquement ensuite)
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setIngredients((prev) => [
                    ...prev,
                    { id: makeIngId(), quantity: '', unit: 'g', name: '', fromPantry: false },
                  ])
                }
                className="inline-flex items-center gap-1 text-xs font-bold text-fresh-700 hover:text-fresh-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter un ingrédient
              </button>
            </div>

            <div className="space-y-2">
              {ingredients.map((ing) => (
                <div key={ing.id} className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => updateIngredient(ing.id, 'fromPantry', !ing.fromPantry)}
                    title={
                      ing.fromPantry
                        ? 'À ajouter vous-même (cliquer pour passer en Box)'
                        : 'Dans la box (cliquer pour passer en À ajouter)'
                    }
                    className={`shrink-0 rounded-lg px-2 py-2 text-[11px] font-bold transition-colors ${
                      ing.fromPantry
                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                        : 'bg-fresh-100 text-fresh-800 hover:bg-fresh-200'
                    }`}
                  >
                    {ing.fromPantry ? 'Placard' : 'Box'}
                  </button>
                  <input
                    type="text"
                    value={ing.quantity}
                    onChange={(e) => updateIngredient(ing.id, 'quantity', e.target.value)}
                    placeholder="Qté"
                    className="w-14 rounded-xl border border-stone-300 px-2 py-2 text-xs font-semibold text-stone-900 focus:border-fresh-500 focus:outline-none sm:w-16"
                  />
                  <input
                    type="text"
                    value={ing.unit}
                    onChange={(e) => updateIngredient(ing.id, 'unit', e.target.value)}
                    placeholder="Unité"
                    className="w-16 rounded-xl border border-stone-300 px-2 py-2 text-xs text-stone-700 focus:border-fresh-500 focus:outline-none sm:w-24"
                  />
                  <input
                    type="text"
                    value={ing.name}
                    onChange={(e) => updateIngredient(ing.id, 'name', e.target.value)}
                    placeholder="Nom de l'ingrédient"
                    className="flex-1 min-w-0 rounded-xl border border-stone-300 px-3 py-2 text-xs text-stone-900 focus:border-fresh-500 focus:outline-none sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setIngredients((prev) =>
                        prev.length > 1 ? prev.filter((i) => i.id !== ing.id) : prev
                      )
                    }
                    className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Supprimer l'ingrédient"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Étapes structurées */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Étapes de préparation ({stepDetails.length})
              </label>
              <button
                type="button"
                onClick={() =>
                  setStepDetails((prev) => [...prev, { title: '', bullets: [''], chefTip: '' }])
                }
                className="inline-flex items-center gap-1 text-xs font-bold text-fresh-700 hover:text-fresh-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter une étape
              </button>
            </div>

            <div className="space-y-3">
              {stepDetails.map((step, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-stone-200 bg-stone-50/60 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fresh-600 text-xs font-bold text-white">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={step.title ?? ''}
                      onChange={(e) =>
                        setStepDetails((prev) =>
                          prev.map((s, i) => (i === idx ? { ...s, title: e.target.value } : s))
                        )
                      }
                      placeholder={`Titre de l'étape ${idx + 1} (ex: Chop, chop, chop)`}
                      className="flex-1 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-900 focus:border-fresh-500 focus:outline-none sm:text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setStepDetails((prev) =>
                          prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev
                        )
                      }
                      className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Supprimer l'étape"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <textarea
                    rows={3}
                    value={step.bullets.join('\n')}
                    onChange={(e) =>
                      setStepDetails((prev) =>
                        prev.map((s, i) =>
                          i === idx ? { ...s, bullets: e.target.value.split('\n') } : s
                        )
                      )
                    }
                    placeholder="Sous-étapes (une puce par ligne)…"
                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs leading-relaxed text-stone-900 focus:border-fresh-500 focus:outline-none sm:text-sm"
                  />

                  <input
                    type="text"
                    value={step.chefTip ?? ''}
                    onChange={(e) =>
                      setStepDetails((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, chefTip: e.target.value } : s))
                      )
                    }
                    placeholder="Astuce du chef pour cette étape (optionnel)…"
                    className="w-full rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-1.5 text-xs text-amber-950 placeholder:text-amber-700/60 focus:border-amber-400 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Valeurs nutritionnelles & Allergènes */}
          <section className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50/60 p-3.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Valeurs nutritionnelles ({nutrition.length})
              </label>
              <button
                type="button"
                onClick={() =>
                  setNutrition((prev) => [
                    ...prev,
                    { label: '', perServing: '', per100g: '' },
                  ])
                }
                className="inline-flex items-center gap-1 text-xs font-bold text-fresh-700 hover:text-fresh-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter une ligne
              </button>
            </div>

            {nutrition.length > 0 && (
              <div className="space-y-1.5">
                {nutrition.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) =>
                        setNutrition((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r))
                        )
                      }
                      placeholder="Nutriment"
                      className="col-span-5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-800"
                    />
                    <input
                      type="text"
                      value={row.perServing}
                      onChange={(e) =>
                        setNutrition((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, perServing: e.target.value } : r
                          )
                        )
                      }
                      placeholder="Par portion"
                      className="col-span-3 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800"
                    />
                    <input
                      type="text"
                      value={row.per100g}
                      onChange={(e) =>
                        setNutrition((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, per100g: e.target.value } : r))
                        )
                      }
                      placeholder="Pour 100 g"
                      className="col-span-3 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-stone-800"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setNutrition((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 flex justify-center rounded-lg p-1 text-stone-400 hover:text-red-600"
                      aria-label="Supprimer ligne nutrition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
                Allergènes (optionnel)
              </label>
              <input
                type="text"
                value={allergens}
                onChange={(e) => setAllergens(e.target.value)}
                placeholder="Ex: Soja, sésame, blé (gluten)…"
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs text-stone-800 focus:border-fresh-500 focus:outline-none"
              />
            </div>
          </section>

          {/* Notes */}
          <section>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600">
              Notes / Astuces (optionnel)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Déglacer avec un trait de citron en fin de cuisson"
              className="w-full rounded-xl border border-stone-300 px-3.5 py-2 text-sm text-stone-800 focus:border-fresh-500 focus:outline-none"
            />
          </section>

          {formError && (
            <p className="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">
              {formError}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-stone-200 bg-stone-50 px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-100"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-xl bg-fresh-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-fresh-700"
          >
            {isEditing ? 'Enregistrer les modifications' : 'Ajouter au livre'}
          </button>
        </div>
      </div>
    </div>
  );
};
