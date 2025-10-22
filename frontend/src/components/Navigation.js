import React, { useState } from 'react';
import { Menu, X, Music } from 'lucide-react';

// Navigation: top site navigation and admin access button
export default function Navigation({ onAdminClick }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollToSection = (id) => {
    setMobileOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="sticky top-0 z-50 bg-gray-900 border-b border-purple-500/15">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            <div className="flex items-center text-white">
              <Music className="h-7 w-7 text-purple-400 mr-2" />
              <span className="font-bold text-lg">Midway Music Hall</span>
            </div>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center space-x-6">
            <button onClick={() => scrollToSection('schedule')} className="text-gray-300 hover:text-purple-400 transition">Schedule</button>
            <button onClick={() => scrollToSection('seating')} className="text-gray-300 hover:text-purple-400 transition">Seating</button>
            <button onClick={() => scrollToSection('suggest')} className="text-gray-300 hover:text-purple-400 transition">Suggest Artist</button>
            <button onClick={() => scrollToSection('about')} className="text-gray-300 hover:text-purple-400 transition">About</button>
            <button onClick={onAdminClick} className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition">Admin</button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              className="p-2 rounded-md text-gray-300 hover:text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden bg-gray-900 border-t border-purple-500/10">
          <div className="px-4 pt-4 pb-6 space-y-3">
            <button onClick={() => scrollToSection('schedule')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2">Schedule</button>
            <button onClick={() => scrollToSection('seating')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2">Seating</button>
            <button onClick={() => scrollToSection('suggest')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2">Suggest Artist</button>
            <button onClick={() => scrollToSection('about')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2">About</button>
            <button onClick={() => { setMobileOpen(false); onAdminClick && onAdminClick(); }} className="w-full text-left px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg">Admin</button>
          </div>
        </div>
      )}
    </nav>
  );
}
