import React from 'react';
import { Music2, Calendar, MapPin } from 'lucide-react';

export default function Hero() {
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="bg-gradient-to-br from-purple-900 via-gray-900 to-blue-900 text-white relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <div className="flex items-center justify-center mb-6">
            <Music2 className="h-16 w-16 text-purple-400 animate-pulse mr-3" />
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              Midway Music Hall
            </h1>
          </div>

          <p className="mt-4 text-xl text-gray-200 max-w-2xl mx-auto">
            Experience local and touring acts in an intimate venue — weekly shows, great sound, and a welcoming community.
          </p>

          <div className="mt-8 flex justify-center gap-4">
            <button onClick={() => scrollTo('schedule')} className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition">View Schedule</button>
            <button onClick={() => scrollTo('seating')} className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold transition">Request Seats</button>
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
