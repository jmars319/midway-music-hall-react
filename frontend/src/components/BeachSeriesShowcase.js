import React from 'react';
import { Waves, Calendar } from 'lucide-react';

const resolveDateValue = (event = {}) => event.start_datetime || event.event_date || event.date || null;

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

export default function BeachSeriesShowcase({ events = [] }) {
  const sortedEvents = [...events].sort((a, b) => {
    const aTime = new Date(resolveDateValue(a) || 0).getTime();
    const bTime = new Date(resolveDateValue(b) || 0).getTime();
    return aTime - bTime;
  });

  if (!sortedEvents.length) {
    return null;
  }

  return (
    <section className="py-12 bg-gradient-to-r from-blue-900/40 to-purple-900/30" id="beach-series">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 mb-6">
          <Waves className="h-8 w-8 text-cyan-300" />
          <div>
            <p className="text-sm uppercase tracking-widest text-cyan-200">Carolina Beach Music Series</p>
            <h2 className="text-3xl font-bold text-white">Beach Bands at Midway</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedEvents.map((event) => (
            <article key={event.id} className="bg-gray-950/80 rounded-2xl border border-cyan-500/30 p-5">
              <p className="text-xs uppercase tracking-widest text-cyan-200 mb-2">Beach Music</p>
              <h3 className="text-2xl font-semibold text-white">{event.artist_name || event.title}</h3>
              <p className="text-gray-300 mt-1">{event.description || event.notes || 'Classic Carolina beach music vibes.'}</p>
              <div className="flex items-center gap-2 text-gray-300 mt-4">
                <Calendar className="h-4 w-4 text-cyan-200" />
                <span>{formatDate(resolveDateValue(event))} · {event.venue_code || 'MMH'}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
