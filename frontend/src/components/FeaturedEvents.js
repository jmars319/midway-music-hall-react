import React from 'react';
import { Sparkles } from 'lucide-react';
import { formatEventDateTimeLabel, formatDoorsLabel } from '../utils/eventFormat';
import { getCategoryBadge } from '../utils/categoryLabels';
import { hasRenderableImageVariant } from '../utils/imageVariants';
import ResponsiveImage from './ResponsiveImage';
import BrandImage from './BrandImage';

// Highlights the next few headline events at the top of the public site.
export default function FeaturedEvents({ events = [], loading = false }) {
  if (loading) {
    return (
      <section className="py-12 bg-gray-950 border-t border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 text-purple-300">
            <Sparkles className="h-5 w-5 animate-spin-slow" />
            <span>Loading featured events…</span>
          </div>
        </div>
      </section>
    );
  }

  if (!events.length) {
    return null;
  }

  return (
    <section className="py-12 bg-gradient-to-br from-purple-900/40 to-gray-900" aria-label="Featured events">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-sm uppercase tracking-widest text-purple-300">Featured</p>
            <h2 className="text-3xl font-bold text-white mt-1">Spotlight Shows</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {events.map((event) => {
            const hasPoster = hasRenderableImageVariant(event.image_variants);
            return (
              <article
                key={event.id}
                className="bg-gray-900 rounded-2xl border border-purple-500/30 shadow-xl overflow-hidden flex flex-col"
              >
              <div className="bg-gray-800 overflow-hidden">
                {hasPoster ? (
                  <ResponsiveImage
                    image={event.image_variants}
                    alt={event.artist_name || event.title || 'Featured event'}
                    width={event.image_intrinsic_width}
                    height={event.image_intrinsic_height}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="w-full h-full object-cover"
                    pictureClassName="block w-full h-full"
                    fallbackAspectRatio="4 / 3"
                  />
                ) : (
                  <BrandImage
                    variant="defaultEvent"
                    alt=""
                    className="w-full h-full object-cover"
                    pictureClassName="block w-full h-full"
                    width={400}
                    height={300}
                  />
                )}
              </div>
              <div className="p-6 flex-1 flex flex-col">
                <p className="text-sm text-purple-300 uppercase tracking-wide mb-2">
                  {formatEventDateTimeLabel(event)}
                </p>
                {(() => {
                  const badge = getCategoryBadge(event);
                  if (!badge) return null;
                  return (
                    <span className={`inline-block text-xs px-2 py-1 rounded-full mb-3 ${badge.classes}`}>
                      {badge.label}
                    </span>
                  );
                })()}
                <h3 className="text-2xl font-semibold text-white">{event.artist_name || event.title}</h3>
                <p className="text-gray-300 mt-3 flex-1">{event.description || event.notes || 'Live at Midway Music Hall'}</p>
                {formatDoorsLabel(event) && (
                  <div className="mt-6 text-sm text-gray-400">
                    Doors {formatDoorsLabel(event)}
                  </div>
                )}
              </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
