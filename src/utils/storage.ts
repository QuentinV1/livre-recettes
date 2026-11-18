import { Recipe, RecipeBookBackup, WeeklyPlan, createEmptyWeeklyPlan } from '../types/recipe';
import { SAMPLE_RECIPES } from '../data/sampleRecipes';

const DB_NAME = 'carnet-hellofresh-db';
const DB_VERSION = 1;
const STORE_RECIPES = 'recipes';

const LS_WEEKLY_PLAN = 'hf_weekly_plan_v1';
const LS_INITIALIZED = 'hf_initialized_v1';
const LS_GEMINI_KEY = 'hf_gemini_api_key_v1';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponible'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RECIPES)) {
        db.createObjectStore(STORE_RECIPES, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadRecipes(): Promise<Recipe[]> {
  try {
    const db = await openDB();
    const recipes = await new Promise<Recipe[]>((resolve, reject) => {
      const tx = db.transaction(STORE_RECIPES, 'readonly');
      const store = tx.objectStore(STORE_RECIPES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as Recipe[]);
      req.onerror = () => reject(req.error);
    });

    const isInitialized = localStorage.getItem(LS_INITIALIZED);
    if (!isInitialized && recipes.length === 0) {
      await saveAllRecipes(SAMPLE_RECIPES);
      localStorage.setItem(LS_INITIALIZED, 'true');
      return SAMPLE_RECIPES;
    }

    if (!isInitialized) {
      localStorage.setItem(LS_INITIALIZED, 'true');
    }

    return recipes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    // Fallback localStorage si IndexedDB est bloqué (ex: mode privé strict)
    const raw = localStorage.getItem('hf_recipes_fallback_v1');
    if (raw) {
      try {
        return JSON.parse(raw) as Recipe[];
      } catch {
        return SAMPLE_RECIPES;
      }
    }
    localStorage.setItem('hf_recipes_fallback_v1', JSON.stringify(SAMPLE_RECIPES));
    return SAMPLE_RECIPES;
  }
}

export async function saveRecipe(recipe: Recipe): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RECIPES, 'readwrite');
      tx.objectStore(STORE_RECIPES).put(recipe);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadRecipes();
    const updated = [recipe, ...current.filter((r) => r.id !== recipe.id)];
    localStorage.setItem('hf_recipes_fallback_v1', JSON.stringify(updated));
  }
}

export async function deleteRecipeById(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RECIPES, 'readwrite');
      tx.objectStore(STORE_RECIPES).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const current = await loadRecipes();
    const updated = current.filter((r) => r.id !== id);
    localStorage.setItem('hf_recipes_fallback_v1', JSON.stringify(updated));
  }
}

export async function saveAllRecipes(recipes: Recipe[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RECIPES, 'readwrite');
      const store = tx.objectStore(STORE_RECIPES);
      store.clear();
      for (const r of recipes) {
        store.put(r);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.setItem('hf_recipes_fallback_v1', JSON.stringify(recipes));
  }
}

export function loadWeeklyPlan(): WeeklyPlan {
  try {
    const raw = localStorage.getItem(LS_WEEKLY_PLAN);
    if (!raw) return createEmptyWeeklyPlan();
    const parsed = JSON.parse(raw) as Partial<WeeklyPlan>;
    return { ...createEmptyWeeklyPlan(), ...parsed };
  } catch {
    return createEmptyWeeklyPlan();
  }
}

export function saveWeeklyPlan(plan: WeeklyPlan): void {
  localStorage.setItem(LS_WEEKLY_PLAN, JSON.stringify(plan));
}

export function loadGeminiApiKey(): string {
  return localStorage.getItem(LS_GEMINI_KEY) ?? '';
}

export function saveGeminiApiKey(key: string): void {
  if (key.trim()) {
    localStorage.setItem(LS_GEMINI_KEY, key.trim());
  } else {
    localStorage.removeItem(LS_GEMINI_KEY);
  }
}

export function buildBackupPayload(recipes: Recipe[], weeklyPlan: WeeklyPlan): RecipeBookBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    recipes,
    weeklyPlan,
  };
}

export function downloadBackupJson(recipes: Recipe[], weeklyPlan: WeeklyPlan): void {
  const payload = buildBackupPayload(recipes, weeklyPlan);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `livre-recettes-hellofresh-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
