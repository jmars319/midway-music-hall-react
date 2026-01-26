import React, { useEffect, useState } from 'react';
import Navigation from '../components/Navigation';
import AnnouncementBanner from '../components/AnnouncementBanner';
import Hero from '../components/Hero';
import Schedule from '../components/Schedule';
import ArtistSuggestion from '../components/ArtistSuggestion';
import Footer from '../components/Footer';
import { API_BASE } from '../apiConfig';

export default function GatheringPlacePage({ onAdminClick, onNavigate }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');

  useEffect(() => {
    let mounted = true;
    const fetchEvents = async () => {
      setLoading(true);
      setEventsError('');
      try {
        const params = new URLSearchParams({
          venue: 'TGP',
          timeframe: 'upcoming',
          archived: '0',
          limit: '200',
        });
        const res = await fetch(`${API_BASE}/public/events?${params.toString()}`);
        const responseText = await res.text();
        let data = null;
        if (responseText) {
          try {
            data = JSON.parse(responseText);
          } catch (parseErr) {
            console.error('Failed to parse TGP events payload', parseErr, responseText);
          }
        }
        if (!res.ok) {
          console.error('TGP events API returned non-200', { status: res.status, body: responseText });
          if (mounted) {
            setEvents([]);
            setEventsError(data?.message || data?.error || `Server returned status ${res.status}.`);
          }
          return;
        }
        if (mounted && data && data.success && Array.isArray(data.events)) {
          setEvents(data.events);
          setEventsError('');
        } else if (mounted) {
          setEvents([]);
          setEventsError('Events list is temporarily unavailable. Please try again soon.');
        }
      } catch (err) {
        console.error('Failed to fetch TGP events', err);
        if (mounted) {
          setEvents([]);
          setEventsError('Events list is temporarily unavailable. Please try again soon.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchEvents();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation />
      <AnnouncementBanner />

      <main id="main" role="main">
        <Hero variant="tgp" ctaTarget="schedule" />

        <section id="schedule" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold">Upcoming at The Gathering Place</h2>
              <p className="text-gray-300 mt-2">DJ nights, recurring dance sessions, and private-friendly bookings.</p>
            </div>
            <Schedule events={events} loading={loading} errorMessage={eventsError} />
          </div>
        </section>

        <section id="suggest" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <ArtistSuggestion />
          </div>
        </section>
      </main>

      <Footer onAdminClick={onAdminClick} onNavigate={onNavigate} />
    </div>
  );
}
