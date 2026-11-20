import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  Unsubscribe,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Recipe, RecipeBookBackup, WeeklyPlan, createEmptyWeeklyPlan } from '../types/recipe';

const LS_GEMINI_KEY = 'hf_gemini_api_key_v1';

/**
 * Firestore rejette les propriétés ayant pour valeur `undefined`.
 * On nettoie récursivement tout objet/tableau avant écriture.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        cleaned[k] = stripUndefined(v);
      }
    }
    return cleaned as T;
  }
  return value;
}

function requireDb() {
  if (!db) {
    throw new Error('Firestore non initialisé : vérifiez la configuration Firebase.');
  }
  return db;
}

export function subscribeUserRecipes(
  uid: string,
  onData: (recipes: Recipe[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const firestore = requireDb();
  const colRef = collection(firestore, 'users', uid, 'recipes');
  return onSnapshot(
    colRef,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as Recipe);
      list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      onData(list);
    },
    (err) => {
      onError?.(err);
    }
  );
}

export async function saveUserRecipe(uid: string, recipe: Recipe): Promise<void> {
  const firestore = requireDb();
  const ref = doc(firestore, 'users', uid, 'recipes', recipe.id);
  await setDoc(ref, stripUndefined(recipe));
}

export async function deleteUserRecipe(uid: string, recipeId: string): Promise<void> {
  const firestore = requireDb();
  const ref = doc(firestore, 'users', uid, 'recipes', recipeId);
  await deleteDoc(ref);
}

export async function mergeUserRecipes(uid: string, recipes: Recipe[]): Promise<void> {
  if (recipes.length === 0) return;
  const firestore = requireDb();
  const CHUNK_SIZE = 400;
  for (let i = 0; i < recipes.length; i += CHUNK_SIZE) {
    const batch = writeBatch(firestore);
    const chunk = recipes.slice(i, i + CHUNK_SIZE);
    for (const r of chunk) {
      batch.set(doc(firestore, 'users', uid, 'recipes', r.id), stripUndefined(r));
    }
    await batch.commit();
  }
}

export async function replaceAllUserRecipes(uid: string, recipes: Recipe[]): Promise<void> {
  const firestore = requireDb();
  const colRef = collection(firestore, 'users', uid, 'recipes');
  const existingSnap = await getDocs(colRef);
  const nextIds = new Set(recipes.map((r) => r.id));

  const ops: Array<{ type: 'delete'; id: string } | { type: 'set'; recipe: Recipe }> = [];
  existingSnap.docs.forEach((d) => {
    if (!nextIds.has(d.id)) {
      ops.push({ type: 'delete', id: d.id });
    }
  });
  recipes.forEach((r) => {
    ops.push({ type: 'set', recipe: r });
  });

  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const batch = writeBatch(firestore);
    for (const op of ops.slice(i, i + CHUNK_SIZE)) {
      if (op.type === 'delete') {
        batch.delete(doc(firestore, 'users', uid, 'recipes', op.id));
      } else {
        batch.set(doc(firestore, 'users', uid, 'recipes', op.recipe.id), stripUndefined(op.recipe));
      }
    }
    await batch.commit();
  }
}

export function subscribeUserWeeklyPlan(
  uid: string,
  onData: (plan: WeeklyPlan) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const firestore = requireDb();
  const planRef = doc(firestore, 'users', uid, 'meta', 'weeklyPlan');
  return onSnapshot(
    planRef,
    (snap) => {
      if (!snap.exists()) {
        onData(createEmptyWeeklyPlan());
        return;
      }
      const parsed = snap.data() as Partial<WeeklyPlan>;
      onData({ ...createEmptyWeeklyPlan(), ...parsed });
    },
    (err) => {
      onError?.(err);
    }
  );
}

export async function saveUserWeeklyPlan(uid: string, plan: WeeklyPlan): Promise<void> {
  const firestore = requireDb();
  const planRef = doc(firestore, 'users', uid, 'meta', 'weeklyPlan');
  await setDoc(planRef, stripUndefined(plan));
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
