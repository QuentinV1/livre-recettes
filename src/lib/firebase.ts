import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  getAuth,
  GoogleAuthProvider,
  Auth,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCuYM0tMpd1f1jDYz27OhCaPpcAWhI3i48',
  authDomain: 'quentin-apps-hub.firebaseapp.com',
  projectId: 'quentin-apps-hub',
  storageBucket: 'quentin-apps-hub.firebasestorage.app',
  messagingSenderId: '249016348389',
  appId: '1:249016348389:web:16a04a526cbe46c59cee0c',
};

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || FIREBASE_CONFIG.apiKey,
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || FIREBASE_CONFIG.authDomain,
  projectId:
    (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || FIREBASE_CONFIG.projectId,
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ||
    FIREBASE_CONFIG.storageBucket,
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) ||
    FIREBASE_CONFIG.messagingSenderId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || FIREBASE_CONFIG.appId,
};

const isFileProtocol =
  typeof window !== 'undefined' && window.location.protocol === 'file:';

export const isFirebaseConfigured = Boolean(
  !isFileProtocol &&
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let currentUser: User | null = null;

if (isFirebaseConfigured) {
  try {
    app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
    const appCheckSiteKey =
      (import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY as string | undefined) ||
      '6LfRaysuAAAAACpC4hKbGG5Bjpr3Ifr1CyUSlmRe';
    if (appCheckSiteKey && typeof window !== 'undefined') {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }
    auth = getAuth(app);
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
      });
    } catch {
      db = getFirestore(app);
    }
  } catch (err) {
    console.warn('Firebase SDK indisponible (mode hors-ligne local):', err);
    app = null;
    auth = null;
    db = null;
  }
}

export const googleProvider = new GoogleAuthProvider();

export function getFirebaseUser(): User | null {
  return auth?.currentUser ?? currentUser;
}

export function estConnecteFirebase(): boolean {
  return Boolean(auth?.currentUser ?? currentUser);
}

export function observerAuth(onUserChanged: (user: User | null) => void): () => void {
  if (!auth) {
    currentUser = null;
    onUserChanged(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    currentUser = user ?? null;
    onUserChanged(currentUser);
  });
}

export async function connexionEmail(email: string, password: string): Promise<User> {
  if (!auth) throw new Error('Firebase indisponible hors-ligne.');
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  currentUser = cred.user;
  return cred.user;
}

export async function inscriptionEmail(email: string, password: string): Promise<User> {
  if (!auth) throw new Error('Firebase indisponible hors-ligne.');
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  currentUser = cred.user;
  if (cred.user) {
    sendEmailVerification(cred.user).catch(() => {});
  }
  return cred.user;
}

export async function reinitialiserMotDePasseEmail(email: string): Promise<void> {
  if (!auth) throw new Error('Firebase indisponible hors-ligne.');
  await sendPasswordResetEmail(auth, email.trim());
}

export async function connexionGoogle(): Promise<User> {
  if (!auth) throw new Error('Firebase indisponible hors-ligne.');
  const cred = await signInWithPopup(auth, googleProvider);
  currentUser = cred.user;
  return cred.user;
}

export async function renvoyerEmailVerification(): Promise<boolean> {
  if (!auth || !auth.currentUser) throw new Error('Aucun utilisateur connecté.');
  if (auth.currentUser.emailVerified) return false;
  await sendEmailVerification(auth.currentUser);
  return true;
}

export async function rechargerUtilisateurFirebase(): Promise<User | null> {
  if (!auth || !auth.currentUser) return null;
  await auth.currentUser.reload();
  currentUser = auth.currentUser;
  return currentUser;
}

export async function deconnexionFirebase(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
  currentUser = null;
}

export { app, auth, db };
