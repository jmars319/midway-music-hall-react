import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import Hero from '../components/Hero';
import Schedule from '../components/Schedule';
import SeatingChart from '../components/SeatingChart';
import ArtistSuggestion from '../components/ArtistSuggestion';
import About from '../components/About';
import Footer from '../components/Footer';
// HomePage: main public landing page that composes Hero, Schedule, SeatingChart, etc.
import { API_BASE } from '../App';

export default function HomePage({ onAdminClick }) {
  const [events, setEvents] = useState([]);
  const [seatingConfig, setSeatingConfig] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingSeating, setLoadingSeating] = useState(true);

  useEffect(() => {
    fetchEvents();
    fetchSeating();
  }, []);

  const fetchEvents = async () => {
    setLoadingEvents(true);
    try {
      const res = await fetch(`${API_BASE}/events`);
      const data = await res.json();
      if (data.success && Array.isArray(data.events)) {
        setEvents(data.events);
      } else {
        setEvents([]);
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  };

  const fetchSeating = async () => {
    setLoadingSeating(true);
    try {
      const res = await fetch(`${API_BASE}/seating`);
      const data = await res.json();
      if (data.success && Array.isArray(data.seating)) {
        setSeatingConfig(data.seating);
      } else {
        setSeatingConfig([]);
      }
    } catch (err) {
      console.error('Failed to fetch seating', err);
      setSeatingConfig([]);
    } finally {
      setLoadingSeating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation onAdminClick={onAdminClick} />

      <main>
        <Hero />

        <section id="schedule" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Schedule events={events} loading={loadingEvents} />
          </div>
        </section>

        <section id="seating" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <SeatingChart seatingConfig={seatingConfig} events={events} />
          </div>
        </section>

        <section id="suggest" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <ArtistSuggestion />
          </div>
        </section>

        <section id="about" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <About />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

