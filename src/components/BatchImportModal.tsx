import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  CopyCheck,
  FileStack,
  FolderOpen,
  Images,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { Recipe } from '../types/recipe';
import { compressImageFile } from '../utils/image';
import {
  extractRecipeWithGeminiVision,
  formatStepSummary,
  ParsedRecipeDraft,
} from '../utils/ocrParser';

interface BatchImportModalProps {
  existingRecipes: Recipe[];
  geminiApiKey: string;
  onImportRecipe: (recipe: Recipe) => Promise<void> | void;
  onClose: () => void;
}

type PairingMode = 'alternating' | 'two-stacks' | 'back-only';

type PairStatus =
  | 'pending'
  | 'processing'
  | 'imported'
  | 'duplicate'
  | 'error';

interface BatchPair {
  id: string;
  index: number;
  frontFile?: File;
  backFile?: File;
  status: PairStatus;
  recipeTitle?: string;
  duplicateOf?: string;
  parsedDraft?: ParsedRecipeDraft;
  error?: string;
}

interface DuplicateEntry {
  label: string;
  ingredientNames: string[];
}

type DuplicateIndex = Map<string, DuplicateEntry[]>;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeIngredientNames(ingredients?: { name: string }[]): string[] {
  if (!ingredients) return [];
  const seen = new Set<string>();
  for (const ing of ingredients) {
    const normalized = normalizeText(ing.name);
    if (normalized) seen.add(normalized);
  }
  return Array.from(seen);
}

function ingredientsMatch(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  let matches = 0;
  for (const ingA of a) {
    const found = b.some(
      (ingB) => ingA === ingB || ingA.includes(ingB) || ingB.includes(ingA)
    );
    if (found) matches++;
  }
  return matches / Math.min(a.length, b.length) >= 0.5;
}

function addRecipeToDuplicateIndex(
  index: DuplicateIndex,
  recipe: Pick<Recipe, 'title' | 'ingredients'>
) {
  const titleKey = normalizeText(recipe.title);
  if (!titleKey) return;
  const entry: DuplicateEntry = {
    label: recipe.title,
    ingredientNames: normalizeIngredientNames(recipe.ingredients),
  };
  const existing = index.get(titleKey);
  if (existing) {
    existing.push(entry);
  } else {
    index.set(titleKey, [entry]);
  }
}

function buildDuplicateIndex(recipes: Recipe[]): DuplicateIndex {
  const index: DuplicateIndex = new Map();
  for (const r of recipes) {
    addRecipeToDuplicateIndex(index, r);
  }
  return index;
}

function findDuplicateMatch(
  index: DuplicateIndex,
  title?: string,
  ingredients?: { name: string }[]
): string | null {
  const titleKey = title ? normalizeText(title) : '';
  if (!titleKey) return null;
  const candidates = index.get(titleKey);
  if (!candidates || candidates.length === 0) return null;

  const candidateIngredients = normalizeIngredientNames(ingredients);
  for (const entry of candidates) {
    if (ingredientsMatch(candidateIngredients, entry.ingredientNames)) {
      return entry.label;
    }
  }
  return null;
}

function buildPairsFromFiles(
  files: File[],
  mode: PairingMode,
  swappedIndices: Set<number>
): BatchPair[] {
  const pairs: BatchPair[] = [];
  if (mode === 'back-only') {
    files.forEach((file, idx) => {
      pairs.push({
        id: `pair-${idx}-${file.name}`,
        index: idx,
        backFile: file,
        status: 'pending',
      });
    });
    return pairs;
  }

  if (mode === 'two-stacks') {
    const half = Math.ceil(files.length / 2);
    for (let i = 0; i < half; i++) {
      const a = files[i];
      const b = files[i + half];
      const swapped = swappedIndices.has(i);
      pairs.push({
        id: `pair-${i}-${a?.name ?? 'x'}-${b?.name ?? 'y'}`,
        index: i,
        frontFile: swapped ? b : a,
        backFile: swapped ? a : b,
        status: 'pending',
      });
    }
    return pairs;
  }

  // alternating: 0+1, 2+3, ...
  for (let i = 0; i < files.length; i += 2) {
    const pairIdx = i / 2;
    const a = files[i];
    const b = files[i + 1];
    const swapped = swappedIndices.has(pairIdx);
    pairs.push({
      id: `pair-${pairIdx}-${a?.name ?? 'x'}-${b?.name ?? 'y'}`,
      index: pairIdx,
      frontFile: swapped ? b : a,
      backFile: swapped ? a : b,
      status: 'pending',
    });
  }
  return pairs;
}

function draftToRecipe(draft: ParsedRecipeDraft, addReviewTag: boolean): Recipe {
  const now = new Date().toISOString();
  const cleanStepDetails = (draft.stepDetails ?? [])
    .map((s) => ({
      title: s.title?.trim() || undefined,
      bullets: s.bullets.map((b) => b.trim()).filter((b) => b.length > 0),
      chefTip: s.chefTip?.trim() || undefined,
    }))
    .filter((s) => s.bullets.length > 0 || !!s.title);

  const cleanSteps =
    cleanStepDetails.length > 0
      ? cleanStepDetails.map(formatStepSummary)
      : draft.steps.filter((s) => s.trim().length > 0);

  const baseTags = draft.tags ?? [];
  const tags = addReviewTag
    ? Array.from(new Set([...baseTags, 'à-vérifier']))
    : baseTags;

  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: (draft.title ?? '').trim(),
    subtitle: draft.subtitle?.trim() || undefined,
    prepTimeMinutes: Math.max(1, Number(draft.prepTimeMinutes) || 25),
    prepTimeRange: draft.prepTimeRange?.trim() || undefined,
    servings: Math.max(1, Number(draft.servings) || 2),
    tags,
    utensils: draft.utensils && draft.utensils.length > 0 ? draft.utensils : undefined,
    ingredients: draft.ingredients.filter((i) => i.name.trim().length > 0),
    steps: cleanSteps,
    stepDetails: cleanStepDetails.length > 0 ? cleanStepDetails : undefined,
    nutrition: draft.nutrition && draft.nutrition.length > 0 ? draft.nutrition : undefined,
    allergens: draft.allergens?.trim() || undefined,
    notes: draft.notes?.trim() || undefined,
    isWeekly: false,
    imageFront: draft.dishImage,
    imageBack: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function isQuotaOrTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|500|503)\b|quota|rate|resource_exhausted|unavailable|overloaded|network|timeout/i.test(
    msg
  );
}

async function extractWithBackoff(
  apiKey: string,
  frontDataUrl?: string,
  backDataUrl?: string,
  shouldStop?: () => boolean
): Promise<ParsedRecipeDraft> {
  const delays = [4000, 12000, 25000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (shouldStop?.()) {
      throw new Error('Import mis en pause.');
    }
    try {
      return await extractRecipeWithGeminiVision(apiKey, frontDataUrl, backDataUrl);
    } catch (err) {
      lastError = err;
      if (attempt < delays.length && isQuotaOrTransientError(err)) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Erreur Gemini Vision.');
}

const FileThumb: React.FC<{ file?: File; label: string }> = ({ file, label }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file || !url) {
    return (
      <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-[10px] font-semibold text-stone-400">
        {label} absent
      </div>
    );
  }

  return (
    <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
      <img src={url} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 py-0.5 text-[9px] font-bold text-white">
        {label}
      </span>
    </div>
  );
};

export const BatchImportModal: React.FC<BatchImportModalProps> = ({
  existingRecipes,
  geminiApiKey,
  onImportRecipe,
  onClose,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [pairingMode, setPairingMode] = useState<PairingMode>('alternating');
  const [swappedIndices, setSwappedIndices] = useState<Set<number>>(new Set());
  const [pairs, setPairs] = useState<BatchPair[]>([]);

  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [addReviewTag, setAddReviewTag] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [savingPairId, setSavingPairId] = useState<string | null>(null);

  const stopRequestedRef = useRef(false);
  const duplicateIndexRef = useRef(buildDuplicateIndex(existingRecipes));
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    duplicateIndexRef.current = buildDuplicateIndex(existingRecipes);
  }, [existingRecipes]);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  // Reconstruit les paires uniquement quand les fichiers ou le mode changent
  useEffect(() => {
    setPairs(buildPairsFromFiles(files, pairingMode, swappedIndices));
  }, [files, pairingMode, swappedIndices]);

  const handleAddFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const imageFiles = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name))
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' })
      );
    setFiles(imageFiles);
    setSwappedIndices(new Set());
  };

  const handleRemoveFileAt = (fileIndex: number) => {
    if (isRunning) return;
    setFiles((prev) => prev.filter((_, i) => i !== fileIndex));
    setSwappedIndices(new Set());
  };

  const handleSwapPair = (pairIdx: number) => {
    if (isRunning) return;
    setSwappedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(pairIdx)) next.delete(pairIdx);
      else next.add(pairIdx);
      return next;
    });
  };

  const handleSwapAll = () => {
    if (isRunning) return;
    setSwappedIndices((prev) => {
      const next = new Set<number>();
      for (const p of pairs) {
        if (!prev.has(p.index)) next.add(p.index);
      }
      return next;
    });
  };

  const stats = useMemo(() => {
    let pending = 0;
    let processing = 0;
    let imported = 0;
    let duplicate = 0;
    let error = 0;
    for (const p of pairs) {
      if (p.status === 'pending') pending++;
      else if (p.status === 'processing') processing++;
      else if (p.status === 'imported') imported++;
      else if (p.status === 'duplicate') duplicate++;
      else if (p.status === 'error') error++;
    }
    return {
      total: pairs.length,
      done: imported + duplicate + error,
      pending,
      processing,
      imported,
      duplicate,
      error,
    };
  }, [pairs]);

  const runQueue = async (targetStatuses: PairStatus[], specificPairId?: string) => {
    if (isRunning || pairs.length === 0) return;
    stopRequestedRef.current = false;
    setIsRunning(true);

    const queue = pairs
      .filter((p) =>
        specificPairId ? p.id === specificPairId : targetStatuses.includes(p.status)
      )
      .map((p) => p.id);

    const updatePair = (id: string, patch: Partial<BatchPair>) => {
      setPairs((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    };

    const worker = async () => {
      while (queue.length > 0 && !stopRequestedRef.current) {
        const pairId = queue.shift();
        if (!pairId) break;

        const pair = pairs.find((p) => p.id === pairId);
        if (!pair) continue;

        updatePair(pairId, { status: 'processing', error: undefined });

        try {
          const frontDataUrl = pair.frontFile
            ? await compressImageFile(pair.frontFile, 1200, 0.78)
            : undefined;
          const backDataUrl = pair.backFile
            ? await compressImageFile(pair.backFile, 1200, 0.78)
            : undefined;

          if (!frontDataUrl && !backDataUrl) {
            updatePair(pairId, { status: 'error', error: 'Aucune image valide.' });
            continue;
          }

          const draft = await extractWithBackoff(
            geminiApiKey,
            frontDataUrl,
            backDataUrl,
            () => stopRequestedRef.current
          );

          if (!draft.title || !draft.title.trim()) {
            updatePair(pairId, {
              status: 'error',
              error: 'Titre introuvable sur la fiche.',
            });
            continue;
          }

          if (skipDuplicates) {
            const match = findDuplicateMatch(
              duplicateIndexRef.current,
              draft.title,
              draft.ingredients
            );
            if (match) {
              updatePair(pairId, {
                status: 'duplicate',
                recipeTitle: draft.title,
                duplicateOf: match,
                parsedDraft: draft,
              });
              continue;
            }
          }

          const recipe = draftToRecipe(draft, addReviewTag);

          // Mise à jour immédiate de l'index anti-doublon pour les paires suivantes
          addRecipeToDuplicateIndex(duplicateIndexRef.current, recipe);

          await onImportRecipe(recipe);

          updatePair(pairId, {
            status: 'imported',
            recipeTitle: recipe.title,
            duplicateOf: undefined,
            parsedDraft: undefined,
          });
        } catch (err) {
          if (stopRequestedRef.current) {
            updatePair(pairId, { status: 'pending' });
          } else {
            updatePair(pairId, {
              status: 'error',
              error: err instanceof Error ? err.message : 'Erreur inconnue.',
            });
          }
        }
      }
    };

    // Concurrence de 2 workers pour ménager les quotas Gemini / Firebase AI Logic
    const concurrency = Math.min(2, Math.max(1, queue.length));
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    setIsRunning(false);
  };

  const handlePause = () => {
    stopRequestedRef.current = true;
  };

  const handleKeepDuplicate = async (pair: BatchPair) => {
    if (isRunning || savingPairId || !pair.parsedDraft) return;
    setSavingPairId(pair.id);
    try {
      const recipe = draftToRecipe(pair.parsedDraft, addReviewTag);
      addRecipeToDuplicateIndex(duplicateIndexRef.current, recipe);
      await onImportRecipe(recipe);
      setPairs((prev) =>
        prev.map((p) =>
          p.id === pair.id
            ? {
                ...p,
                status: 'imported',
                recipeTitle: recipe.title,
                duplicateOf: undefined,
                parsedDraft: undefined,
                error: undefined,
              }
            : p
        )
      );
    } catch (err) {
      setPairs((prev) =>
        prev.map((p) =>
          p.id === pair.id
            ? {
                ...p,
                status: 'error',
                error:
                  err instanceof Error
                    ? err.message
                    : 'Impossible de sauvegarder la fiche.',
              }
            : p
        )
      );
    } finally {
      setSavingPairId(null);
    }
  };

  const hasOddCount =
    pairingMode !== 'back-only' && files.length > 0 && files.length % 2 !== 0;
  const progressPct =
    stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-stone-900 sm:text-xl">
              <FileStack className="h-5 w-5 text-fresh-600 shrink-0" />
              <span className="truncate">Import en masse (Gemini Vision)</span>
            </h2>
            <p className="text-xs text-stone-500">
              Sélectionne tes scans JPEG : appairage auto, détection des doublons et sauvegarde au fil de l’eau.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isRunning) handlePause();
              onClose();
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            aria-label="Fermer l’import en masse"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 sm:p-6">
          {/* Sélection des fichiers */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/70 px-4 py-4 text-sm font-bold text-stone-700 transition-colors hover:border-fresh-400 hover:bg-fresh-50/50">
              <Images className="h-5 w-5 text-fresh-600" />
              <span>Choisir des images (JPEG/PNG)</span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={isRunning}
                onChange={(e) => handleAddFiles(e.target.files)}
                className="hidden"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/70 px-4 py-4 text-sm font-bold text-stone-700 transition-colors hover:border-fresh-400 hover:bg-fresh-50/50">
              <FolderOpen className="h-5 w-5 text-fresh-600" />
              <span>Choisir un dossier entier</span>
              <input
                ref={folderInputRef}
                type="file"
                accept="image/*"
                multiple
                disabled={isRunning}
                onChange={(e) => handleAddFiles(e.target.files)}
                className="hidden"
              />
            </label>
          </div>

          {/* Options d'appairage & doublons */}
          {files.length > 0 && (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-stone-600">Appairage :</span>
                  {(
                    [
                      { id: 'alternating', label: 'Alterné (Recto, Verso…)' },
                      { id: 'two-stacks', label: '2 piles (Rectos puis Versos)' },
                      { id: 'back-only', label: '1 image = 1 recette' },
                    ] as { id: PairingMode; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isRunning}
                      onClick={() => {
                        setPairingMode(opt.id);
                        setSwappedIndices(new Set());
                      }}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                        pairingMode === opt.id
                          ? 'bg-fresh-600 text-white'
                          : 'bg-white text-stone-700 border border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {pairingMode !== 'back-only' && (
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={handleSwapAll}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                    Inverser tout Recto/Verso
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    disabled={isRunning}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="h-4 w-4 rounded border-stone-300 text-fresh-600 focus:ring-fresh-500"
                  />
                  <CopyCheck className="h-4 w-4 text-fresh-600" />
                  Ignorer les doublons (par titre et ingrédients)
                </label>

                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700">
                  <input
                    type="checkbox"
                    checked={addReviewTag}
                    disabled={isRunning}
                    onChange={(e) => setAddReviewTag(e.target.checked)}
                    className="h-4 w-4 rounded border-stone-300 text-fresh-600 focus:ring-fresh-500"
                  />
                  Ajouter le tag « à-vérifier » aux fiches importées
                </label>
              </div>

              {hasOddCount && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    Nombre impair d’images ({files.length}) : vérifie la dernière paire ou supprime une image en trop ci-dessous.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Barre de progression & stats */}
          {pairs.length > 0 && (
            <div className="rounded-2xl border border-stone-200 bg-white p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                <span className="text-stone-700">
                  {stats.done} / {stats.total} traitée{stats.total > 1 ? 's' : ''} ({progressPct}%)
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-fresh-700">{stats.imported} importée{stats.imported > 1 ? 's' : ''}</span>
                  <span className="text-amber-700">{stats.duplicate} doublon{stats.duplicate > 1 ? 's' : ''}</span>
                  {stats.error > 0 && (
                    <span className="text-red-600">{stats.error} erreur{stats.error > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-fresh-600 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Liste des paires */}
          {pairs.length > 0 && (
            <div className="space-y-2">
              {pairs.map((pair) => {
                const frontIdx = pair.frontFile ? files.indexOf(pair.frontFile) : -1;
                const backIdx = pair.backFile ? files.indexOf(pair.backFile) : -1;

                return (
                  <div
                    key={pair.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3 transition-colors ${
                      pair.status === 'imported'
                        ? 'border-fresh-200 bg-fresh-50/40'
                        : pair.status === 'duplicate'
                        ? 'border-amber-200 bg-amber-50/50'
                        : pair.status === 'error'
                        ? 'border-red-200 bg-red-50/50'
                        : pair.status === 'processing'
                        ? 'border-fresh-300 bg-fresh-50/70'
                        : 'border-stone-200 bg-white'
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="w-7 shrink-0 text-center text-xs font-bold text-stone-400">
                        #{pair.index + 1}
                      </span>

                      {pairingMode !== 'back-only' && (
                        <FileThumb file={pair.frontFile} label="Recto" />
                      )}
                      <FileThumb file={pair.backFile} label="Verso" />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-stone-800">
                          {pair.recipeTitle
                            ? pair.recipeTitle
                            : [pair.frontFile?.name, pair.backFile?.name]
                                .filter(Boolean)
                                .join(' + ')}
                        </p>
                        <p className="truncate text-[11px] text-stone-500">
                          {pair.status === 'pending' && 'En attente'}
                          {pair.status === 'processing' && 'Analyse Gemini & recadrage…'}
                          {pair.status === 'imported' && 'Importée dans le carnet'}
                          {pair.status === 'duplicate' &&
                            `Doublon ignoré (déjà présente : ${pair.duplicateOf})`}
                          {pair.status === 'error' && (pair.error || 'Erreur d’extraction')}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {pair.status === 'processing' && (
                        <Loader2 className="h-4 w-4 animate-spin text-fresh-600" />
                      )}
                      {pair.status === 'imported' && (
                        <CheckCircle2 className="h-4 w-4 text-fresh-600" />
                      )}
                      {pair.status === 'duplicate' && (
                        <>
                          {pair.parsedDraft && (
                            <button
                              type="button"
                              disabled={isRunning || savingPairId === pair.id}
                              onClick={() => handleKeepDuplicate(pair)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingPairId === pair.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              Conserver malgré doublon
                            </button>
                          )}
                          <CopyCheck className="h-4 w-4 text-amber-600" />
                        </>
                      )}
                      {pair.status === 'error' && (
                        <>
                          {!isRunning && (
                            <button
                              type="button"
                              onClick={() => runQueue(['error'], pair.id)}
                              title="Relancer cette fiche"
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Relancer
                            </button>
                          )}
                          <XCircle className="h-4 w-4 text-red-600" />
                        </>
                      )}

                      {!isRunning && pair.status === 'pending' && pairingMode !== 'back-only' && (
                        <button
                          type="button"
                          onClick={() => handleSwapPair(pair.index)}
                          title="Inverser Recto / Verso"
                          className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {!isRunning && pair.status === 'pending' && (
                        <>
                          {frontIdx >= 0 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveFileAt(frontIdx)}
                              title={`Retirer ${pair.frontFile?.name}`}
                              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-stone-500 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="inline h-3.5 w-3.5 mr-0.5" />
                              R
                            </button>
                          )}
                          {backIdx >= 0 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveFileAt(backIdx)}
                              title={`Retirer ${pair.backFile?.name}`}
                              className="rounded-lg px-2 py-1 text-[11px] font-semibold text-stone-500 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="inline h-3.5 w-3.5 mr-0.5" />
                              V
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3.5 sm:px-6">
          <div className="text-xs font-medium text-stone-500">
            {existingRecipes.length} recette{existingRecipes.length > 1 ? 's' : ''} déjà en base
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {stats.error > 0 && !isRunning && (
              <button
                type="button"
                onClick={() => runQueue(['error'])}
                className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Réessayer les erreurs ({stats.error})
              </button>
            )}

            {isRunning ? (
              <button
                type="button"
                onClick={handlePause}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-600"
              >
                <Pause className="h-4 w-4" />
                Pause
              </button>
            ) : (
              <button
                type="button"
                disabled={stats.pending === 0}
                onClick={() => runQueue(['pending'])}
                className="inline-flex items-center gap-1.5 rounded-xl bg-fresh-600 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-fresh-600/20 hover:bg-fresh-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stats.done > 0 && stats.pending > 0 ? (
                  <>
                    <Play className="h-4 w-4" />
                    Reprendre ({stats.pending})
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Lancer l’import ({stats.pending})
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
