import React, { useEffect, useState } from 'react';
import Navigation from '../components/Navigation';
import Hero from '../components/Hero';
import Schedule from '../components/Schedule';
import ArtistSuggestion from '../components/ArtistSuggestion';
import Footer from '../components/Footer';
import { API_BASE } from '../App';

export default function GatheringPlacePage({ onAdminClick, onNavigate }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/public/events?venue=TGP`);
        const data = await res.json();
        if (mounted && data.success && Array.isArray(data.events)) {
          setEvents(data.events);
        } else if (mounted) {
          setEvents([]);
        }
      } catch (err) {
        console.error('Failed to fetch TGP events', err);
        if (mounted) {
          setEvents([]);
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

      <main>
        <Hero variant="tgp" ctaTarget="schedule" />

        <section id="schedule" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold">Upcoming at The Gathering Place</h2>
              <p className="text-gray-300 mt-2">DJ nights, recurring dance sessions, and private-friendly bookings.</p>
            </div>
            <Schedule events={events} loading={loading} />
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
