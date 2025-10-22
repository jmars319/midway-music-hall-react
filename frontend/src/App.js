import React, { useState } from 'react';
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

  const handleLogin = (user) => {
    setIsAuthenticated(true);
    setCurrentUser(user);
    setCurrentView('admin');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setCurrentView('home');
  };

  const navigateToLogin = () => setCurrentView('login');
  const navigateToHome = () => setCurrentView('home');

  if (currentView === 'login') {
    return <LoginPage onLogin={handleLogin} onBack={navigateToHome} />;
  }

  if (currentView === 'admin' && isAuthenticated) {
    return <AdminPanel user={currentUser} onLogout={handleLogout} onBackToSite={navigateToHome} />;
  }

  return <HomePage onAdminClick={navigateToLogin} />;
}
