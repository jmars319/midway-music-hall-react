import React, { useState, useEffect, useCallback } from 'react';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import AdminPanel from './admin/AdminPanel';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import GatheringPlacePage from './pages/GatheringPlacePage';
import ArchivePage from './pages/ArchivePage';

const resolveDefaultApiBase = () => {
  if (process.env.REACT_APP_API_BASE) {
    return process.env.REACT_APP_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location) {
    const { origin, protocol, hostname } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (origin && origin !== 'null' && protocol !== 'file:' && !isLocalHost) {
      return `${origin.replace(/\/$/, '')}/api`;
    }
  }
  // Default local Dev API
  return 'http://localhost:5001/api';
};

const normalizeApiBase = (value) => {
  if (!value) return '/api';
  return value.replace(/\/+$/, '');
};

const defaultApiBase = normalizeApiBase(resolveDefaultApiBase());
export const API_BASE = defaultApiBase;
const resolvedServer = defaultApiBase.endsWith('/api')
  ? defaultApiBase.slice(0, -4) || ''
  : defaultApiBase;
export const SERVER_BASE = resolvedServer || (typeof window !== 'undefined' && window.location && window.location.origin !== 'null'
  ? window.location.origin
  : '');
const DEFAULT_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days hard expiry
const DEFAULT_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hour idle timeout
const ACTIVITY_EVENTS = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];

// Cache for settings to avoid repeated fetches
let settingsCache = null;
let settingsFetchPromise = null;

const fetchSettings = async () => {
  if (settingsCache) return settingsCache;
  if (settingsFetchPromise) return settingsFetchPromise;
  
  settingsFetchPromise = fetch(`${API_BASE}/settings`)
    .then(res => res.json())
    .then(data => {
      if (data.success && data.settings) {
        settingsCache = data.settings;
        return data.settings;
      }
      return {};
    })
    .catch(() => ({}));
  
  return settingsFetchPromise;
};

// Helper to get full image URL
export const getImageUrl = async (imageUrl) => {
  if (!imageUrl) {
    const settings = await fetchSettings();
    return settings.default_event_image ? `${SERVER_BASE}${settings.default_event_image}` : '/android-chrome-192x192.png';
  }
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  if (imageUrl.startsWith('/uploads/')) return `${SERVER_BASE}${imageUrl}`;
  return imageUrl;
};

// Synchronous version for backwards compatibility
export const getImageUrlSync = (imageUrl) => {
  if (!imageUrl) return '/android-chrome-192x192.png';
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  if (imageUrl.startsWith('/uploads/')) return `${SERVER_BASE}${imageUrl}`;
  return imageUrl;
};

const persistUserToStorage = (payload) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('mmh_user', JSON.stringify(payload));
  } catch (err) {
    console.warn('Unable to persist user to localStorage', err);
  }
};

const removeStoredUser = () => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('mmh_user');
  } catch (err) {
    console.warn('Unable to clear stored user', err);
  }
};

const normalizeStoredUser = (stored) => {
  if (!stored) return null;
  const expiresAt = typeof stored.expires_at === 'number' ? stored.expires_at : Date.parse(stored.expires_at);
  if (!expiresAt || Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }
  const idleTimeout = stored.idle_timeout_ms || (stored.idle_timeout_seconds ? stored.idle_timeout_seconds * 1000 : DEFAULT_IDLE_TIMEOUT_MS);
  return {
    ...stored,
    expires_at: expiresAt,
    idle_timeout_ms: idleTimeout,
    last_active_at: stored.last_active_at || Date.now(),
  };
};

const buildSessionPayload = (user, sessionMeta = {}) => {
  if (!user) return null;
  const expiresRaw = sessionMeta.expires_at || sessionMeta.expiresAt || user.expires_at;
  const expiresAt = typeof expiresRaw === 'number' ? expiresRaw : Date.parse(expiresRaw || '');
  const idleTimeoutMs = sessionMeta.idle_timeout_ms
    || (sessionMeta.idle_timeout_seconds ? sessionMeta.idle_timeout_seconds * 1000 : null)
    || user.idle_timeout_ms
    || DEFAULT_IDLE_TIMEOUT_MS;
  const resolvedExpiry = expiresAt && !Number.isNaN(expiresAt) ? expiresAt : (Date.now() + DEFAULT_SESSION_DURATION_MS);
  return {
    ...user,
    expires_at: resolvedExpiry,
    idle_timeout_ms: idleTimeoutMs,
    last_active_at: Date.now(),
  };
};

export default function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'login' | 'admin'
  // App entry: wires up routes and provides a shared API_BASE constant
  // Keep this file minimal; most UI is in components/ and admin/
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const resetSessionState = useCallback(() => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    removeStoredUser();
  }, []);

  // On mount, try to rehydrate auth from localStorage so admin stays logged in
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('mmh_user');
      if (!raw) return;
      const stored = JSON.parse(raw);
      const normalizedUser = normalizeStoredUser(stored);
      if (!normalizedUser) {
        removeStoredUser();
        return;
      }
      persistUserToStorage(normalizedUser);
      setIsAuthenticated(true);
      setCurrentUser(normalizedUser);
    } catch (err) {
      removeStoredUser();
      console.error('Failed to rehydrate auth from localStorage', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const verifySession = async () => {
      try {
        const res = await fetch(`${API_BASE}/session`, { credentials: 'include' });
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            resetSessionState();
          }
          return;
        }
        const data = await res.json();
        if (cancelled || !data.success) return;
        if (data.authenticated && data.user) {
          const payload = persistSessionUser(data.user, data.session);
          if (payload) {
            setIsAuthenticated(true);
            setCurrentUser(payload);
          }
        } else {
          resetSessionState();
        }
      } catch (err) {
        console.warn('Session verification failed', err);
      }
    };
    verifySession();
    return () => {
      cancelled = true;
    };
  }, [resetSessionState]);

  const persistSessionUser = (user, sessionMeta) => {
    const payload = buildSessionPayload(user, sessionMeta);
    if (payload) {
      persistUserToStorage(payload);
    }
    return payload;
  };

  const handleLogin = (user, sessionMeta) => {
    const payload = persistSessionUser(user, sessionMeta);
    if (!payload) {
      return;
    }
    setIsAuthenticated(true);
    setCurrentUser(payload);
    setCurrentView('admin');
  };

  const handleLogout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.warn('Failed to notify backend about logout', err);
    }
    resetSessionState();
    setCurrentView('home');
  }, [resetSessionState]);

  useEffect(() => {
    if (!isAuthenticated || !currentUser?.expires_at) return undefined;
    const lastActive = currentUser.last_active_at || Date.now();
    const idleDeadline = lastActive + (currentUser.idle_timeout_ms || DEFAULT_IDLE_TIMEOUT_MS);
    const hardDeadline = currentUser.expires_at;
    const nextExpiry = Math.min(idleDeadline, hardDeadline);
    if (nextExpiry <= Date.now()) {
      alert('Your admin session expired. Please log in again.');
      handleLogout();
      return undefined;
    }
    const timeout = setTimeout(() => {
      alert('Your admin session expired. Please log in again.');
      handleLogout();
    }, nextExpiry - Date.now());
    return () => clearTimeout(timeout);
  }, [isAuthenticated, currentUser?.expires_at, currentUser?.last_active_at, currentUser?.idle_timeout_ms, handleLogout]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let lastRefresh = Date.now();
    const refreshSession = () => {
      const now = Date.now();
      const shouldPing = now - lastRefresh > 60000;
      setCurrentUser((prev) => {
        if (!prev) return prev;
        if (now - (prev.last_active_at || 0) < 15000 && !shouldPing) {
          return prev;
        }
        const updated = { ...prev, last_active_at: now };
        persistUserToStorage(updated);
        return updated;
      });
      if (shouldPing) {
        lastRefresh = now;
        fetch(`${API_BASE}/session/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
          .then((res) => {
            if (!res.ok) {
              if (res.status === 401 || res.status === 403) {
                resetSessionState();
              }
              return null;
            }
            return res.json().catch(() => null);
          })
          .then((data) => {
            if (data && data.user) {
              const payload = persistSessionUser(data.user, data.session);
              if (payload) {
                setIsAuthenticated(true);
                setCurrentUser(payload);
              }
            }
          })
          .catch(() => {});
      }
    };
    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, refreshSession, { passive: true });
    });
    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, refreshSession);
      });
    };
  }, [isAuthenticated, resetSessionState]);

  const navigateToHome = () => setCurrentView('home');
  const navigateToPrivacy = () => setCurrentView('privacy');
  const navigateToTerms = () => setCurrentView('terms');

  const handleNavigate = (page) => {
    if (page === 'privacy') {
      navigateToPrivacy();
    } else if (page === 'terms') {
      navigateToTerms();
    } else if (page === 'archive' && typeof window !== 'undefined') {
      window.location.href = '/archive';
    } else {
      navigateToHome();
    }
  };

  // When the user clicks the Admin button from the public site, if we
  // already have a persisted authenticated admin, go straight to admin.
  const navigateToAdmin = () => {
    if (isAuthenticated) {
      setCurrentView('admin');
    } else {
      setCurrentView('login');
    }
  };

  const pathname = typeof window !== 'undefined'
    ? (window.location.pathname || '/').replace(/\/+$/, '') || '/'
    : '/';
  const normalizedPath = pathname.toLowerCase();
  const isGatheringPlaceRoute = normalizedPath === '/thegatheringplace';
  const isArchiveRoute = normalizedPath === '/archive';

  if (currentView === 'login') {
    return <LoginPage onLogin={handleLogin} onBack={navigateToHome} />;
  }

  if (currentView === 'admin' && isAuthenticated) {
    return <AdminPanel user={currentUser} onLogout={handleLogout} onBackToSite={navigateToHome} />;
  }

  if (currentView === 'privacy') {
    return <PrivacyPolicy onAdminClick={navigateToAdmin} />;
  }

if (currentView === 'terms') {
  return <TermsOfService onAdminClick={navigateToAdmin} />;
}

if (isArchiveRoute && currentView === 'home') {
  return (
    <ArchivePage
      onAdminClick={navigateToAdmin}
      onNavigate={handleNavigate}
    />
  );
}

if (isGatheringPlaceRoute && currentView === 'home') {
  return (
    <GatheringPlacePage
      onAdminClick={navigateToAdmin}
      onNavigate={handleNavigate}
      />
    );
  }

  // Default to the full public site `HomePage`.
  return (
    <HomePage
      onAdminClick={navigateToAdmin}
      onNavigate={handleNavigate}
    />
  );
}
