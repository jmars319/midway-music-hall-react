// AdminPanel: top-level admin container and navigation for admin modules
import React, { useState } from 'react';
import {
  DashboardModule,
  EventsModule,
  SeatingModule,
  SeatRequestsModule,
  SuggestionsModule,
  SettingsModule,
} from './index';

const MENU = [
  { key: 'dashboard', label: 'Dashboard', comp: DashboardModule },
  { key: 'events', label: 'Events', comp: EventsModule },
  { key: 'seating', label: 'Seating', comp: SeatingModule },
  { key: 'requests', label: 'Seat Requests', comp: SeatRequestsModule },
  { key: 'suggestions', label: 'Suggestions', comp: SuggestionsModule },
  { key: 'settings', label: 'Settings', comp: SettingsModule },
];

export default function AdminPanel({ user = null, onLogout = () => {}, onBackToSite = () => {} }){
  const [active, setActive] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);

  const ActiveComponent = (MENU.find(m => m.key === active) || MENU[0]).comp;

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <aside className={`flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'}`}>
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded bg-gradient-to-br from-purple-600 to-blue-500 flex items-center justify-center font-bold text-white">MM</div>
              {!collapsed && <div className="text-lg font-semibold">Midway Admin</div>}
            </div>
            <button
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-900"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>

          <nav className="flex-1 px-1 py-3 overflow-auto">
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

          <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-800">
            <div className="flex flex-col items-stretch gap-3">
              <div className="flex justify-end">
                <div className="flex flex-col items-stretch gap-2 w-full">
                  <button
                    onClick={onBackToSite}
                    className={
                      `w-full px-3 py-2 text-sm rounded ${collapsed ? 'flex justify-center' : 'text-left'} bg-gray-200 dark:bg-gray-800 hover:bg-gray-300`
                    }
                  >
                    {!collapsed ? 'Back to site' : '↩'}
                  </button>

                  <button
                    onClick={onLogout}
                    className={
                      `w-full px-3 py-2 text-sm rounded ${collapsed ? 'flex justify-center' : 'text-left'} bg-red-600 text-white hover:bg-red-700`
                    }
                  >
                    {!collapsed ? 'Logout' : '⏻'}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-800 flex items-center justify-center">😀</div>
                {!collapsed && (
                  <div className="flex-1">
                    <div className="text-sm font-medium">{user?.name || 'Admin User'}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{user?.email || 'admin@example.com'}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold">{(MENU.find(m => m.key === active) || MENU[0]).label}</h1>
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-300">Signed in as <span className="font-medium">{user?.email || 'admin@example.com'}</span></div>
        </header>

        <section className="bg-white dark:bg-gray-950 rounded-lg shadow-sm p-4">
          <ActiveComponent />
        </section>
      </main>
    </div>
  );
}
