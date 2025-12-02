import React, { useState, useEffect } from 'react';
// Hero: large header/hero section used on the home page
import { Music2, Calendar, MapPin } from 'lucide-react';
import { API_BASE, SERVER_BASE } from '../App';

export default function Hero() {
  const [logo, setLogo] = useState('/logo.png');
  const [heroTitle, setHeroTitle] = useState('Midway Music Hall');
  const [heroSubtitle, setHeroSubtitle] = useState('Experience local and touring acts in an intimate venue — weekly shows, great sound, and a welcoming community.');
  const [heroImages, setHeroImages] = useState([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [slideshowEnabled, setSlideshowEnabled] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(5000);

  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.settings) {
          if (data.settings.site_logo) {
            setLogo(`${SERVER_BASE}${data.settings.site_logo}`);
          }
          if (data.settings.hero_title) {
            setHeroTitle(data.settings.hero_title);
          }
          if (data.settings.hero_subtitle) {
            setHeroSubtitle(data.settings.hero_subtitle);
          }
          if (data.settings.hero_images) {
            try {
              const images = JSON.parse(data.settings.hero_images);
              setHeroImages(Array.isArray(images) ? images : []);
            } catch (e) {
              setHeroImages([]);
            }
          }
          if (data.settings.hero_slideshow_enabled === 'true') {
            setSlideshowEnabled(true);
          }
          if (data.settings.hero_slideshow_interval) {
            setSlideshowInterval(parseInt(data.settings.hero_slideshow_interval, 10) || 5000);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Slideshow effect
  useEffect(() => {
    if (slideshowEnabled && heroImages.length > 1) {
      const timer = setInterval(() => {
        setCurrentImageIndex((prev) => (prev + 1) % heroImages.length);
      }, slideshowInterval);
      return () => clearInterval(timer);
    }
  }, [slideshowEnabled, heroImages.length, slideshowInterval]);

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="bg-gradient-to-br from-purple-900 via-gray-900 to-blue-900 text-white relative overflow-hidden">
      {/* Background image */}
      {heroImages.length > 0 && (
        <div className="absolute inset-0 z-0">
          {heroImages.map((image, index) => (
            <div
              key={index}
              className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ${
                index === currentImageIndex ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ backgroundImage: `url(${SERVER_BASE}${image})` }}
            />
          ))}
          {/* Dark overlay for text readability */}
          <div className="absolute inset-0 bg-black/50" />
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
        <div className="text-center">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-6">
            {heroTitle}
          </h1>

          <p className="mt-4 text-xl text-gray-200 max-w-2xl mx-auto">
            {heroSubtitle}
          </p>

          <div className="mt-8 flex justify-center">
            <button onClick={() => scrollTo('schedule')} className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition">View Schedule</button>
          </div>
        </div>

        {/* Feature cards */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/20">
            <div className="flex items-center space-x-4">
              <Calendar className="h-8 w-8 text-purple-400" />
              <div>
                <h3 className="text-lg font-semibold">Weekly Shows</h3>
                <p className="text-sm text-gray-300">Discover new and returning acts every week.</p>
              </div>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/20">
            <div className="flex items-center space-x-4">
              <MapPin className="h-8 w-8 text-purple-400" />
              <div>
                <h3 className="text-lg font-semibold">Prime Location</h3>
                <p className="text-sm text-gray-300">Conveniently located with easy access and nearby parking.</p>
              </div>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/20">
            <div className="flex items-center space-x-4">
              <Music2 className="h-8 w-8 text-purple-400" />
              <div>
                <h3 className="text-lg font-semibold">All Genres</h3>
                <p className="text-sm text-gray-300">From indie to jazz, our stage showcases a wide range of music.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
