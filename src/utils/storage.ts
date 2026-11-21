import {
  collection,
  doc,
  DocumentReference,
  getDocs,
  onSnapshot,
  setDoc,
  Unsubscribe,
  writeBatch,
} from 'firebase/firestore';
import { db, estConnecteFirebase, getFirebaseUser } from '../lib/firebase';
import {
  DAYS_OF_WEEK,
  Recipe,
  RecipeBookBackup,
  WeeklyPlan,
  createEmptyWeeklyPlan,
} from '../types/recipe';

const DB_NAME = 'carnet-hellofresh-db';
const DB_VERSION = 2;
const STORE_RECIPES = 'recipes';
const STORE_PHOTOS = 'photos';

const LS_RECIPES_FALLBACK = 'hf_recipes_fallback_v1';
const LS_WEEKLY_PLAN = 'hf_weekly_plan_v1';
const LS_INITIALIZED = 'hf_initialized_v1';
const LS_GEMINI_KEY = 'hf_gemini_api_key_v1';
export const LAST_UID_KEY = 'livre_recettes_last_uid';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface CloudState {
  initialSyncDone: boolean;
  syncedCols: Record<string, boolean>;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
}

export const cloudState: CloudState = {
  initialSyncDone: false,
  syncedCols: {},
  syncStatus: 'idle',
  syncError: null,
  lastSyncedAt: null,
};

type CloudStateListener = (state: CloudState) => void;
const cloudListeners = new Set<CloudStateListener>();

function notifyCloudState() {
  const snapshot: CloudState = {
    ...cloudState,
    syncedCols: { ...cloudState.syncedCols },
  };
  cloudListeners.forEach((fn) => fn(snapshot));
}

export function subscribeCloudState(listener: CloudStateListener): () => void {
  cloudListeners.add(listener);
  listener({ ...cloudState, syncedCols: { ...cloudState.syncedCols } });
  return () => {
    cloudListeners.delete(listener);
  };
}

export function reinitialiserEtatCloud(): void {
  cloudState.initialSyncDone = false;
  cloudState.syncedCols = {};
  cloudState.syncStatus = 'idle';
  cloudState.syncError = null;
  cloudState.lastSyncedAt = null;
  notifyCloudState();
}

let _suppressCloudSync = false;
let _syncTimer: ReturnType<typeof setTimeout> | null = null;
let unsubListeners: Unsubscribe[] = [];

export function arreterListenersFirestore(): void {
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }
  unsubListeners.forEach((unsub) => {
    try {
      unsub();
    } catch {
      // ignore
    }
  });
  unsubListeners = [];
}

export function formatFirestoreError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  const message = (err as { message?: string })?.message;
  if (code === 'permission-denied') {
    return 'Accès Firestore refusé (vérifiez que votre e-mail est bien vérifié et autorisé).';
  }
  return message || 'Erreur de synchronisation Firestore';
}

/**
 * Nettoie un objet avant écriture Firestore : remplace `undefined` par `null`.
 */
export function cleanForFirestore<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (v === undefined ? null : v)));
}

const ALLOWED_RECIPE_FIELDS = [
  'id',
  'recipeNumber',
  'title',
  'subtitle',
  'prepTimeMinutes',
  'prepTimeRange',
  'servings',
  'tags',
  'utensils',
  'ingredients',
  'steps',
  'stepDetails',
  'nutrition',
  'allergens',
  'imageFront',
  'imageBack',
  'notes',
  'isWeekly',
  'createdAt',
  'updatedAt',
] as const;

const MAX_CLOUD_IMAGE_CHARS = 20000;

function sanitizeImageForCloud(img?: string | null): string | null {
  if (!img || typeof img !== 'string') return null;
  // Les photos binaires/base64 lourdes restent uniquement en local dans IndexedDB (plan Spark, limite 1 Mo/doc).
  // Seules les illustrations SVG légères (<= 20 Ko) sont conservées dans Firestore.
  if (img.length > MAX_CLOUD_IMAGE_CHARS) return null;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(img)) return null;
  return img;
}

export function prepareRecipeForFirestore(recipe: Recipe): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  const source = recipe as unknown as Record<string, unknown>;
  for (const key of ALLOWED_RECIPE_FIELDS) {
    if (key === 'id') {
      raw.id = String(recipe.id);
    } else if (key === 'imageFront') {
      raw.imageFront = sanitizeImageForCloud(recipe.imageFront);
    } else if (key === 'imageBack') {
      raw.imageBack = sanitizeImageForCloud(recipe.imageBack);
    } else {
      raw[key] = source[key] !== undefined ? source[key] : null;
    }
  }
  return cleanForFirestore(raw);
}

interface PhotoRecord {
  id: string;
  imageFront?: string;
  imageBack?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponible'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_RECIPES)) {
        database.createObjectStore(STORE_RECIPES, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_PHOTOS)) {
        database.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadLocalPhotosMap(): Promise<Map<string, PhotoRecord>> {
  const map = new Map<string, PhotoRecord>();
  try {
    const database = await openDB();
    const records = await new Promise<PhotoRecord[]>((resolve, reject) => {
      const tx = database.transaction(STORE_PHOTOS, 'readonly');
      const store = tx.objectStore(STORE_PHOTOS);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as PhotoRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    for (const r of records) {
      if (r && r.id) {
        map.set(String(r.id), r);
      }
    }
  } catch {
    // ignore if IDB blocked
  }
  return map;
}

function sortRecipesDesc(list: Recipe[]): Recipe[] {
  return [...list].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export async function loadLocalRecipes(): Promise<Recipe[]> {
  try {
    const database = await openDB();
    const [recipes, photosMap] = await Promise.all([
      new Promise<Recipe[]>((resolve, reject) => {
        const tx = database.transaction(STORE_RECIPES, 'readonly');
        const store = tx.objectStore(STORE_RECIPES);
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as Recipe[]) || []);
        req.onerror = () => reject(req.error);
      }),
      loadLocalPhotosMap(),
    ]);

    const isInitialized = localStorage.getItem(LS_INITIALIZED);
    if (!isInitialized) {
      localStorage.setItem(LS_INITIALIZED, 'true');
    }

    const hydrated = recipes.map((r) => {
      const photo = photosMap.get(String(r.id));
      return {
        ...r,
        id: String(r.id),
        imageFront: r.imageFront || photo?.imageFront || undefined,
        imageBack: r.imageBack || photo?.imageBack || undefined,
      };
    });

    return sortRecipesDesc(hydrated);
  } catch {
    const raw = localStorage.getItem(LS_RECIPES_FALLBACK);
    if (raw) {
      try {
        return sortRecipesDesc(JSON.parse(raw) as Recipe[]);
      } catch {
        return [];
      }
    }
    try {
      localStorage.setItem(LS_INITIALIZED, 'true');
    } catch {
      // ignore quota
    }
    return [];
  }
}

async function saveLocalRecipesOnly(recipes: Recipe[]): Promise<void> {
  try {
    const database = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction([STORE_RECIPES, STORE_PHOTOS], 'readwrite');
      const recipeStore = tx.objectStore(STORE_RECIPES);
      const photoStore = tx.objectStore(STORE_PHOTOS);

      recipeStore.clear();
      for (const r of recipes) {
        const normalized: Recipe = { ...r, id: String(r.id) };
        recipeStore.put(normalized);
        if (normalized.imageFront || normalized.imageBack) {
          photoStore.put({
            id: String(normalized.id),
            imageFront: normalized.imageFront,
            imageBack: normalized.imageBack,
          });
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback localStorage sans photos lourdes si quota limité
  }

  try {
    const lightweight = recipes.map((r) => ({
      ...r,
      imageFront: sanitizeImageForCloud(r.imageFront) ?? undefined,
      imageBack: sanitizeImageForCloud(r.imageBack) ?? undefined,
    }));
    localStorage.setItem(LS_RECIPES_FALLBACK, JSON.stringify(lightweight));
  } catch {
    // ignore localStorage quota errors when IDB is primary
  }
}

export async function deleteLocalPhotoById(recipeId: string): Promise<void> {
  try {
    const database = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE_PHOTOS, 'readwrite');
      tx.objectStore(STORE_PHOTOS).delete(String(recipeId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export function loadLocalWeeklyPlan(): WeeklyPlan {
  try {
    const raw = localStorage.getItem(LS_WEEKLY_PLAN);
    if (!raw) return createEmptyWeeklyPlan();
    const parsed = JSON.parse(raw) as Partial<WeeklyPlan>;
    return { ...createEmptyWeeklyPlan(), ...parsed };
  } catch {
    return createEmptyWeeklyPlan();
  }
}

function saveLocalWeeklyPlanOnly(plan: WeeklyPlan): void {
  try {
    localStorage.setItem(LS_WEEKLY_PLAN, JSON.stringify(plan));
  } catch (e) {
    console.error('Erreur sauvegarde localStorage weeklyPlan:', e);
  }
}

function hasAnyPlannedMeal(plan: WeeklyPlan): boolean {
  for (const d of DAYS_OF_WEEK) {
    if (plan[d.key]?.midi || plan[d.key]?.soir) return true;
  }
  return false;
}

function normalizeRecipeFromFirestore(
  data: Record<string, unknown>,
  docId: string,
  photosMap: Map<string, PhotoRecord>
): Recipe {
  const id = String(data.id || docId);
  const localPhoto = photosMap.get(id);
  const strOrUndef = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;

  return {
    id,
    recipeNumber: strOrUndef(data.recipeNumber),
    title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Recette sans titre',
    subtitle: strOrUndef(data.subtitle),
    prepTimeMinutes: typeof data.prepTimeMinutes === 'number' ? data.prepTimeMinutes : 25,
    prepTimeRange: strOrUndef(data.prepTimeRange),
    servings: typeof data.servings === 'number' ? data.servings : 2,
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    utensils: Array.isArray(data.utensils) ? (data.utensils as string[]) : undefined,
    ingredients: Array.isArray(data.ingredients)
      ? (data.ingredients as Recipe['ingredients'])
      : [],
    steps: Array.isArray(data.steps) ? (data.steps as string[]) : [],
    stepDetails: Array.isArray(data.stepDetails)
      ? (data.stepDetails as Recipe['stepDetails'])
      : undefined,
    nutrition: Array.isArray(data.nutrition)
      ? (data.nutrition as Recipe['nutrition'])
      : undefined,
    allergens: strOrUndef(data.allergens),
    imageFront: localPhoto?.imageFront || strOrUndef(data.imageFront),
    imageBack: localPhoto?.imageBack || strOrUndef(data.imageBack),
    notes: strOrUndef(data.notes),
    isWeekly: Boolean(data.isWeekly),
    createdAt:
      typeof data.createdAt === 'string' && data.createdAt
        ? data.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof data.updatedAt === 'string' && data.updatedAt
        ? data.updatedAt
        : new Date().toISOString(),
  };
}

/**
 * Push complet des données locales vers Firestore (par lots <= 450 opérations).
 */
export async function syncAllUserDataToFirestore(
  recipes: Recipe[],
  weeklyPlan: WeeklyPlan
): Promise<void> {
  const user = getFirebaseUser();
  if (!db || !user) return;
  const uid = user.uid;

  const colRef = collection(db, 'recettes_users', uid, 'recipes');
  const existingSnap = await getDocs(colRef);
  const currentIds = new Set(recipes.filter((r) => r && r.id).map((r) => String(r.id)));

  const ops: Array<
    | { type: 'delete'; ref: DocumentReference }
    | { type: 'set'; ref: DocumentReference; data: Record<string, unknown> }
  > = [];

  existingSnap.docs.forEach((d) => {
    if (!currentIds.has(d.id)) {
      ops.push({ type: 'delete', ref: d.ref });
    }
  });

  recipes.forEach((item) => {
    if (item && item.id) {
      ops.push({
        type: 'set',
        ref: doc(colRef, String(item.id)),
        data: prepareRecipeForFirestore(item),
      });
    }
  });

  const BATCH_LIMIT = 450;
  if (ops.length === 0) {
    const batch = writeBatch(db);
    await batch.commit();
  } else {
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      const chunk = ops.slice(i, i + BATCH_LIMIT);
      for (const op of chunk) {
        if (op.type === 'delete') {
          batch.delete(op.ref);
        } else {
          batch.set(op.ref, op.data);
        }
      }
      await batch.commit();
    }
  }

  await setDocSettingsFirestore(weeklyPlan);
}

export async function setDocSettingsFirestore(weeklyPlan: WeeklyPlan): Promise<void> {
  const user = getFirebaseUser();
  if (!db || !user) return;
  const settingsRef = doc(db, 'recettes_users', user.uid, 'settings', 'main');
  await setDoc(
    settingsRef,
    cleanForFirestore({
      id: 'main',
      weeklyPlan,
      updatedAt: new Date().toISOString(),
    })
  );
}

/**
 * Sauvegarde locale (source de l'UI) + push Firestore debounced (450 ms) si connecté et initialSyncDone.
 */
export async function sauvegarderDonnees(
  recipes: Recipe[],
  weeklyPlan: WeeklyPlan,
  skipCloud = false
): Promise<void> {
  await saveLocalRecipesOnly(recipes);
  saveLocalWeeklyPlanOnly(weeklyPlan);

  if (!skipCloud && !_suppressCloudSync && estConnecteFirebase() && cloudState.initialSyncDone) {
    if (_syncTimer) clearTimeout(_syncTimer);
    cloudState.syncStatus = 'syncing';
    cloudState.syncError = null;
    notifyCloudState();

    _syncTimer = setTimeout(async () => {
      try {
        await syncAllUserDataToFirestore(recipes, weeklyPlan);
        cloudState.syncStatus = 'synced';
        cloudState.lastSyncedAt = new Date().toISOString();
        notifyCloudState();
      } catch (err) {
        console.warn('Sync Firestore:', err);
        cloudState.syncStatus = 'error';
        cloudState.syncError = formatFirestoreError(err);
        notifyCloudState();
      }
    }, 450);
  }
}

export interface ActiverSyncCallbacks {
  getLocalRecipes: () => Recipe[];
  getLocalWeeklyPlan: () => WeeklyPlan;
  onRecipesChange: (recipes: Recipe[]) => void;
  onWeeklyPlanChange: (plan: WeeklyPlan) => void;
}

export async function activerSyncCloud(callbacks: ActiverSyncCallbacks): Promise<void> {
  const user = getFirebaseUser();
  if (!db || !user) return;

  arreterListenersFirestore();
  reinitialiserEtatCloud();
  cloudState.syncStatus = 'syncing';
  notifyCloudState();

  const currentUid = user.uid;
  const previousUid = localStorage.getItem(LAST_UID_KEY);
  const isNewDeviceLogin = Boolean(currentUid && previousUid !== currentUid);
  let needsPushAfterInit = false;

  const checkInitDone = () => {
    if (!cloudState.initialSyncDone && Object.keys(cloudState.syncedCols).length >= 2) {
      cloudState.initialSyncDone = true;
      cloudState.syncStatus = 'synced';
      cloudState.lastSyncedAt = new Date().toISOString();
      if (currentUid) {
        localStorage.setItem(LAST_UID_KEY, currentUid);
      }
      notifyCloudState();

      if (needsPushAfterInit) {
        needsPushAfterInit = false;
        void sauvegarderDonnees(
          callbacks.getLocalRecipes(),
          callbacks.getLocalWeeklyPlan(),
          false
        );
      }
    }
  };

  const handleErr = (label: string, err: unknown) => {
    console.warn(`Sync ${label}:`, err);
    cloudState.syncStatus = 'error';
    cloudState.syncError = formatFirestoreError(err);
    notifyCloudState();
  };

  // 1. Collection recipes
  const recipesColRef = collection(db, 'recettes_users', currentUid, 'recipes');
  unsubListeners.push(
    onSnapshot(
      recipesColRef,
      async (snap) => {
        const fromCache = snap.metadata.fromCache;
        // Ne jamais traiter un cache local vide comme un serveur vide
        if (fromCache && snap.docs.length === 0) {
          return;
        }

        const photosMap = await loadLocalPhotosMap();
        const serverList = sortRecipesDesc(
          snap.docs.map((d) =>
            normalizeRecipeFromFirestore(d.data() as Record<string, unknown>, d.id, photosMap)
          )
        );

        const isFirstServerForCol = !fromCache && !cloudState.syncedCols.recipes;
        const localItems = callbacks.getLocalRecipes();

        if (isFirstServerForCol) {
          cloudState.syncedCols.recipes = true;

          if (serverList.length === 0 && localItems.length > 0) {
            // Serveur vide et données locales présentes : pousser après init
            needsPushAfterInit = true;
          } else if (serverList.length > 0 && localItems.length > 0 && isNewDeviceLogin) {
            // Nouvel appareil/compte : fusionner serveur + éléments locaux absents du serveur
            const serverIds = new Set(serverList.map((i) => String(i.id)));
            const localOnly = localItems.filter(
              (i) => i && i.id && !serverIds.has(String(i.id))
            );
            const merged = sortRecipesDesc([...serverList, ...localOnly]);
            _suppressCloudSync = true;
            await saveLocalRecipesOnly(merged);
            callbacks.onRecipesChange(merged);
            _suppressCloudSync = false;
            if (localOnly.length > 0) {
              needsPushAfterInit = true;
            }
          } else {
            _suppressCloudSync = true;
            await saveLocalRecipesOnly(serverList);
            callbacks.onRecipesChange(serverList);
            _suppressCloudSync = false;
          }

          checkInitDone();
        } else {
          _suppressCloudSync = true;
          await saveLocalRecipesOnly(serverList);
          callbacks.onRecipesChange(serverList);
          _suppressCloudSync = false;
        }
      },
      (err) => handleErr('recipes', err)
    )
  );

  // 2. Document settings/main (planning hebdomadaire & préférences)
  const settingsDocRef = doc(db, 'recettes_users', currentUid, 'settings', 'main');
  unsubListeners.push(
    onSnapshot(
      settingsDocRef,
      (snap) => {
        const fromCache = snap.metadata.fromCache;
        if (fromCache && !snap.exists()) {
          return;
        }

        const isFirstServerForSettings = !fromCache && !cloudState.syncedCols.settings;
        const localPlan = callbacks.getLocalWeeklyPlan();

        if (isFirstServerForSettings) {
          cloudState.syncedCols.settings = true;

          if (!snap.exists()) {
            if (hasAnyPlannedMeal(localPlan)) {
              needsPushAfterInit = true;
            }
          } else {
            const rawData = snap.data() as { weeklyPlan?: Partial<WeeklyPlan> } | undefined;
            const serverPlan: WeeklyPlan = {
              ...createEmptyWeeklyPlan(),
              ...(rawData?.weeklyPlan ?? {}),
            };

            if (!hasAnyPlannedMeal(serverPlan) && hasAnyPlannedMeal(localPlan)) {
              needsPushAfterInit = true;
            } else if (
              hasAnyPlannedMeal(serverPlan) &&
              hasAnyPlannedMeal(localPlan) &&
              isNewDeviceLogin
            ) {
              const mergedPlan: WeeklyPlan = { ...serverPlan };
              let addedLocalSlot = false;
              for (const d of DAYS_OF_WEEK) {
                const sDay = serverPlan[d.key] ?? { midi: null, soir: null };
                const lDay = localPlan[d.key] ?? { midi: null, soir: null };
                const nextDay = { ...sDay };
                if (!nextDay.midi && lDay.midi) {
                  nextDay.midi = lDay.midi;
                  if (lDay.midiServings) nextDay.midiServings = lDay.midiServings;
                  addedLocalSlot = true;
                }
                if (!nextDay.soir && lDay.soir) {
                  nextDay.soir = lDay.soir;
                  if (lDay.soirServings) nextDay.soirServings = lDay.soirServings;
                  addedLocalSlot = true;
                }
                mergedPlan[d.key] = nextDay;
              }
              _suppressCloudSync = true;
              saveLocalWeeklyPlanOnly(mergedPlan);
              callbacks.onWeeklyPlanChange(mergedPlan);
              _suppressCloudSync = false;
              if (addedLocalSlot) {
                needsPushAfterInit = true;
              }
            } else {
              _suppressCloudSync = true;
              saveLocalWeeklyPlanOnly(serverPlan);
              callbacks.onWeeklyPlanChange(serverPlan);
              _suppressCloudSync = false;
            }
          }

          checkInitDone();
        } else if (snap.exists()) {
          const rawData = snap.data() as { weeklyPlan?: Partial<WeeklyPlan> } | undefined;
          const serverPlan: WeeklyPlan = {
            ...createEmptyWeeklyPlan(),
            ...(rawData?.weeklyPlan ?? {}),
          };
          _suppressCloudSync = true;
          saveLocalWeeklyPlanOnly(serverPlan);
          callbacks.onWeeklyPlanChange(serverPlan);
          _suppressCloudSync = false;
        }
      },
      (err) => handleErr('settings', err)
    )
  );
}

export async function forcerSyncCloud(
  recipes: Recipe[],
  weeklyPlan: WeeklyPlan
): Promise<boolean> {
  if (!estConnecteFirebase()) {
    throw new Error('Non connecté au Cloud.');
  }
  cloudState.syncStatus = 'syncing';
  cloudState.syncError = null;
  notifyCloudState();
  try {
    await syncAllUserDataToFirestore(recipes, weeklyPlan);
    cloudState.initialSyncDone = true;
    cloudState.syncStatus = 'synced';
    cloudState.lastSyncedAt = new Date().toISOString();
    const user = getFirebaseUser();
    if (user?.uid) {
      localStorage.setItem(LAST_UID_KEY, user.uid);
    }
    notifyCloudState();
    return true;
  } catch (err) {
    cloudState.syncStatus = 'error';
    cloudState.syncError = formatFirestoreError(err);
    notifyCloudState();
    throw new Error(cloudState.syncError);
  }
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
