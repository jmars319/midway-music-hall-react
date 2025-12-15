import React, { useMemo, useState } from 'react';
import { Waves, Calendar, Users, Phone, Mail } from 'lucide-react';
import EventSeatingModal from './EventSeatingModal';
import useSiteContent from '../hooks/useSiteContent';
import { eventHasSeating, isRecurringEvent } from '../utils/eventFormat';

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

const formatPhoneHref = (value) => {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.length === 10 ? `+1${digits}` : digits;
  return `tel:${normalized}`;
};

export default function BeachSeriesShowcase({ events = [] }) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const siteContent = useSiteContent();

  const sortedEvents = [...events].sort((a, b) => {
    const aTime = new Date(resolveDateValue(a) || 0).getTime();
    const bTime = new Date(resolveDateValue(b) || 0).getTime();
    return aTime - bTime;
  });

  const beachContact = useMemo(() => {
    const contacts = Array.isArray(siteContent.contacts) ? siteContent.contacts : [];
    const matcher = (value = '') => /beach/i.test(value);
    return (
      contacts.find((contact) => matcher(contact.title) || matcher(contact.notes)) ||
      contacts.find((contact) => matcher(contact.name)) ||
      contacts[1] ||
      contacts[0] ||
      null
    );
  }, [siteContent]);

  const contactInstructions = beachContact?.notes || 'Call or text with Beach Bands questions or seat requests.';

  if (!sortedEvents.length) {
    return null;
  }

  return (
    <section className="py-12 bg-gradient-to-r from-blue-900/40 to-purple-900/30" id="beach-series">
      {selectedEvent && (
        <EventSeatingModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 mb-6">
          <Waves className="h-8 w-8 text-cyan-300" />
          <div>
            <p className="text-sm uppercase tracking-widest text-cyan-200">Carolina Beach Music Series</p>
            <h2 className="text-3xl font-bold text-white">Beach Bands at Midway</h2>
          </div>
        </div>

        {beachContact && (
          <div className="mb-8 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-6 shadow-lg">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200 mb-2">Beach Bands Contact</p>
            <h3 className="text-2xl font-semibold text-white">{beachContact.name}{beachContact.title ? ` · ${beachContact.title}` : ''}</h3>
            <p className="text-cyan-100 mt-2 text-base">{contactInstructions}</p>
            <div className="flex flex-wrap gap-6 mt-4 text-white text-lg font-semibold">
              {beachContact.phone && (
                <a
                  href={formatPhoneHref(beachContact.phone)}
                  className="inline-flex items-center gap-2 hover:text-cyan-200 transition"
                >
                  <Phone className="h-5 w-5" />
                  <span>{beachContact.phone}</span>
                </a>
              )}
              {beachContact.email && (
                <a
                  href={`mailto:${beachContact.email}`}
                  className="inline-flex items-center gap-2 hover:text-cyan-200 transition"
                >
                  <Mail className="h-5 w-5" />
                  <span>{beachContact.email}</span>
                </a>
              )}
            </div>
          </div>
        )}

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
              {eventHasSeating(event) && !isRecurringEvent(event) && (
                <button
                  type="button"
                  onClick={() => setSelectedEvent(event)}
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-cyan-600/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
                >
                  <Users className="h-4 w-4" /> Request Seats
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
