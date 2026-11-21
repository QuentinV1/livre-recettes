import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const QUENTIN_HUB_CONFIG = {
  apiKey: 'AIzaSyCuYM0tMpd1f1jDYz27OhCaPpcAWhI3i48',
  authDomain: 'quentin-apps-hub.firebaseapp.com',
  projectId: 'quentin-apps-hub',
  storageBucket: 'quentin-apps-hub.firebasestorage.app',
  messagingSenderId: '249016348389',
  appId: '1:249016348389:web:59deb2bca6520d029cee0c',
};

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || QUENTIN_HUB_CONFIG.apiKey,
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || QUENTIN_HUB_CONFIG.authDomain,
  projectId:
    (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || QUENTIN_HUB_CONFIG.projectId,
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ||
    QUENTIN_HUB_CONFIG.storageBucket,
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) ||
    QUENTIN_HUB_CONFIG.messagingSenderId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || QUENTIN_HUB_CONFIG.appId,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY as string | undefined;
  if (appCheckSiteKey && typeof window !== 'undefined') {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    db = getFirestore(app);
  }
}

export const googleProvider = new GoogleAuthProvider();
export { app, auth, db };
