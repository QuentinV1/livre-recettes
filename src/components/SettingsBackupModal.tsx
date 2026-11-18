import React, { useState } from 'react';
import {
  X,
  Download,
  Upload,
  KeyRound,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Recipe, RecipeBookBackup, WeeklyPlan } from '../types/recipe';
import { downloadBackupJson } from '../utils/storage';

interface SettingsBackupModalProps {
  recipes: Recipe[];
  weeklyPlan: WeeklyPlan;
  geminiApiKey: string;
  onSaveGeminiKey: (key: string) => void;
  onImportBackup: (backup: RecipeBookBackup, mode: 'merge' | 'replace') => void;
  onRestoreSamples: () => void;
  onClose: () => void;
}

export const SettingsBackupModal: React.FC<SettingsBackupModalProps> = ({
  recipes,
  weeklyPlan,
  geminiApiKey,
  onSaveGeminiKey,
  onImportBackup,
  onRestoreSamples,
  onClose,
}) => {
  const [keyInput, setKeyInput] = useState(geminiApiKey);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as RecipeBookBackup;
      if (!parsed || !Array.isArray(parsed.recipes)) {
        throw new Error('Fichier JSON invalide : liste de recettes manquante.');
      }
      onImportBackup(parsed, importMode);
      setFeedback({
        type: 'ok',
        msg: `${parsed.recipes.length} recette(s) importée(s) (${importMode === 'merge' ? 'fusion' : 'remplacement'}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        msg: err instanceof Error ? err.message : 'Impossible de lire ce fichier JSON.',
      });
    }
    e.target.value = '';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h2 className="font-display text-lg font-bold text-stone-900">
            Sauvegarde & Réglages
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="Fermer les réglages"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Export / Import JSON */}
          <section className="rounded-2xl border border-stone-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-stone-900">
              Export / Import JSON (Local-first)
            </h3>
            <p className="text-xs text-stone-500">
              Toutes vos recettes, photos et votre planning hebdomadaire sont stockés localement sur cet appareil ({recipes.length} recette{recipes.length > 1 ? 's' : ''}).
            </p>

            <button
              type="button"
              onClick={() => {
                downloadBackupJson(recipes, weeklyPlan);
                setFeedback({ type: 'ok', msg: 'Sauvegarde JSON téléchargée !' });
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-fresh-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-fresh-700"
            >
              <Download className="h-4 w-4" />
              Exporter mon livre (.json)
            </button>

            <div className="pt-2 border-t border-stone-100 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-stone-700">Mode d’import :</span>
                <div className="flex rounded-lg bg-stone-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => setImportMode('merge')}
                    className={`rounded-md px-2.5 py-1 font-semibold ${
                      importMode === 'merge' ? 'bg-white text-stone-900 shadow-2xs' : 'text-stone-500'
                    }`}
                  >
                    Fusionner
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('replace')}
                    className={`rounded-md px-2.5 py-1 font-semibold ${
                      importMode === 'replace' ? 'bg-white text-red-700 shadow-2xs' : 'text-stone-500'
                    }`}
                  >
                    Remplacer
                  </button>
                </div>
              </div>

              <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-800 hover:bg-stone-100">
                <Upload className="h-4 w-4 text-fresh-600" />
                Importer un fichier .json
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>
            </div>
          </section>

          {/* Clé API Gemini Vision optionnelle */}
          <section className="rounded-2xl border border-stone-200 p-4 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-stone-900">
              <KeyRound className="h-4 w-4 text-fresh-600" />
              API Gemini Vision (optionnel)
            </h3>
            <p className="text-xs text-stone-500">
              L’OCR Tesseract fonctionne sans clé. Si vous souhaitez une extraction ultra-précise depuis vos photos, vous pouvez renseigner une clé API Google Gemini (stockée uniquement dans votre navigateur).
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIzaSy…"
                className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-xs text-stone-900 focus:border-fresh-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  onSaveGeminiKey(keyInput);
                  setFeedback({ type: 'ok', msg: 'Clé API enregistrée localement.' });
                }}
                className="rounded-xl bg-stone-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-stone-800"
              >
                Enregistrer
              </button>
            </div>
          </section>

          {/* Exemples */}
          <section className="flex items-center justify-between rounded-2xl border border-stone-200 p-4">
            <div>
              <h3 className="text-sm font-bold text-stone-900">Recettes d’exemple</h3>
              <p className="text-xs text-stone-500">Ajouter les 4 recettes HelloFresh de démo manquantes.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                onRestoreSamples();
                setFeedback({ type: 'ok', msg: 'Recettes d’exemple ajoutées.' });
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurer
            </button>
          </section>

          {feedback && (
            <div
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold ${
                feedback.type === 'ok'
                  ? 'bg-fresh-50 text-fresh-800 border border-fresh-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {feedback.type === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              {feedback.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
