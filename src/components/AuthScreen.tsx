import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  Shield,
  X,
} from 'lucide-react';
import {
  connexionEmail,
  connexionGoogle,
  db,
  inscriptionEmail,
  reinitialiserMotDePasseEmail,
} from '../lib/firebase';
import { CloudState } from '../utils/storage';
import { resolveUserAccess, type AccessStatus } from '../lib/accessControl';
import { AccessControlPanel } from './AccessControlPanel';

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const message = (err as { message?: string })?.message ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou mot de passe incorrect.';
    case 'auth/invalid-email':
      return 'Adresse e-mail invalide.';
    case 'auth/email-already-in-use':
      return 'Un compte existe déjà avec cette adresse e-mail.';
    case 'auth/weak-password':
      return 'Le mot de passe doit contenir au moins 6 caractères.';
    case 'auth/too-many-requests':
      return 'Trop de tentatives. Réessayez dans quelques minutes.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Connexion Google annulée.';
    case 'auth/popup-blocked':
      return 'La fenêtre Google a été bloquée par le navigateur. Autorisez les popups pour ce site.';
    case 'auth/unauthorized-domain':
      return 'Ce domaine n’est pas autorisé dans la console Firebase.';
    default:
      return message || `Erreur de connexion (${code || 'inconnue'}).`;
  }
}

export interface CloudAuthModalProps {
  user: User | null;
  cloudState: CloudState;
  recipesCount: number;
  onForceSync: () => Promise<void>;
  onRestartSync?: () => Promise<void>;
  onUserReloaded?: (user: User | null) => void;
  onSignOut: () => Promise<void>;
  onClose: () => void;
}

export const CloudAuthModal: React.FC<CloudAuthModalProps> = ({
  user,
  cloudState,
  recipesCount,
  onForceSync,
  onSignOut,
  onClose,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [localSyncError, setLocalSyncError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'account' | 'access'>('account');
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);

  useEffect(() => {
    if (!user?.email) {
      setAccessStatus(null);
      setActiveTab('account');
      return;
    }
    let cancelled = false;
    resolveUserAccess(db, 'livre-recettes', user.email, user.uid).then((status) => {
      if (!cancelled) {
        setAccessStatus(status);
        if (!status.isAdmin) setActiveTab('account');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user?.email, user?.uid]);

  const handleEmailAuth = async (isRegister: boolean) => {
    setError(null);
    setInfo(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Veuillez saisir votre adresse e-mail.');
      return;
    }
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    setBusy(true);
    try {
      if (isRegister) {
        await inscriptionEmail(trimmed, password);
      } else {
        await connexionEmail(trimmed, password);
      }
      onClose();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async () => {
    setError(null);
    setInfo(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Saisissez votre adresse e-mail ci-dessus pour réinitialiser le mot de passe.');
      return;
    }
    setBusy(true);
    try {
      await reinitialiserMotDePasseEmail(trimmed);
      setInfo('Un e-mail de réinitialisation vient d’être envoyé.');
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await connexionGoogle();
      onClose();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForceSync = async () => {
    setLocalSyncError(null);
    setBusy(true);
    try {
      await onForceSync();
    } catch (err) {
      setLocalSyncError(
        err instanceof Error ? err.message : 'Impossible de synchroniser.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Se déconnecter du compte Cloud ?')) return;
    await onSignOut();
    onClose();
  };

  let statusLabel = 'Connexion au Cloud…';
  let statusColorClass = 'text-stone-500';
  if (cloudState.syncStatus === 'syncing') {
    statusLabel = 'Synchronisation en cours…';
    statusColorClass = 'text-amber-600 font-semibold';
  } else if (cloudState.syncStatus === 'error') {
    statusLabel = 'Erreur de synchronisation';
    statusColorClass = 'text-red-600 font-semibold';
  } else if (cloudState.initialSyncDone || cloudState.syncStatus === 'synced') {
    statusLabel = `Synchronisé (${recipesCount} recette${recipesCount > 1 ? 's' : ''})`;
    statusColorClass = 'text-fresh-700 font-semibold';
  }

  const displayedSyncError = localSyncError || cloudState.syncError;

  return (
    <div
      id="modal-auth"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-stone-200 pb-3">
          <div className="flex min-w-0 items-center gap-2 font-display text-lg font-bold text-stone-900">
            <Cloud className="h-5 w-5 shrink-0 text-fresh-600" />
            <span className="truncate">Compte Cloud Carnet HelloFresh</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="Fermer la fenêtre Cloud"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!user ? (
          <div id="auth-logged-out-panel" className="space-y-4">
            <p className="text-xs leading-relaxed text-stone-500">
              Connectez-vous pour accéder à votre carnet de recettes et synchroniser votre planning
              hebdomadaire entre tous vos appareils.
            </p>

            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-xs font-bold text-stone-700">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom@exemple.fr"
                  disabled={busy}
                  className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-fresh-500 focus:outline-none focus:ring-2 focus:ring-fresh-500/20"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                <label
                  htmlFor="auth-password"
                  className="text-xs font-bold text-stone-700"
                >
                  Mot de passe (6 car. min)
                </label>
                <button
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={busy}
                  className="text-xs font-semibold text-fresh-700 hover:underline"
                >
                  Mot de passe oublié ?
                </button>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  id="auth-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleEmailAuth(false);
                    }
                  }}
                  className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-fresh-500 focus:outline-none focus:ring-2 focus:ring-fresh-500/20"
                />
              </div>
            </div>

            {error && (
              <div
                id="auth-error-msg"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {info && (
              <div className="flex items-start gap-2 rounded-xl border border-fresh-200 bg-fresh-50 px-3.5 py-2.5 text-xs font-semibold text-fresh-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{info}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleEmailAuth(false)}
                className="w-full rounded-xl bg-fresh-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-fresh-600/20 transition-all hover:bg-fresh-700 disabled:opacity-60"
              >
                Se connecter
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleEmailAuth(true)}
                className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-bold text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-60"
              >
                Créer un compte
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGoogleSignIn()}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-800 transition-colors hover:bg-stone-50 disabled:opacity-60"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                  />
                </svg>
                Continuer avec Google
              </button>
            </div>
          </div>
        ) : (
          <div id="auth-logged-in-panel" className="space-y-4">
            {accessStatus?.isAdmin && (
              <div className="flex gap-1.5 rounded-xl bg-stone-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('account')}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'account'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Compte Cloud
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('access')}
                  className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    activeTab === 'access'
                      ? 'bg-white text-sky-700 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Accès &amp; Rôles
                </button>
              </div>
            )}

            {accessStatus && !accessStatus.hasAppAccess && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-medium text-red-700">
                Votre compte n&apos;est pas autorisé sur cette application. Contactez un administrateur.
              </div>
            )}

            {activeTab === 'access' && accessStatus?.isAdmin ? (
              <AccessControlPanel
                db={db}
                user={user}
                appId="livre-recettes"
                appName="Livre de Recettes"
                theme="light"
              />
            ) : (
              <>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-stone-500">
                Connecté en tant que
              </div>
              <div
                id="auth-connected-email"
                className="mt-0.5 break-all text-sm font-bold text-stone-900"
              >
                {user.email || user.displayName || user.uid}
              </div>
              <div id="auth-sync-status" className={`mt-1.5 text-xs ${statusColorClass}`}>
                {statusLabel}
              </div>
            </div>

            {displayedSyncError && (
              <div
                id="auth-sync-error-msg"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{displayedSyncError}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                id="btn-force-sync"
                disabled={busy}
                onClick={() => void handleForceSync()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-fresh-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-fresh-600/20 transition-all hover:bg-fresh-700 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                Synchroniser maintenant
              </button>

              <button
                type="button"
                onClick={() => void handleDisconnect()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 transition-colors hover:bg-red-100"
              >
                <LogOut className="h-4 w-4" />
                Se déconnecter
              </button>
            </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export interface AuthGateScreenProps {
  mode: 'loading' | 'unauthenticated' | 'unauthorized';
  userEmail?: string | null;
  onSignOut: () => Promise<void>;
  onRetryAccess?: () => Promise<void>;
}

export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({
  mode,
  userEmail,
  onSignOut,
  onRetryAccess,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleEmailAuth = async (isRegister: boolean) => {
    setError(null);
    setInfo(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Veuillez saisir votre adresse e-mail.');
      return;
    }
    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    setBusy(true);
    try {
      if (isRegister) {
        await inscriptionEmail(trimmed, password);
      } else {
        await connexionEmail(trimmed, password);
      }
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordReset = async () => {
    setError(null);
    setInfo(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Saisissez votre adresse e-mail ci-dessus pour réinitialiser le mot de passe.');
      return;
    }
    setBusy(true);
    try {
      await reinitialiserMotDePasseEmail(trimmed);
      setInfo('Un e-mail de réinitialisation vient d’être envoyé.');
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await connexionGoogle();
    } catch (err) {
      setError(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-fresh-600 border-t-transparent" />
        <p className="mt-4 text-sm font-medium text-stone-600">
          Vérification de votre accès…
        </p>
      </div>
    );
  }

  if (mode === 'unauthorized') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
        <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-stone-900">
                Accès non autorisé
              </h1>
              <p className="text-xs text-stone-500">Carnet HelloFresh</p>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs leading-relaxed text-red-800">
            <p className="font-semibold">
              Votre compte n&apos;est pas autorisé à accéder à cette application.
            </p>
            {userEmail && (
              <p className="mt-1.5 break-all text-red-700">
                Compte connecté : <span className="font-bold">{userEmail}</span>
              </p>
            )}
            <p className="mt-1.5 text-red-700/90">
              Contactez un administrateur pour demander l&apos;accès ou connectez-vous avec un autre
              compte autorisé.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {onRetryAccess && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onRetryAccess();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-800 transition-colors hover:bg-stone-50 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                Vérifier à nouveau
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onSignOut();
                } finally {
                  setBusy(false);
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              Se déconnecter / Changer de compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3 border-b border-stone-200 pb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fresh-50 text-fresh-600">
            <Cloud className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-stone-900">
              Carnet HelloFresh
            </h1>
            <p className="text-xs text-stone-500">
              Connexion requise pour accéder à l&apos;application
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="gate-auth-email" className="mb-1.5 block text-xs font-bold text-stone-700">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                id="gate-auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom@exemple.fr"
                disabled={busy}
                className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-fresh-500 focus:outline-none focus:ring-2 focus:ring-fresh-500/20"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
              <label
                htmlFor="gate-auth-password"
                className="text-xs font-bold text-stone-700"
              >
                Mot de passe (6 car. min)
              </label>
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={busy}
                className="text-xs font-semibold text-fresh-700 hover:underline"
              >
                Mot de passe oublié ?
              </button>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                id="gate-auth-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleEmailAuth(false);
                  }
                }}
                className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-fresh-500 focus:outline-none focus:ring-2 focus:ring-fresh-500/20"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="flex items-start gap-2 rounded-xl border border-fresh-200 bg-fresh-50 px-3.5 py-2.5 text-xs font-semibold text-fresh-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{info}</span>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleEmailAuth(false)}
              className="w-full rounded-xl bg-fresh-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-fresh-600/20 transition-all hover:bg-fresh-700 disabled:opacity-60"
            >
              Se connecter
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleEmailAuth(true)}
              className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm font-bold text-stone-800 transition-colors hover:bg-stone-100 disabled:opacity-60"
            >
              Créer un compte
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleGoogleSignIn()}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-800 transition-colors hover:bg-stone-50 disabled:opacity-60"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              Continuer avec Google
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
