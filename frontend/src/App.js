import React, { useState, useEffect } from 'react';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import AdminPanel from './admin/AdminPanel';

export const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5001/api';

export default function App() {
  const [currentView, setCurrentView] = useState('home'); // 'home' | 'login' | 'admin'
  // App entry: wires up routes and provides a shared API_BASE constant
  // Keep this file minimal; most UI is in components/ and admin/
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // On mount, try to rehydrate auth from localStorage so admin stays logged in
  useEffect(() => {
    try {
      const raw = localStorage.getItem('mmh_user');
      if (raw) {
        const user = JSON.parse(raw);
        if (user && user.email) {
          setIsAuthenticated(true);
          setCurrentUser(user);
        }
      }
    } catch (err) {
      // if parsing fails, clear the bad key
      localStorage.removeItem('mmh_user');
      console.error('Failed to rehydrate auth from localStorage', err);
    }
  }, []);

  const handleLogin = (user) => {
    setIsAuthenticated(true);
    setCurrentUser(user);
    try {
      localStorage.setItem('mmh_user', JSON.stringify(user));
    } catch (err) {
      console.warn('Unable to persist user to localStorage', err);
    }
    setCurrentView('admin');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    try {
      localStorage.removeItem('mmh_user');
    } catch (err) {
      console.warn('Unable to clear localStorage during logout', err);
    }
    setCurrentView('home');
  };

  const navigateToLogin = () => setCurrentView('login');
  const navigateToHome = () => setCurrentView('home');

  // When the user clicks the Admin button from the public site, if we
  // already have a persisted authenticated admin, go straight to admin.
  const navigateToAdmin = () => {
    if (isAuthenticated) {
      setCurrentView('admin');
    } else {
      setCurrentView('login');
    }
  };

  if (currentView === 'login') {
    return <LoginPage onLogin={handleLogin} onBack={navigateToHome} />;
  }

  if (currentView === 'admin' && isAuthenticated) {
    return <AdminPanel user={currentUser} onLogout={handleLogout} onBackToSite={navigateToHome} />;
  }

  return <HomePage onAdminClick={navigateToAdmin} />;
}
