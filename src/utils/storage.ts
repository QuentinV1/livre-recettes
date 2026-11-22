import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  DocumentReference,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  Unsubscribe,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, estConnecteFirebase, getFirebaseUser } from '../lib/firebase';
import {
  DAYS_OF_WEEK,
  Recipe,
  RecipeBookBackup,
  RecipeRating,
  SharedBook,
  SharedBookMember,
  WeeklyPlan,
  createEmptyWeeklyPlan,
} from '../types/recipe';
import { getUserDisplayLabel } from './ratings';

const DB_NAME = 'carnet-hellofresh-db';
const DB_VERSION = 2;
const STORE_RECIPES = 'recipes';
const STORE_PHOTOS = 'photos';

const LS_RECIPES_FALLBACK = 'hf_recipes_fallback_v1';
const LS_WEEKLY_PLAN = 'hf_weekly_plan_v1';
const LS_INITIALIZED = 'hf_initialized_v1';
const LS_GEMINI_KEY = 'hf_gemini_api_key_v1';
const LS_ACTIVE_BOOK_ID = 'hf_active_book_id_v1';
export const LAST_UID_KEY = 'livre_recettes_last_uid';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface CloudState {
  initialSyncDone: boolean;
  syncedCols: Record<string, boolean>;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  activeBookId: string | null;
  activeBook: SharedBook | null;
}

export const cloudState: CloudState = {
  initialSyncDone: false,
  syncedCols: {},
  syncStatus: 'idle',
  syncError: null,
  lastSyncedAt: null,
  activeBookId: localStorage.getItem(LS_ACTIVE_BOOK_ID) || null,
  activeBook: null,
};

type CloudStateListener = (state: CloudState) => void;
const cloudListeners = new Set<CloudStateListener>();

function notifyCloudState() {
  const snapshot: CloudState = {
    ...cloudState,
    syncedCols: { ...cloudState.syncedCols },
    activeBook: cloudState.activeBook ? { ...cloudState.activeBook } : null,
  };
  cloudListeners.forEach((fn) => fn(snapshot));
}

export function subscribeCloudState(listener: CloudStateListener): () => void {
  cloudListeners.add(listener);
  listener({
    ...cloudState,
    syncedCols: { ...cloudState.syncedCols },
    activeBook: cloudState.activeBook ? { ...cloudState.activeBook } : null,
  });
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
  cloudState.activeBookId = null;
  cloudState.activeBook = null;
  localStorage.removeItem(LS_ACTIVE_BOOK_ID);
  notifyCloudState();
}

let _suppressCloudSync = false;
let _syncTimer: ReturnType<typeof setTimeout> | null = null;
let unsubListeners: Unsubscribe[] = [];
let unsubRecipesListener: Unsubscribe | null = null;
let unsubBookListener: Unsubscribe | null = null;

export function arreterListenersFirestore(): void {
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }
  if (unsubRecipesListener) {
    try {
      unsubRecipesListener();
    } catch {
      // ignore
    }
    unsubRecipesListener = null;
  }
  if (unsubBookListener) {
    try {
      unsubBookListener();
    } catch {
      // ignore
    }
    unsubBookListener = null;
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
  'ratings',
  'ownerUid',
  'ownerName',
  'isWeekly',
  'createdAt',
  'updatedAt',
] as const;

const MAX_CLOUD_IMAGE_CHARS = 850000;

function sanitizeImageForCloud(img?: string | null): string | null {
  if (!img || typeof img !== 'string') return null;
  // Option 1 : la photo du plat compressée (WebP/JPEG <= 850 Ko) ou une URL externe (ex. R2) est stockée directement dans Firestore.
  if (img.length > MAX_CLOUD_IMAGE_CHARS) return null;
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
      // Les photos verso ne sont jamais persistées (utilisées uniquement pour l'analyse Gemini Vision).
      raw.imageBack = null;
    } else {
      raw[key] = source[key] !== undefined ? source[key] : null;
    }
  }
  return cleanForFirestore(raw);
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

function sortRecipesDesc(list: Recipe[]): Recipe[] {
  return [...list].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export async function loadLocalRecipes(): Promise<Recipe[]> {
  try {
    const database = await openDB();
    const recipes = await new Promise<Recipe[]>((resolve, reject) => {
      const tx = database.transaction(STORE_RECIPES, 'readonly');
      const store = tx.objectStore(STORE_RECIPES);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as Recipe[]) || []);
      req.onerror = () => reject(req.error);
    });

    const isInitialized = localStorage.getItem(LS_INITIALIZED);
    if (!isInitialized) {
      localStorage.setItem(LS_INITIALIZED, 'true');
    }

    const hydrated = recipes.map((r) => ({
      ...r,
      id: String(r.id),
      imageFront: r.imageFront || undefined,
      imageBack: undefined,
    }));

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
      const stores = database.objectStoreNames.contains(STORE_PHOTOS)
        ? [STORE_RECIPES, STORE_PHOTOS]
        : [STORE_RECIPES];
      const tx = database.transaction(stores, 'readwrite');
      const recipeStore = tx.objectStore(STORE_RECIPES);

      recipeStore.clear();
      if (database.objectStoreNames.contains(STORE_PHOTOS)) {
        // Purge de l'ancien cache local de photos recto/verso
        tx.objectStore(STORE_PHOTOS).clear();
      }
      for (const r of recipes) {
        const normalized: Recipe = {
          ...r,
          id: String(r.id),
          imageBack: undefined,
        };
        recipeStore.put(normalized);
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
      imageFront:
        r.imageFront && r.imageFront.length <= 20000 ? r.imageFront : undefined,
      imageBack: undefined,
    }));
    localStorage.setItem(LS_RECIPES_FALLBACK, JSON.stringify(lightweight));
  } catch {
    // ignore localStorage quota errors when IDB is primary
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

function normalizeRatingsFromFirestore(
  raw: unknown
): Record<string, RecipeRating> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, RecipeRating> = {};
  let hasAny = false;
  for (const [uid, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const entry = val as Record<string, unknown>;
    const score = Number(entry.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) continue;
    out[uid] = {
      score: Math.round(score),
      userName:
        typeof entry.userName === 'string' && entry.userName.trim()
          ? entry.userName.trim()
          : 'Anonyme',
      updatedAt:
        typeof entry.updatedAt === 'string' && entry.updatedAt
          ? entry.updatedAt
          : new Date().toISOString(),
    };
    hasAny = true;
  }
  return hasAny ? out : undefined;
}

function getActiveRecipesCollection(uid: string, bookId: string | null) {
  if (!db) return null;
  return bookId
    ? collection(db, 'recettes_books', bookId, 'recipes')
    : collection(db, 'recettes_users', uid, 'recipes');
}

function normalizeRecipeFromFirestore(
  data: Record<string, unknown>,
  docId: string
): Recipe {
  const id = String(data.id || docId);
  const strOrUndef = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;

  return {
    id,
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
    imageFront: strOrUndef(data.imageFront),
    imageBack: undefined,
    notes: strOrUndef(data.notes),
    ratings: normalizeRatingsFromFirestore(data.ratings),
    ownerUid: strOrUndef(data.ownerUid),
    ownerName: strOrUndef(data.ownerName),
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

export function normalizeRecipeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function isRecipeOwnedBy(
  recipe: Recipe,
  uid: string | null | undefined
): boolean {
  if (!uid) return true;
  if (!recipe.ownerUid) return true;
  return recipe.ownerUid === uid;
}

function stampRecipeOwnership(
  recipe: Recipe,
  uid: string,
  displayName: string
): Recipe {
  return {
    ...recipe,
    ownerUid: recipe.ownerUid || uid,
    ownerName: recipe.ownerName || displayName,
  };
}

type BatchOp =
  | { type: 'delete'; ref: DocumentReference }
  | { type: 'set'; ref: DocumentReference; data: Record<string, unknown> };

async function commitOpsInBatches(ops: BatchOp[]): Promise<void> {
  if (!db || ops.length === 0) return;
  const BATCH_LIMIT = 450;
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.type === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.set(op.ref, op.data);
      }
    }
    await batch.commit();
  }
}

/**
 * Push complet des données de l'utilisateur vers Firestore (par lots <= 450 opérations).
 * Dans un foyer, seules les recettes appartenant à l'utilisateur courant sont synchronisées
 * (vers le foyer ET vers sa collection personnelle), sans jamais écraser celles des autres membres.
 */
export async function syncAllUserDataToFirestore(
  recipes: Recipe[],
  weeklyPlan: WeeklyPlan
): Promise<void> {
  const user = getFirebaseUser();
  if (!db || !user) return;
  const uid = user.uid;
  const displayName = getUserDisplayLabel(user);
  const activeBookId = cloudState.activeBookId;

  const userColRef = collection(db, 'recettes_users', uid, 'recipes');
  const myRecipes = (
    activeBookId ? recipes.filter((r) => isRecipeOwnedBy(r, uid)) : recipes
  )
    .filter((r) => r && r.id)
    .map((r) => stampRecipeOwnership(r, uid, displayName));
  const myIds = new Set(myRecipes.map((r) => String(r.id)));

  const ops: BatchOp[] = [];

  // 1. Synchroniser la collection personnelle de l'utilisateur
  const existingUserSnap = await getDocs(userColRef);
  existingUserSnap.docs.forEach((d) => {
    if (!myIds.has(d.id)) {
      ops.push({ type: 'delete', ref: d.ref });
    }
  });
  myRecipes.forEach((item) => {
    ops.push({
      type: 'set',
      ref: doc(userColRef, String(item.id)),
      data: prepareRecipeForFirestore(item),
    });
  });

  // 2. Si l'utilisateur est dans un foyer, synchroniser uniquement SES recettes dans le foyer
  if (activeBookId) {
    const bookColRef = collection(db, 'recettes_books', activeBookId, 'recipes');
    const existingBookSnap = await getDocs(bookColRef);
    const foreignIds = new Set<string>();

    existingBookSnap.docs.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const docOwner = typeof data.ownerUid === 'string' ? data.ownerUid : null;
      if (docOwner && docOwner !== uid) {
        foreignIds.add(d.id);
      } else if (!myIds.has(d.id)) {
        ops.push({ type: 'delete', ref: d.ref });
      }
    });

    myRecipes.forEach((item) => {
      const id = String(item.id);
      if (!foreignIds.has(id)) {
        ops.push({
          type: 'set',
          ref: doc(bookColRef, id),
          data: prepareRecipeForFirestore(item),
        });
      }
    });
  }

  await commitOpsInBatches(ops);
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
      activeBookId: cloudState.activeBookId ?? null,
      updatedAt: new Date().toISOString(),
    }),
    { merge: true }
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
  let currentListeningBookId: string | null | undefined = undefined;

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

  const ensureRecipesListener = (targetBookId: string | null) => {
    if (!db || currentListeningBookId === targetBookId) return;
    const isSwitchingBook = currentListeningBookId !== undefined;
    currentListeningBookId = targetBookId;

    cloudState.activeBookId = targetBookId;
    if (targetBookId) {
      localStorage.setItem(LS_ACTIVE_BOOK_ID, targetBookId);
    } else {
      localStorage.removeItem(LS_ACTIVE_BOOK_ID);
      cloudState.activeBook = null;
    }
    notifyCloudState();

    if (unsubRecipesListener) {
      unsubRecipesListener();
      unsubRecipesListener = null;
    }
    if (unsubBookListener) {
      unsubBookListener();
      unsubBookListener = null;
    }

    if (targetBookId) {
      const bookDocRef = doc(db, 'recettes_books', targetBookId);
      unsubBookListener = onSnapshot(
        bookDocRef,
        (bookSnap) => {
          if (bookSnap.exists()) {
            const bData = bookSnap.data() as Record<string, unknown>;
            cloudState.activeBook = {
              id: bookSnap.id,
              name: typeof bData.name === 'string' && bData.name ? bData.name : 'Carnet partagé',
              ownerUid: String(bData.ownerUid || ''),
              memberUids: Array.isArray(bData.memberUids) ? (bData.memberUids as string[]) : [],
              members:
                bData.members && typeof bData.members === 'object'
                  ? (bData.members as Record<string, SharedBookMember>)
                  : {},
              createdAt: String(bData.createdAt || ''),
              updatedAt: String(bData.updatedAt || ''),
            };
          } else {
            cloudState.activeBook = null;
          }
          notifyCloudState();
        },
        (err) => handleErr('book', err)
      );
    }

    const recipesColRef = getActiveRecipesCollection(currentUid, targetBookId);
    if (!recipesColRef) return;

    unsubRecipesListener = onSnapshot(
      recipesColRef,
      async (snap) => {
        const fromCache = snap.metadata.fromCache;
        if (fromCache && snap.docs.length === 0) {
          return;
        }

        const serverList = sortRecipesDesc(
          snap.docs.map((d) =>
            normalizeRecipeFromFirestore(d.data() as Record<string, unknown>, d.id)
          )
        );

        const isFirstServerForCol = !fromCache && !cloudState.syncedCols.recipes;
        const localItems = callbacks.getLocalRecipes();

        if (isFirstServerForCol && !isSwitchingBook && !targetBookId) {
          cloudState.syncedCols.recipes = true;

          if (serverList.length === 0 && localItems.length > 0) {
            needsPushAfterInit = true;
          } else if (serverList.length > 0 && localItems.length > 0 && isNewDeviceLogin) {
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
          if (isFirstServerForCol) {
            cloudState.syncedCols.recipes = true;
            checkInitDone();
          }
          _suppressCloudSync = true;
          await saveLocalRecipesOnly(serverList);
          callbacks.onRecipesChange(serverList);
          _suppressCloudSync = false;
        }
      },
      (err) => handleErr('recipes', err)
    );
  };

  // Document settings/main (planning hebdomadaire & carnet partagé actif)
  const settingsDocRef = doc(db, 'recettes_users', currentUid, 'settings', 'main');
  unsubListeners.push(
    onSnapshot(
      settingsDocRef,
      (snap) => {
        const fromCache = snap.metadata.fromCache;
        if (fromCache && !snap.exists()) {
          return;
        }

        const rawData = snap.exists()
          ? (snap.data() as { weeklyPlan?: Partial<WeeklyPlan>; activeBookId?: string | null } | undefined)
          : undefined;
        const serverBookId =
          typeof rawData?.activeBookId === 'string' && rawData.activeBookId.trim()
            ? rawData.activeBookId.trim()
            : null;

        ensureRecipesListener(serverBookId);

        const isFirstServerForSettings = !fromCache && !cloudState.syncedCols.settings;
        const localPlan = callbacks.getLocalWeeklyPlan();

        if (isFirstServerForSettings) {
          cloudState.syncedCols.settings = true;

          if (!snap.exists()) {
            if (hasAnyPlannedMeal(localPlan)) {
              needsPushAfterInit = true;
            }
          } else {
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

function generateBookCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function rateRecipeInCloud(
  recipeId: string,
  rating: RecipeRating | null
): Promise<void> {
  const user = getFirebaseUser();
  if (!db || !user) return;
  const colRef = getActiveRecipesCollection(user.uid, cloudState.activeBookId);
  if (!colRef) return;
  const recipeRef = doc(colRef, String(recipeId));
  await updateDoc(recipeRef, {
    [`ratings.${user.uid}`]: rating ? cleanForFirestore(rating) : deleteField(),
  });
}

export async function createSharedBook(
  name: string,
  recipesToCopy: Recipe[]
): Promise<string> {
  const user = getFirebaseUser();
  if (!db || !user) {
    throw new Error('Connectez-vous au Cloud pour créer un foyer.');
  }

  let bookId = generateBookCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await getDoc(doc(db, 'recettes_books', bookId));
    if (!existing.exists()) break;
    bookId = generateBookCode();
  }

  const now = new Date().toISOString();
  const displayName = getUserDisplayLabel(user);
  const member: SharedBookMember = {
    uid: user.uid,
    displayName,
    email: user.email ?? undefined,
    joinedAt: now,
  };

  const bookData: SharedBook = {
    id: bookId,
    name: name.trim() || 'Mon foyer',
    ownerUid: user.uid,
    memberUids: [user.uid],
    members: { [user.uid]: member },
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(doc(db, 'recettes_books', bookId), cleanForFirestore(bookData));

  if (recipesToCopy.length > 0) {
    const bookColRef = collection(db, 'recettes_books', bookId, 'recipes');
    const userColRef = collection(db, 'recettes_users', user.uid, 'recipes');
    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();
    const ops: BatchOp[] = [];

    for (const item of recipesToCopy) {
      if (!item || !item.id) continue;
      const id = String(item.id);
      const normTitle = normalizeRecipeTitle(item.title || '');
      if (seenIds.has(id) || (normTitle && seenTitles.has(normTitle))) {
        continue;
      }
      seenIds.add(id);
      if (normTitle) seenTitles.add(normTitle);

      const stamped = stampRecipeOwnership(item, user.uid, displayName);
      const payload = prepareRecipeForFirestore(stamped);
      ops.push({ type: 'set', ref: doc(bookColRef, id), data: payload });
      ops.push({ type: 'set', ref: doc(userColRef, id), data: payload });
    }

    await commitOpsInBatches(ops);
  }

  const settingsRef = doc(db, 'recettes_users', user.uid, 'settings', 'main');
  await setDoc(
    settingsRef,
    cleanForFirestore({ id: 'main', activeBookId: bookId, updatedAt: now }),
    { merge: true }
  );

  return bookId;
}

export interface JoinFoyerResult {
  bookId: string;
  addedCount: number;
  skippedCount: number;
}

export async function joinSharedBook(
  code: string,
  localRecipes: Recipe[] = []
): Promise<JoinFoyerResult> {
  const user = getFirebaseUser();
  if (!db || !user) {
    throw new Error('Connectez-vous au Cloud pour rejoindre un foyer.');
  }

  const bookId = code.trim().toUpperCase();
  if (!bookId) {
    throw new Error('Veuillez saisir un code de foyer.');
  }

  const bookRef = doc(db, 'recettes_books', bookId);
  const snap = await getDoc(bookRef);
  if (!snap.exists()) {
    throw new Error('Aucun foyer trouvé avec ce code.');
  }

  const now = new Date().toISOString();
  const displayName = getUserDisplayLabel(user);
  const member: SharedBookMember = {
    uid: user.uid,
    displayName,
    email: user.email ?? undefined,
    joinedAt: now,
  };

  // Rejoindre le foyer d'abord pour que les règles Firestore autorisent la lecture/écriture dans le foyer
  await updateDoc(bookRef, {
    memberUids: arrayUnion(user.uid),
    [`members.${user.uid}`]: cleanForFirestore(member),
    updatedAt: now,
  });

  // Récupérer les recettes personnelles de l'utilisateur (Cloud + locales éventuelles)
  const userColRef = collection(db, 'recettes_users', user.uid, 'recipes');
  const userSnap = await getDocs(userColRef);
  const personalById = new Map<string, Recipe>();
  for (const d of userSnap.docs) {
    const rec = normalizeRecipeFromFirestore(d.data() as Record<string, unknown>, d.id);
    personalById.set(rec.id, rec);
  }
  for (const r of localRecipes) {
    if (r && r.id && isRecipeOwnedBy(r, user.uid) && !personalById.has(String(r.id))) {
      personalById.set(String(r.id), { ...r, id: String(r.id) });
    }
  }

  // Récupérer les recettes déjà présentes dans le foyer pour éviter les doublons
  const bookColRef = collection(db, 'recettes_books', bookId, 'recipes');
  const bookRecipesSnap = await getDocs(bookColRef);
  const existingIds = new Set<string>();
  const existingTitles = new Set<string>();
  for (const d of bookRecipesSnap.docs) {
    existingIds.add(d.id);
    const data = d.data() as Record<string, unknown>;
    if (typeof data.title === 'string') {
      const norm = normalizeRecipeTitle(data.title);
      if (norm) existingTitles.add(norm);
    }
  }

  const ops: BatchOp[] = [];
  let addedCount = 0;
  let skippedCount = 0;

  for (const rec of personalById.values()) {
    const id = String(rec.id);
    const normTitle = normalizeRecipeTitle(rec.title || '');
    if (existingIds.has(id) || (normTitle && existingTitles.has(normTitle))) {
      skippedCount += 1;
      continue;
    }
    existingIds.add(id);
    if (normTitle) existingTitles.add(normTitle);

    const stamped = stampRecipeOwnership(rec, user.uid, displayName);
    const payload = prepareRecipeForFirestore(stamped);
    ops.push({ type: 'set', ref: doc(bookColRef, id), data: payload });
    ops.push({ type: 'set', ref: doc(userColRef, id), data: payload });
    addedCount += 1;
  }

  await commitOpsInBatches(ops);

  const settingsRef = doc(db, 'recettes_users', user.uid, 'settings', 'main');
  await setDoc(
    settingsRef,
    cleanForFirestore({ id: 'main', activeBookId: bookId, updatedAt: now }),
    { merge: true }
  );

  return { bookId, addedCount, skippedCount };
}

export async function leaveSharedBook(): Promise<void> {
  const user = getFirebaseUser();
  if (!db || !user) return;

  const bookId = cloudState.activeBookId;
  const now = new Date().toISOString();

  if (bookId) {
    const bookRef = doc(db, 'recettes_books', bookId);
    const bookColRef = collection(db, 'recettes_books', bookId, 'recipes');
    const userColRef = collection(db, 'recettes_users', user.uid, 'recipes');

    const [bookSnap, bookRecipesSnap] = await Promise.all([
      getDoc(bookRef),
      getDocs(bookColRef),
    ]);

    const bookOwnerUid = bookSnap.exists()
      ? String((bookSnap.data() as Record<string, unknown>).ownerUid || '')
      : '';

    const ops: BatchOp[] = [];
    for (const d of bookRecipesSnap.docs) {
      const data = d.data() as Record<string, unknown>;
      const docOwner = typeof data.ownerUid === 'string' ? data.ownerUid : null;
      const isMine =
        docOwner === user.uid || (!docOwner && bookOwnerUid === user.uid);
      if (isMine) {
        // S'assurer que la recette reste bien sauvegardée dans le carnet personnel
        const rec = normalizeRecipeFromFirestore(data, d.id);
        ops.push({
          type: 'set',
          ref: doc(userColRef, d.id),
          data: prepareRecipeForFirestore(
            stampRecipeOwnership(rec, user.uid, getUserDisplayLabel(user))
          ),
        });
        ops.push({ type: 'delete', ref: d.ref });
      }
    }

    await commitOpsInBatches(ops);

    if (bookSnap.exists()) {
      const bData = bookSnap.data() as Record<string, unknown>;
      const memberUids = Array.isArray(bData.memberUids)
        ? (bData.memberUids as string[])
        : [];
      const remaining = memberUids.filter((id) => id !== user.uid);
      if (remaining.length === 0) {
        await deleteDoc(bookRef);
      } else {
        await updateDoc(bookRef, {
          memberUids: arrayRemove(user.uid),
          [`members.${user.uid}`]: deleteField(),
          updatedAt: now,
        });
      }
    }
  }

  const settingsRef = doc(db, 'recettes_users', user.uid, 'settings', 'main');
  await setDoc(
    settingsRef,
    cleanForFirestore({ id: 'main', activeBookId: null, updatedAt: now }),
    { merge: true }
  );
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
