import React, { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { API_BASE, SERVER_BASE } from '../App';
import ResponsiveImage from './ResponsiveImage';

// Navigation: top site navigation with smooth scrolling links
export default function Navigation() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logo, setLogo] = useState('/logo.png');
  const [currentPath, setCurrentPath] = useState('/');
  const SECTION_MAP = {
    home: 'home',
    schedule: 'schedule',
    recurring: 'recurring-events',
    'recurring-events': 'recurring-events',
    lessons: 'lessons',
    'beach-series': 'beach-series',
    about: 'about',
    suggest: 'suggest',
  };

  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings?.site_logo) {
          setLogo(`${SERVER_BASE}${data.settings.site_logo}`);
        }
      })
      .catch(() => {});

    if (typeof window !== 'undefined') {
      setCurrentPath(window.location.pathname || '/');
    }
  }, []);

  const normalizedSectionId = (id) => SECTION_MAP[id] || id;

  const findTargetElement = (id) => {
    if (typeof document === 'undefined') return null;
    const normalized = normalizedSectionId(id);
    return document.getElementById(normalized) || document.querySelector(`[data-nav-target="${normalized}"]`);
  };

  const scrollToSection = (id) => {
    if (!id) return false;
    const el = findTargetElement(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    }
    return false;
  };

  const isAlternatePage = currentPath.startsWith('/thegatheringplace') || currentPath.startsWith('/archive');

  const redirectToHomeSection = (targetId) => {
    const normalized = normalizedSectionId(targetId);
    const hash = normalized === 'home' ? '' : `#${normalized}`;
    window.location.href = `/${hash}`;
  };

  const handleNavClick = (targetId) => {
    setMobileOpen(false);
    if (scrollToSection(targetId)) return;
    if (typeof window === 'undefined') return;
    const normalized = normalizedSectionId(targetId);
    if (isAlternatePage && normalized !== 'home') {
      redirectToHomeSection(normalized);
      return;
    }
    redirectToHomeSection(normalized);
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.location.hash) return;
    const hashId = window.location.hash.slice(1);
    if (!hashId) return;
    const scroll = () => {
      scrollToSection(hashId);
    };
    const timer = setTimeout(scroll, 50);
    return () => clearTimeout(timer);
  }, [currentPath]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <nav className="sticky top-0 z-50 bg-black border-b border-purple-500/30 shadow-lg" aria-label="Primary site navigation">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-24">
          <div className="flex items-center space-x-3">
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  redirectToHomeSection('home');
                }}
                aria-label="Go to homepage"
                className="flex items-center text-white"
              >
                <ResponsiveImage
                  src={logo}
                  alt="Midway Music Hall"
                  width={160}
                  height={80}
                  priority
                  className="h-20 w-auto mr-3 object-contain"
                />
                <span className="font-bold text-xl">Midway Music Hall</span>
              </a>
          </div>

          {/* Desktop links */}
          <div className="hidden md:flex items-center space-x-6">
            <button onClick={() => handleNavClick('schedule')} className="text-gray-300 hover:text-purple-400 transition font-medium">Schedule</button>
            <button onClick={() => handleNavClick('recurring')} className="text-gray-300 hover:text-purple-400 transition font-medium">Recurring</button>
            <button onClick={() => handleNavClick('lessons')} className="text-gray-300 hover:text-purple-400 transition font-medium">Lessons</button>
            <button onClick={() => handleNavClick('beach-series')} className="text-gray-300 hover:text-purple-400 transition font-medium">Beach Series</button>
            <button onClick={() => handleNavClick('suggest')} className="text-gray-300 hover:text-purple-400 transition font-medium">Suggest Artist</button>
            <a href="/thegatheringplace" className="text-gray-300 hover:text-purple-400 transition font-medium">
              The Gathering Place
            </a>
            <a href="/archive" className="text-gray-300 hover:text-purple-400 transition font-medium">
              Archive
            </a>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-menu"
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-300 hover:text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile dropdown */}
          {mobileOpen && (
            <div className="md:hidden bg-black border-t border-purple-500/30" id="mobile-nav-menu">
              <div className="px-4 pt-4 pb-6 space-y-3">
                <button onClick={() => handleNavClick('schedule')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Schedule</button>
                <button onClick={() => handleNavClick('recurring')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Recurring</button>
                <button onClick={() => handleNavClick('lessons')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Lessons</button>
                <button onClick={() => handleNavClick('beach-series')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Beach Series</button>
                <button onClick={() => handleNavClick('about')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">About</button>
                <button onClick={() => handleNavClick('suggest')} className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium">Suggest Artist</button>
                <a href="/thegatheringplace" className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium" onClick={() => setMobileOpen(false)}>
                  The Gathering Place
                </a>
                <a href="/archive" className="block w-full text-left text-gray-300 hover:text-purple-400 py-2 font-medium" onClick={() => setMobileOpen(false)}>
                  Archive
                </a>
              </div>
            </div>
          )}
    </nav>
  );
}
