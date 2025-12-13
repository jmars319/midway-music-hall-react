import React, { useState, useEffect } from 'react';
// Hero: large header/hero section used on the home page and TGP route
import { Music2, Calendar, MapPin } from 'lucide-react';
import { API_BASE, SERVER_BASE } from '../App';

const HERO_VARIANTS = {
  main: {
    titleKey: 'hero_title',
    subtitleKey: 'hero_subtitle',
    imagesKey: 'hero_images',
    slideshowKey: 'hero_slideshow_enabled',
    intervalKey: 'hero_slideshow_interval',
    defaults: {
      title: 'Midway Music Hall',
      subtitle: 'Carolina beach music, shag dance nights, Americana roots, classic country, and the occasional rock show in a friendly, comfortable room.',
    },
    ctaLabel: 'Plan Your Visit',
    ctaTarget: 'about',
    theme: {
      gradient: 'from-purple-900 via-gray-900 to-blue-900',
      overlayGradient: 'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0.1) 100%)',
      overlayOpacity: 1,
      button: 'bg-purple-600 hover:bg-purple-700',
      icon: 'text-purple-300',
      cardBorder: 'border-purple-500/20',
    },
    features: [
      {
        icon: Calendar,
        title: 'Weekly Shows',
        copy: 'Beach music, shag nights, Americana, and classic country every week with the occasional rock feature.',
      },
      {
        icon: MapPin,
        title: 'Prime Location',
        copy: 'Winston-Salem venue inside Midway Town Center with easy parking and direct Hwy 52 access.',
      },
      {
        icon: Music2,
        title: 'Beach, Shag & Country Nights',
        copy: 'Carolina beach music, shag dancing, Americana roots, classic country, plus occasional rock.',
      },
    ],
  },
  tgp: {
    titleKey: 'tgp_hero_title',
    subtitleKey: 'tgp_hero_subtitle',
    imagesKey: 'tgp_hero_images',
    slideshowKey: 'tgp_hero_slideshow_enabled',
    intervalKey: 'tgp_hero_slideshow_interval',
    defaults: {
      title: 'The Gathering Place',
      subtitle: 'Our neighboring room for Friday DJs, shag lessons, private rentals, and community gatherings.',
    },
    ctaLabel: 'View TGP Schedule',
    ctaTarget: 'schedule',
    theme: {
      gradient: 'from-blue-900 via-gray-900 to-indigo-900',
      overlayGradient: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.4) 80%, rgba(0,0,0,0.15) 100%)',
      overlayOpacity: 1,
      button: 'bg-blue-600 hover:bg-blue-700',
      icon: 'text-blue-300',
      cardBorder: 'border-blue-500/20',
    },
    features: [
      {
        icon: Calendar,
        title: 'Weekly DJ Nights',
        copy: 'Dance to resident DJs and curated playlists.',
      },
      {
        icon: Music2,
        title: 'Lessons & Workshops',
        copy: 'Line dance, shag, and specialty instruction.',
      },
      {
        icon: MapPin,
        title: 'Next Door to MMH',
        copy: 'Same address, dedicated entrance and amenities.',
      },
    ],
  },
};

export default function Hero({ variant = 'main', ctaTarget }) {
  const config = HERO_VARIANTS[variant] || HERO_VARIANTS.main;
  const [heroTitle, setHeroTitle] = useState(config.defaults.title);
  const [heroSubtitle, setHeroSubtitle] = useState(config.defaults.subtitle);
  const [heroImages, setHeroImages] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [slideshowEnabled, setSlideshowEnabled] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(5000);

  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/settings`)
      .then(res => res.json())
      .then(data => {
        if (!mounted || !data.success || !data.settings) return;
        const settings = data.settings;
        if (settings[config.titleKey]) {
          setHeroTitle(settings[config.titleKey]);
        } else {
          setHeroTitle(config.defaults.title);
        }
        if (settings[config.subtitleKey]) {
          setHeroSubtitle(settings[config.subtitleKey]);
        } else {
          setHeroSubtitle(config.defaults.subtitle);
        }
        if (settings[config.imagesKey]) {
          try {
            const parsed = JSON.parse(settings[config.imagesKey]);
            setHeroImages(Array.isArray(parsed) ? parsed : []);
          } catch (err) {
            setHeroImages([]);
          }
        } else {
          setHeroImages([]);
        }
        if (settings[config.slideshowKey] === 'true') {
          setSlideshowEnabled(true);
        } else {
          setSlideshowEnabled(false);
        }
        if (settings[config.intervalKey]) {
          setSlideshowInterval(parseInt(settings[config.intervalKey], 10) || 5000);
        } else {
          setSlideshowInterval(5000);
        }
      })
      .catch(() => {})
      .finally(() => {});
    return () => { mounted = false; };
  }, [variant]);

  useEffect(() => {
    if (slideshowEnabled && heroImages.length > 1) {
      const timer = setInterval(() => {
        setCurrentImageIndex((prev) => (prev + 1) % heroImages.length);
      }, slideshowInterval);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [slideshowEnabled, heroImages.length, slideshowInterval]);

  const handleScroll = (targetId) => {
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const resolvedCtaTarget = ctaTarget || config.ctaTarget;

  const textShadowStyle = { textShadow: '0 2px 6px rgba(0,0,0,0.45)' };
  return (
    <section className={`bg-gradient-to-br ${config.theme.gradient} text-white relative overflow-hidden`}>
      {heroImages.length > 0 && (
        <div className="absolute inset-0 z-0">
          {heroImages.map((image, index) => (
            <div
              key={`${image}-${index}`}
              className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ${
                index === currentImageIndex ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ backgroundImage: `url(${SERVER_BASE}${image})` }}
            />
          ))}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: config.theme.overlayGradient || 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 100%)',
              opacity: config.theme.overlayOpacity ?? 1,
            }}
          />
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-6" style={textShadowStyle}>
            {heroTitle}
          </h1>

          <p className="mt-4 text-xl text-gray-200 max-w-3xl mx-auto" style={textShadowStyle}>
            {heroSubtitle}
          </p>

          <div className="mt-8 flex justify-center">
            <button
              onClick={() => handleScroll(resolvedCtaTarget)}
              className={`px-6 py-3 ${config.theme.button} text-white rounded-lg font-semibold transition`}
            >
              {config.ctaLabel}
            </button>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {config.features.map((feature) => (
            <div key={feature.title} className={`bg-white/5 backdrop-blur-sm rounded-xl p-6 border ${config.theme.cardBorder}`}>
              <div className="flex items-center space-x-4">
                <feature.icon className={`h-8 w-8 ${config.theme.icon}`} />
                <div>
                  <h3 className="text-lg font-semibold">{feature.title}</h3>
                  <p className="text-sm text-gray-300">{feature.copy}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
