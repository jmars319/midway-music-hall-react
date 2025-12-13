// AdminPanel: top-level admin container and navigation for admin modules
import React, { useState, useEffect } from 'react';
import {
  DashboardModule,
  EventsModule,
  LayoutsModule,
  SeatRequestsModule,
  SuggestionsModule,
  MediaManager,
  SettingsModule,
} from './index';
import { API_BASE, SERVER_BASE } from '../App';
import ResponsiveImage from '../components/ResponsiveImage';

const MENU = [
  { key: 'dashboard', label: 'Dashboard', comp: DashboardModule },
  { key: 'events', label: 'Events', comp: EventsModule },
  { key: 'layouts', label: 'Seating Layouts', comp: LayoutsModule },
  { key: 'requests', label: 'Seat Requests', comp: SeatRequestsModule },
  { key: 'suggestions', label: 'Suggestions', comp: SuggestionsModule },
  { key: 'media', label: 'Media', comp: MediaManager },
  { key: 'settings', label: 'Settings', comp: SettingsModule },
];

export default function AdminPanel({ user = null, onLogout = () => {}, onBackToSite = () => {} }){
  const [active, setActive] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [logo, setLogo] = useState('/logo.png');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState({ type: '', text: '' });
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    next: '',
    confirm: ''
  });
  const sidebarAvatar = '/apple-touch-icon.png';
  const resolveDisplayName = () => {
    if (!user) return 'Admin';
    if (user.display_name) return user.display_name;
    if (user.name) return user.name;
    if (user.username) return user.username;
    if (user.email) {
      const prefix = user.email.split('@')[0] || 'Admin';
      if (user.email.toLowerCase().startsWith('admin@')) {
        return 'Admin';
      }
      return prefix;
    }
    return 'Admin';
  };

  useEffect(() => {
    fetch(`${SERVER_BASE}/api/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings && data.settings.site_logo) {
          setLogo(SERVER_BASE + data.settings.site_logo);
        }
      })
      .catch(err => console.error('Failed to load logo:', err));
  }, []);

  const ActiveComponent = (MENU.find(m => m.key === active) || MENU[0]).comp;
  const displayName = resolveDisplayName();
  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPasswordVisible(false);
    setPasswordMessage({ type: '', text: '' });
    setPasswordForm({ current: '', next: '', confirm: '' });
  };

  const handlePasswordSubmit = async (evt) => {
    evt.preventDefault();
    if (passwordSaving) return;
    setPasswordSaving(true);
    setPasswordMessage({ type: '', text: '' });
    try {
      const res = await fetch(`${API_BASE}/admin/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          current_password: passwordForm.current,
          new_password: passwordForm.next,
          confirm_password: passwordForm.confirm,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to change password');
      }
      setPasswordMessage({ type: 'success', text: data.message || 'Password updated successfully.' });
      setPasswordForm({ current: '', next: '', confirm: '' });
      setPasswordVisible(false);
    } catch (err) {
      setPasswordMessage({ type: 'error', text: err.message || 'Failed to change password.' });
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <aside className={`flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'} overflow-hidden`}>
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setActive('dashboard')}
                      aria-label="Go to dashboard"
                      className="flex items-center space-x-2 bg-transparent border-0 p-0"
                    >
                      <ResponsiveImage
                        src={logo}
                        alt="Midway Music Hall"
                        width={collapsed ? 64 : 96}
                        height={collapsed ? 64 : 96}
                        priority
                        className={`${collapsed ? 'h-8' : 'h-10'} w-auto transition-all duration-200 object-contain`}
                      />
                      {!collapsed && <div className="text-lg font-semibold">Midway Admin</div>}
                    </button>
            </div>
            <button
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-900"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>

          <nav className="flex-1 px-1 py-3 overflow-y-auto min-h-0">
            {MENU.map(item => (
              <button
                key={item.key}
                onClick={() => setActive(item.key)}
                className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 ${active === item.key ? 'bg-gray-100 dark:bg-gray-900' : ''}`}
              >
                <span className="w-5 text-center text-sm opacity-80">{item.label.slice(0,1)}</span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </button>
            ))}
          </nav>

          <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0">
            <div className="flex flex-col items-stretch gap-4">
              <div className="flex flex-col items-stretch gap-2 w-full">
                <button
                  onClick={onBackToSite}
                  className={`w-full px-3 py-2 text-sm rounded ${collapsed ? 'flex justify-center' : 'text-left'} bg-gray-200 dark:bg-gray-800 hover:bg-gray-300`}
                >
                  {!collapsed ? 'Back to site' : '↩'}
                </button>

                <button
                  onClick={() => setShowPasswordModal(true)}
                  className={`w-full px-3 py-2 text-sm rounded ${collapsed ? 'flex justify-center' : 'text-left'} bg-purple-600/90 text-white hover:bg-purple-700`}
                >
                  {!collapsed ? 'Change password' : '●●●'}
                </button>

                <button
                  onClick={onLogout}
                  className={`w-full px-3 py-2 text-sm rounded ${collapsed ? 'flex justify-center' : 'text-left'} bg-red-600 text-white hover:bg-red-700`}
                >
                  {!collapsed ? 'Logout' : '⏻'}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <ResponsiveImage
                  src={sidebarAvatar}
                  alt="Midway Music Hall"
                  width={48}
                  height={48}
                  priority
                  className="w-9 h-9 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800 object-cover"
                />
                {!collapsed && (
                  <div className="flex-1">
                    <div className="text-sm font-medium">{displayName}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Signed in</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-0 bg-gray-50 dark:bg-gray-900">
        <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold">{(MENU.find(m => m.key === active) || MENU[0]).label}</h1>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">Signed in as <span className="font-medium">{displayName}</span></div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <section className="bg-white dark:bg-gray-950 rounded-lg shadow-sm p-4">
            <ActiveComponent />
          </section>
        </div>
      </main>

      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4 py-6">
          <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-purple-500/30 max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold">Change Password</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Update the credentials for {displayName}.</p>
              </div>
              <button
                aria-label="Close change password"
                onClick={closePasswordModal}
                className="text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <form className="space-y-4" onSubmit={handlePasswordSubmit}>
              {passwordMessage.text && (
                <div className={`p-3 rounded-md text-sm ${passwordMessage.type === 'success' ? 'bg-green-500/15 border border-green-500/40 text-green-200' : 'bg-red-500/15 border border-red-500/40 text-red-200'}`}>
                  {passwordMessage.text}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Current password</label>
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  value={passwordForm.current}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, current: e.target.value }))}
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  required
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">New password</label>
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  value={passwordForm.next}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, next: e.target.value }))}
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  required
                  autoComplete="new-password"
                  minLength={10}
                />
                <p className="text-xs text-gray-500 mt-1">Minimum 10 characters. Use a mix of letters, numbers, and symbols.</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Confirm new password</label>
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirm: e.target.value }))}
                  className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  required
                  autoComplete="new-password"
                  minLength={10}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={passwordVisible}
                  onChange={(e) => setPasswordVisible(e.target.checked)}
                />
                Show passwords
              </label>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="px-4 py-2 rounded border border-gray-300 dark:border-gray-700 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="px-4 py-2 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60"
                >
                  {passwordSaving ? 'Saving…' : 'Update password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
