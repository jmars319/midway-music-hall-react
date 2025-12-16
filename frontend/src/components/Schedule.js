import React, { useEffect, useMemo, useState } from 'react';
// Schedule: simple list of upcoming events used on the home page
import { Calendar, DollarSign, Users, Share2, CalendarPlus, DoorOpen, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import EventSeatingModal from './EventSeatingModal';
import ResponsiveImage from './ResponsiveImage';
import { API_BASE } from '../apiConfig';
import { formatEventDateTimeLabel, formatDoorsLabel, eventHasSeating, getEventStartDate, isRecurringEvent } from '../utils/eventFormat';
import { getCategoryBadge } from '../utils/categoryLabels';

const EVENTS_PER_PAGE = 6;

const formatPriceValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return `$${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)}`;
};

const formatPriceRange = (event = {}) => {
  const min = formatPriceValue(event.min_ticket_price);
  const max = formatPriceValue(event.max_ticket_price);
  if (min && max && min !== max) {
    return `${min} – ${max}`;
  }
  return formatPriceValue(event.ticket_price) || formatPriceValue(event.door_price) || null;
};

const formatMonthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatMonthLabel = (date) => date.toLocaleString('en-US', { month: 'short', year: 'numeric' });

export default function Schedule({ events = [], loading = false, errorMessage = '' }) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [activeMonth, setActiveMonth] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  const monthEntries = useMemo(() => {
    const months = new Map();
    events.forEach((event) => {
      const start = getEventStartDate(event);
      if (!start) return;
      const firstOfMonth = new Date(start.getFullYear(), start.getMonth(), 1);
      const key = formatMonthKey(firstOfMonth);
      if (!months.has(key)) {
        months.set(key, {
          key,
          label: formatMonthLabel(firstOfMonth),
          timestamp: firstOfMonth.getTime(),
        });
      }
    });
    return Array.from(months.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [events]);

  const monthFilters = useMemo(() => (
    [
      { key: 'all', label: 'All' },
      ...monthEntries,
    ]
  ), [monthEntries]);

  const targetMonthKey = useMemo(() => {
    if (!monthEntries.length) return 'all';
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentKey = formatMonthKey(monthStart);
    if (monthEntries.some((entry) => entry.key === currentKey)) {
      return currentKey;
    }
    const upcoming = monthEntries.find((entry) => entry.timestamp >= monthStart.getTime());
    if (upcoming) {
      return upcoming.key;
    }
    return monthEntries[0].key;
  }, [monthEntries]);

  const filteredEvents = useMemo(() => {
    if (activeMonth === 'all') return events;
    return events.filter((event) => {
      const start = getEventStartDate(event);
      if (!start) return false;
      const key = formatMonthKey(new Date(start.getFullYear(), start.getMonth(), 1));
      return key === activeMonth;
    });
  }, [activeMonth, events]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PER_PAGE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeMonth, events.length]);

  const pageStartIndex = (currentPage - 1) * EVENTS_PER_PAGE;
  const pagedEvents = filteredEvents.slice(pageStartIndex, pageStartIndex + EVENTS_PER_PAGE);
  const showFilteredEmptyState = events.length > 0 && filteredEvents.length === 0;
  const activeMonthLabel = monthFilters.find((month) => month.key === activeMonth)?.label || 'All';

  const handleRequestSeats = (event) => {
    setSelectedEvent(event);
  };

  const closeModal = () => {
    setSelectedEvent(null);
  };

  const handleJumpToNow = () => {
    if (targetMonthKey && targetMonthKey !== 'all') {
      setActiveMonth(targetMonthKey);
    } else {
      setActiveMonth('all');
    }
    setCurrentPage(1);
  };

  return (
    <>
      {selectedEvent && (
        <EventSeatingModal
          event={selectedEvent}
          onClose={closeModal}
        />
      )}

      <section className="py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 space-y-2">
            <h2 className="text-3xl font-bold">Upcoming Shows</h2>
            <p className="text-gray-300">Stay up to date with the latest bookings and ticket info.</p>
          </div>

          {events.length > 0 && (
            <div className="mb-6">
              <div className="text-sm text-gray-400 mb-2">Filter by month</div>
              <div className="flex flex-wrap gap-2">
                {monthFilters.map((month) => {
                  const isActive = activeMonth === month.key;
                  return (
                    <button
                      key={month.key}
                      type="button"
                      onClick={() => setActiveMonth(month.key)}
                      aria-pressed={isActive}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${
                        isActive
                          ? 'bg-purple-600 text-white border-purple-500'
                          : 'border-gray-700 text-gray-300 hover:text-white'
                      }`}
                    >
                      {month.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="min-h-[360px]">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin h-12 w-12 border-4 border-purple-500 border-t-transparent rounded-full"></div>
              </div>
            ) : errorMessage ? (
              <div className="text-center py-12">
                <Calendar className="h-16 w-16 text-red-400 mx-auto mb-4" />
                <p className="text-xl text-red-200">Events are temporarily unavailable.</p>
                <p className="text-red-300 mt-2">{errorMessage}</p>
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="h-16 w-16 text-gray-500 mx-auto mb-4" />
                <p className="text-xl text-gray-400">No upcoming shows</p>
                <p className="text-gray-500 mt-2">Check back soon for new events.</p>
              </div>
            ) : showFilteredEmptyState ? (
              <div className="text-center py-12">
                <Calendar className="h-16 w-16 text-gray-500 mx-auto mb-4" />
                <p className="text-xl text-gray-400">No events in {activeMonthLabel}</p>
                <p className="text-gray-500 mt-2">Try another month or tap "All".</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 min-h-[360px]">
                {pagedEvents.map((event) => (
                  <div
                    key={event.id || event.slug || event.title}
                    id={event.id ? `event-${event.id}` : undefined}
                    className="bg-gray-800 rounded-xl border border-gray-700/70 hover:border-purple-400/60 transition p-4 flex flex-col gap-4 min-h-[320px]"
                >
                  {(!event.start_datetime && !event.event_date) && (
                    <div className="text-xs font-semibold text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-full px-3 py-1 w-fit">
                      Needs date & time
                    </div>
                  )}
                  <div className="flex items-start gap-4">
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0">
                      <ResponsiveImage
                        image={event.image_variants}
                        alt={event.artist_name || 'Event'}
                        width={event.image_intrinsic_width}
                        height={event.image_intrinsic_height}
                        sizes="80px"
                        className="w-full h-full object-cover"
                        pictureClassName="block w-full h-full"
                        fallbackAspectRatio="1 / 1"
                      />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-lg font-semibold">{event.artist_name || event.title || event.name || 'Untitled'}</h3>
                          <p className="text-sm text-gray-400">{event.genre || event.venue_section || ''}</p>
                        </div>
                        {(() => {
                          const badge = getCategoryBadge(event);
                          if (!badge) return null;
                          return (
                            <span className={`text-xs px-2 py-1 rounded-full uppercase tracking-wide whitespace-nowrap ${badge.classes}`}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="text-sm text-gray-300 space-y-1">
                        <div className="flex items-center">
                          <Calendar className="h-4 w-4 mr-2 text-purple-300" />
                          {formatEventDateTimeLabel(event)}
                        </div>
                        {formatDoorsLabel(event) && (
                          <div className="flex items-center">
                            <DoorOpen className="h-4 w-4 mr-2 text-purple-300" />
                            Doors {formatDoorsLabel(event)}
                          </div>
                        )}
                        {formatPriceRange(event) && (
                          <div className="flex items-center">
                            <DollarSign className="h-4 w-4 mr-2 text-purple-300" />
                            {formatPriceRange(event)}
                          </div>
                        )}
                        {event.age_restriction && (
                          <div className="flex items-center">
                            <Users className="h-4 w-4 mr-2 text-purple-300" />
                            {event.age_restriction}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-gray-400 line-clamp-2 min-h-[2.5rem]">
                    {event.description || event.notes || 'Performance at Midway Music Hall.'}
                  </p>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {event.id && (
                      <>
                        <a
                          href={`${API_BASE}/events/${event.id}.ics`}
                          className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition"
                        >
                          <CalendarPlus className="h-4 w-4" /> Add to Calendar
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof window === 'undefined') return;
                            const shareUrl = `${window.location.origin}/#event-${event.id}`;
                            if (navigator.share) {
                              navigator.share({
                                title: event.artist_name || event.title || 'Midway Music Hall Event',
                                url: shareUrl,
                              }).catch(() => {});
                            } else if (navigator.clipboard) {
                              navigator.clipboard.writeText(shareUrl).then(() => {
                                alert('Event link copied to clipboard.');
                              }).catch(() => alert(shareUrl));
                            } else {
                              alert(shareUrl);
                            }
                          }}
                          className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition"
                        >
                          <Share2 className="h-4 w-4" /> Share
                        </button>
                      </>
                    )}
                    {eventHasSeating(event) && !isRecurringEvent(event) && (
                      <button
                        onClick={() => handleRequestSeats(event)}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded transition"
                      >
                        <Users className="h-4 w-4" /> Request Seats
                      </button>
                    )}
                  </div>
                </div>
                ))}
              </div>
            )}
          </div>

          {events.length > 0 && filteredEvents.length > 0 && (
            <div className="mt-8 flex flex-wrap items-center justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="inline-flex h-11 w-11 items-center justify-center rounded border border-gray-700 text-gray-300 hover:text-white disabled:opacity-40"
                aria-label="Go to first page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="inline-flex h-11 w-11 items-center justify-center rounded border border-gray-700 text-gray-300 hover:text-white disabled:opacity-40"
                aria-label="Go to previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 py-1 text-gray-400">
                Page {Math.min(currentPage, totalPages)} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex h-11 w-11 items-center justify-center rounded border border-gray-700 text-gray-300 hover:text-white disabled:opacity-40"
                aria-label="Go to next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="inline-flex h-11 w-11 items-center justify-center rounded border border-gray-700 text-gray-300 hover:text-white disabled:opacity-40"
                aria-label="Go to last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleJumpToNow}
                className="ml-3 inline-flex items-center gap-2 rounded-full border border-purple-500/40 px-4 py-1 text-purple-200 hover:bg-purple-600/20"
              >
                <Calendar className="h-4 w-4" /> Now
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
