import React, { useEffect, useState } from 'react';
import {
  X,
  Download,
  Upload,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Cloud,
  User,
  LayoutGrid,
  ExternalLink,
} from 'lucide-react';
import { Recipe, RecipeBookBackup, WeeklyPlan } from '../types/recipe';
import { downloadBackupJson } from '../utils/storage';

interface SettingsBackupModalProps {
  recipes: Recipe[];
  weeklyPlan: WeeklyPlan;
  geminiApiKey: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
  onOpenCloudModal: () => void;
  onSaveGeminiKey: (key: string) => void;
  onImportBackup: (backup: RecipeBookBackup, mode: 'merge' | 'replace') => void;
  onClose: () => void;
}

export const SettingsBackupModal: React.FC<SettingsBackupModalProps> = ({
  recipes,
  weeklyPlan,
  geminiApiKey,
  userEmail,
  userDisplayName,
  onOpenCloudModal,
  onSaveGeminiKey,
  onImportBackup,
  onClose,
}) => {
  const [keyInput, setKeyInput] = useState(geminiApiKey);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [showOtherApps, setShowOtherApps] = useState(false);

  useEffect(() => {
    if (!showOtherApps) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowOtherApps(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showOtherApps]);

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
        className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-3xl sm:pb-0"
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
          {/* Compte Cloud */}
          <section className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fresh-100 text-fresh-700">
                {userEmail ? <User className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-stone-900">
                  {userEmail ? userDisplayName || 'Compte Cloud actif' : 'Mode local (non connecté)'}
                </p>
                <p className="truncate text-xs text-stone-500">
                  {userEmail || 'Vos données sont enregistrées sur cet appareil.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenCloudModal();
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-700 hover:bg-stone-100"
            >
              <Cloud className="h-3.5 w-3.5 text-fresh-600" />
              {userEmail ? 'Gérer Cloud' : 'Connexion'}
            </button>
          </section>

          {/* Export / Import JSON */}
          <section className="rounded-2xl border border-stone-200 p-4 space-y-3">
            <h3 className="text-sm font-bold text-stone-900">
              Export / Import JSON
            </h3>
            <p className="text-xs text-stone-500">
              Vos recettes et votre planning hebdomadaire sont enregistrés localement ({recipes.length} recette{recipes.length > 1 ? 's' : ''}) et synchronisés avec le Cloud lorsque vous êtes connecté (les photos restent stockées sur votre appareil). Vous pouvez aussi exporter ou importer une sauvegarde JSON complète (incluant les photos).
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
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
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
              L’extraction IA passe par Firebase AI Logic (gratuit). Si vous préférez utiliser votre propre clé API Google Gemini, vous pouvez la renseigner ici (stockée uniquement dans votre navigateur).
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="AIzaSy…"
                className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2 text-xs text-stone-900 focus:border-fresh-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  onSaveGeminiKey(keyInput);
                  setFeedback({ type: 'ok', msg: 'Clé API enregistrée localement.' });
                }}
                className="shrink-0 rounded-xl bg-stone-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-stone-800"
              >
                Enregistrer
              </button>
            </div>
          </section>

          {/* Mes autres applications */}
          <section className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
            <div className="min-w-0">
              <p className="text-sm font-bold text-stone-900">Mes autres applications</p>
              <p className="text-xs text-stone-500">
                Accéder rapidement aux autres applications web (GitHub Pages).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowOtherApps(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-fresh-600 px-3 py-2 text-xs font-semibold text-white hover:bg-fresh-700"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Ouvrir
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

      {showOtherApps && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={(e) => {
            e.stopPropagation();
            setShowOtherApps(false);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold text-stone-900">
                <LayoutGrid className="h-5 w-5 text-fresh-600" />
                Mes autres applications
              </h3>
              <button
                type="button"
                onClick={() => setShowOtherApps(false)}
                className="rounded-xl p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-5">
              <p className="text-xs text-stone-500">
                Retrouvez toutes les autres applications hébergées sur GitHub Pages.
              </p>
              <div className="grid gap-2">
                {[
                  { name: "L'Affinoir", desc: "Charcuterie, salaisons & cave d'affinage", url: 'https://quentinv1.github.io/app-charcuterie/' },
                  { name: 'Pêche France', desc: 'Réglementation, mailles, cartes & carnet de prises', url: 'https://quentinv1.github.io/app-peche/' },
                  { name: 'App Voyage', desc: "Planificateur d'itinéraire, carte & carnet de voyage", url: 'https://quentinv1.github.io/app-voyage/' },
                  { name: 'Budget Prévisionnel', desc: 'Budget du foyer, provisions & projections', url: 'https://quentinv1.github.io/budget-previsionnel/' },
                  { name: 'Cave à vin', desc: 'Stock de bouteilles, apogée & dégustations', url: 'https://quentinv1.github.io/cave-a-vin/' },
                  { name: 'Checklist Valise', desc: 'Bagages, calculateur de poids & règles IATA', url: 'https://quentinv1.github.io/checklist-valise/' },
                  { name: 'Suivi Chasse', desc: 'Carnet de sorties, carte & album trophées', url: 'https://quentinv1.github.io/suivi-chasse/' },
                  { name: 'Travaux Maison', desc: 'Plan 2D/3D, courses, tâches & entretien', url: 'https://quentinv1.github.io/travaux-maison/' },
                ].map((app) => (
                  <a
                    key={app.url}
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 px-3.5 py-2.5 transition hover:border-fresh-300 hover:bg-fresh-50/40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-stone-900">{app.name}</div>
                      <div className="truncate text-xs text-stone-500">{app.desc}</div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-fresh-700">
                      Ouvrir <ExternalLink className="h-3.5 w-3.5" />
                    </span>
                  </a>
                ))}
              </div>
            </div>
            <div className="flex justify-end border-t border-stone-200 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowOtherApps(false)}
                className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
