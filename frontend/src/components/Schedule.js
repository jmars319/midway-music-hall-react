import React, { useState } from 'react';
// Schedule: simple list of upcoming events used on the home page
import { Calendar, Clock, DollarSign, Users, Share2, CalendarPlus, DoorOpen } from 'lucide-react';
import EventSeatingModal from './EventSeatingModal';
import ResponsiveImage from './ResponsiveImage';
import { API_BASE, getImageUrlSync } from '../App';
import { formatEventDateTimeLabel, formatDoorsLabel, eventHasSeating } from '../utils/eventFormat';

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

export default function Schedule({ events = [], loading = false, errorMessage = '' }){
  const [selectedEvent, setSelectedEvent] = useState(null);

  const handleRequestSeats = (event) => {
    setSelectedEvent(event);
  };

  const closeModal = () => {
    setSelectedEvent(null);
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
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {events.map((event) => (
              <div
                key={event.id || event.slug || event.title}
                id={event.id ? `event-${event.id}` : undefined}
                className="bg-gray-800 rounded-xl border border-gray-700/70 hover:border-purple-400/60 transition p-4 flex flex-col gap-4"
              >
                <div className="flex items-start gap-4">
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0">
                    <ResponsiveImage
                      src={getImageUrlSync(event.image_url)}
                      alt={event.artist_name || 'Event'}
                      width={160}
                      height={160}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold">{event.artist_name || event.title || event.name || 'Untitled'}</h3>
                        <p className="text-sm text-gray-400">{event.genre || event.venue_section || ''}</p>
                      </div>
                      {event.isBeachSeries && (
                        <span className="text-xs px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-100 uppercase tracking-wide whitespace-nowrap">
                          Beach Music
                        </span>
                      )}
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
                  {eventHasSeating(event) && (
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
    </section>
    </>
  );
}
