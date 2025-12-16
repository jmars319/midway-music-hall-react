import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, CalendarPlus, ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import ResponsiveImage from '../components/ResponsiveImage';
import { API_BASE } from '../apiConfig';
import { formatEventDateTimeLabel } from '../utils/eventFormat';
import { getCategoryBadge } from '../utils/categoryLabels';

const PAGE_LIMIT = 20;

const monthLabel = (event) => {
  const dt = event.start_datetime
    ? new Date(event.start_datetime)
    : event.event_date
      ? new Date(`${event.event_date}T${event.event_time || '00:00:00'}`)
      : null;
  if (!dt || Number.isNaN(dt.getTime())) return 'Upcoming';
  return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export default function ArchivePage({ onAdminClick, onNavigate }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          timeframe: 'past',
          archived: '0',
          page: String(page),
          limit: String(PAGE_LIMIT),
        });
        const res = await fetch(`${API_BASE}/public/events?${params.toString()}`);
        const data = await res.json();
        if (!cancelled) {
          if (data.success && Array.isArray(data.events)) {
            setEvents(data.events);
          } else {
            setEvents([]);
          }
        }
      } catch (err) {
        console.error('Failed to load archive', err);
        if (!cancelled) {
          setEvents([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    fetchEvents();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const grouped = useMemo(() => {
    if (!events.length) return [];
    const buckets = events.reduce((acc, event) => {
      const label = monthLabel(event);
      if (!acc[label]) acc[label] = [];
      acc[label].push(event);
      return acc;
    }, {});
    return Object.entries(buckets);
  }, [events]);

  const handleShare = (event) => {
    if (typeof window === 'undefined' || !event.id) return;
    const url = `${window.location.origin}/#event-${event.id}`;
    if (navigator.share) {
      navigator.share({ title: event.artist_name || event.title || 'Midway Music Hall Event', url }).catch(() => {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        alert('Event link copied to clipboard.');
      }).catch(() => alert(url));
      return;
    }
    alert(url);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation />
      <main className="py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <header className="mb-10 text-center">
            <p className="text-sm uppercase tracking-widest text-purple-300">Event Archive</p>
            <h1 className="text-4xl font-bold mt-2">Past Shows & Dance Nights</h1>
            <p className="text-gray-300 mt-4">
              Browse recent months to see who has played Midway Music Hall and The Gathering Place.
            </p>
          </header>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin h-12 w-12 border-4 border-purple-500 border-t-transparent rounded-full" />
            </div>
          ) : grouped.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-gray-600 rounded-xl">
              <Calendar className="h-12 w-12 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-200">No archived events found.</p>
            </div>
          ) : (
            <div className="space-y-10">
              {grouped.map(([label, monthEvents]) => (
                <section key={label}>
                  <h2 className="text-2xl font-semibold mb-4">{label}</h2>
                  <div className="space-y-4">
                    {monthEvents.map((event) => {
                      const readableTitle = event.artist_name || event.title || 'Midway Music Hall Event';
                      return (
                      <article
                        key={event.id || `${label}-${event.artist_name}`}
                        className="bg-gray-800 rounded-xl border border-purple-500/20 p-4 flex flex-col md:flex-row gap-4"
                      >
                        <div className="w-full md:w-60 flex-shrink-0">
                          <ResponsiveImage
                            image={event.image_variants}
                            alt={event.artist_name || event.title || 'Event poster'}
                            width={event.image_intrinsic_width}
                            height={event.image_intrinsic_height}
                            className="w-full h-full object-cover rounded-lg border border-gray-700"
                            pictureClassName="block w-full aspect-[16/9]"
                            fallbackAspectRatio="16 / 9"
                            sizes="(max-width: 768px) 100vw, 240px"
                          />
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-1 text-xs rounded-full bg-purple-600/20 text-purple-100 border border-purple-500/30">
                              {formatEventDateTimeLabel(event)}
                            </span>
                            {event.venue_code && (
                              <span className="px-2 py-1 text-xs rounded-full bg-gray-700 text-gray-200 border border-gray-600">
                                {event.venue_code}
                              </span>
                            )}
                            {(() => {
                              const badge = getCategoryBadge(event);
                              if (!badge) return null;
                              return (
                                <span className={`px-2 py-1 text-xs rounded-full ${badge.classes}`}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                          </div>
                          <h3 className="text-xl font-semibold">
                            {readableTitle}
                          </h3>
                          <p className="text-gray-300 text-sm">
                            {event.description || event.notes || 'Live performance at Midway Music Hall.'}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {event.id && (
                              <>
                                <a
                                  href={`${API_BASE}/events/${event.id}.ics`}
                                  className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
                                  aria-label={`Add ${readableTitle} to calendar`}
                                >
                                  <CalendarPlus className="h-4 w-4" /> Add to Calendar
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleShare(event)}
                                  className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded"
                                >
                                  <Share2 className="h-4 w-4" /> Share
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between mt-10">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" /> Newer
            </button>
            <span className="text-sm text-gray-400">Page {page}</span>
            <button
              type="button"
              onClick={() => setPage((prev) => prev + 1)}
              disabled={events.length < PAGE_LIMIT}
              className="inline-flex items-center gap-2 px-4 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
            >
              Older <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </main>
      <Footer onAdminClick={onAdminClick} onNavigate={onNavigate} />
    </div>
  );
}
