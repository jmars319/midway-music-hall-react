import React, { useState, useEffect } from 'react';
import HomePage from './pages/HomePage';
import SinglePageLanding from './SinglePageLanding';
import LoginPage from './pages/LoginPage';
import AdminPanel from './admin/AdminPanel';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import GatheringPlacePage from './pages/GatheringPlacePage';

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
const SESSION_DURATION_HOURS = 12;
const SESSION_DURATION_MS = SESSION_DURATION_HOURS * 60 * 60 * 1000;

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

export default function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'login' | 'admin'
  // App entry: wires up routes and provides a shared API_BASE constant
  // Keep this file minimal; most UI is in components/ and admin/
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // On mount, try to rehydrate auth from localStorage so admin stays logged in
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('mmh_user');
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (!stored || !stored.email) {
        localStorage.removeItem('mmh_user');
        return;
      }
      const normalizedExpires = stored.expires_at ? Number(stored.expires_at) : Date.now() + SESSION_DURATION_MS;
      if (normalizedExpires <= Date.now()) {
        localStorage.removeItem('mmh_user');
        return;
      }
      const normalizedUser = { ...stored, expires_at: normalizedExpires };
      localStorage.setItem('mmh_user', JSON.stringify(normalizedUser));
      setIsAuthenticated(true);
      setCurrentUser(normalizedUser);
    } catch (err) {
      localStorage.removeItem('mmh_user');
      console.error('Failed to rehydrate auth from localStorage', err);
    }
  }, []);

  const persistSessionUser = (user) => {
    const payload = { ...user, expires_at: Date.now() + SESSION_DURATION_MS };
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('mmh_user', JSON.stringify(payload));
      } catch (err) {
        console.warn('Unable to persist user to localStorage', err);
      }
    }
    return payload;
  };

  const handleLogin = (user) => {
    const payload = persistSessionUser(user);
    setIsAuthenticated(true);
    setCurrentUser(payload);
    setCurrentView('admin');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('mmh_user');
      } catch (err) {
        console.warn('Unable to clear localStorage during logout', err);
      }
    }
    setCurrentView('home');
  };

  useEffect(() => {
    if (!isAuthenticated || !currentUser?.expires_at) return;
    const remaining = currentUser.expires_at - Date.now();
    if (remaining <= 0) {
      handleLogout();
      return;
    }
    const timeout = setTimeout(() => {
      alert('Your admin session expired. Please log in again.');
      handleLogout();
    }, remaining);
    return () => clearTimeout(timeout);
  }, [isAuthenticated, currentUser?.expires_at]);

  const navigateToLogin = () => setCurrentView('login');
  const navigateToHome = () => setCurrentView('home');
  const navigateToPrivacy = () => setCurrentView('privacy');
  const navigateToTerms = () => setCurrentView('terms');

  const handleNavigate = (page) => {
    if (page === 'privacy') navigateToPrivacy();
    else if (page === 'terms') navigateToTerms();
    else navigateToHome();
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
  const isGatheringPlaceRoute = pathname.toLowerCase() === '/thegatheringplace';

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

  if (isGatheringPlaceRoute && currentView === 'home') {
    return (
      <GatheringPlacePage
        onAdminClick={navigateToAdmin}
        onNavigate={handleNavigate}
      />
    );
  }

  // Default to the full public site `HomePage`. `SinglePageLanding` is
  // kept for the temporary landing mode but should not be the default.
  return (
    <HomePage
      onAdminClick={navigateToAdmin}
      onNavigate={handleNavigate}
    />
  );
}
