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
    <nav className="sticky top-0 z-50 bg-black border-b border-purple-500/30 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-24">
          <div className="flex items-center space-x-3">
            <div className="flex items-center text-white">
              <img 
                src="/logo.png" 
                alt="Midway Music Hall" 
                className="h-20 w-auto mr-3"
              />
              <span className="font-bold text-xl">Midway Music Hall</span>
            </div>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center space-x-6">
            <button onClick={() => scrollToSection('schedule')} className="text-gray-300 hover:text-purple-400 transition font-medium">Schedule</button>
            <button onClick={() => scrollToSection('seating')} className="text-gray-300 hover:text-purple-400 transition font-medium">Seating</button>
            <button onClick={() => scrollToSection('suggest')} className="text-gray-300 hover:text-purple-400 transition font-medium">Suggest Artist</button>
            <button onClick={() => scrollToSection('about')} className="text-gray-300 hover:text-purple-400 transition font-medium">About</button>
            <button onClick={onAdminClick} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition font-medium">Admin</button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              className="p-2 rounded-md text-gray-300 hover:text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden bg-black border-t border-purple-500/30">
          <div className="px-4 pt-4 pb-6 space-y-3">
            <button onClick={() => scrollToSection('schedule')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Schedule</button>
            <button onClick={() => scrollToSection('seating')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Seating</button>
            <button onClick={() => scrollToSection('suggest')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Suggest Artist</button>
            <button onClick={() => scrollToSection('about')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">About</button>
            <button onClick={() => { setMobileOpen(false); onAdminClick && onAdminClick(); }} className="w-full text-left px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium">Admin</button>
          </div>
        </div>
      )}
    </nav>
  );
}
