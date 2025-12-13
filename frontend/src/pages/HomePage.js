import React, { useState, useEffect, useMemo } from 'react';
import Navigation from '../components/Navigation';
import Hero from '../components/Hero';
import FeaturedEvents from '../components/FeaturedEvents';
import RecurringEvents from '../components/RecurringEvents';
import LessonsSection from '../components/LessonsSection';
import BeachSeriesShowcase from '../components/BeachSeriesShowcase';
import FirstTimeHere from '../components/FirstTimeHere';
import Schedule from '../components/Schedule';
import ArtistSuggestion from '../components/ArtistSuggestion';
import About from '../components/About';
import MapSection from '../components/MapSection';
import Footer from '../components/Footer';
import BackToTopButton from '../components/BackToTopButton';
import { API_BASE } from '../App';

const SERIES_OVERRIDES = [
  {
    match: /jam session/i,
    schedule: 'Thursdays · 6:00 – 10:00 PM',
    summary: 'Open community jam hosted by local musicians.',
  },
  {
    match: /dancin'? dan|friday night dj/i,
    schedule: 'Fridays · 6:00 – 10:00 PM',
    summary: 'Friday Night DJ dance party with Dancin’ Dan.',
  },
  {
    match: /cruise in/i,
    schedule: 'Monthly Cruise-In',
    summary: 'Classic cars, vendors, and community hangouts.',
  },
];

const parseTags = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return value.split(',').map((tag) => tag.trim());
    }
  }
  return [];
};

const isBeachSeriesEvent = (event) => {
  const haystack = [
    event.genre,
    event.notes,
    event.description,
    event.title,
    event.artist_name,
    ...(parseTags(event.category_tags) || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes('beach') || haystack.includes('shag');
};

const getEventDateValue = (event) => {
  if (event.start_datetime) {
    const dt = new Date(event.start_datetime);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  if (event.event_date) {
    const dt = new Date(`${event.event_date}T${event.event_time || '00:00:00'}`);
    if (!Number.isNaN(dt.getTime())) {
      return dt;
    }
  }
  return null;
};

const sameWeek = (date, now) => {
  if (!date) return false;
  const copy = new Date(now);
  const day = copy.getDay();
  const diff = (day + 6) % 7; // make Monday start
  const weekStart = new Date(copy);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(copy.getDate() - diff);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return date >= weekStart && date <= weekEnd;
};

const lookupSeriesMetadata = (master) => {
  const override = SERIES_OVERRIDES.find((item) => item.match.test(master.title || master.artist_name || ''));
  const summary = override?.summary || master.description || master.notes || 'Recurring community series.';
  const scheduleLabel = override?.schedule || 'Recurring schedule';
  return { summary, scheduleLabel };
};

const buildRecurringSeries = (masters, occurrences, now) => {
  const occMap = new Map();
  occurrences.forEach((occ) => {
    if (!occ.series_master_id) return;
    if (!occMap.has(occ.series_master_id)) {
      occMap.set(occ.series_master_id, []);
    }
    occMap.get(occ.series_master_id).push(occ);
  });

  return masters.map((master) => {
    const seriesOccurrences = (occMap.get(master.id) || []).filter((occ) => {
      const dt = getEventDateValue(occ);
      return dt && dt >= now;
    }).sort((a, b) => {
      const aDate = getEventDateValue(a);
      const bDate = getEventDateValue(b);
      return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
    });
    const nextOccurrence = seriesOccurrences[0] || null;
    const happeningThisWeek = nextOccurrence ? sameWeek(getEventDateValue(nextOccurrence), now) : false;
    const { summary, scheduleLabel } = lookupSeriesMetadata(master);

    return {
      master,
      nextOccurrence,
      upcomingOccurrences: seriesOccurrences.slice(0, 6),
      happeningThisWeek,
      summary,
      scheduleLabel,
    };
  }).filter((item) => item.nextOccurrence || item.upcomingOccurrences.length);
};

const transformEvents = (events) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const masters = [];
  const occurrences = [];
  const singles = [];

  events.forEach((event) => {
    if (event.is_series_master) {
      masters.push(event);
      return;
    }
    if (event.series_master_id) {
      occurrences.push(event);
      return;
    }
    singles.push(event);
  });

  const decoratedSingles = singles.map((event) => ({
    ...event,
    isBeachSeries: isBeachSeriesEvent(event),
  }));

  const sortedSingles = decoratedSingles
    .filter((event) => {
      const dt = getEventDateValue(event);
      return dt ? dt >= startOfToday : true;
    })
    .sort((a, b) => {
      const aDate = getEventDateValue(a);
      const bDate = getEventDateValue(b);
      return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
    });

  const featuredEvents = sortedSingles.slice(0, 3);
  const recurringSeries = buildRecurringSeries(masters, occurrences, startOfToday);
  const beachEvents = sortedSingles.filter((event) => event.isBeachSeries);

  return {
    featuredEvents,
    mainEvents: sortedSingles,
    recurringSeries,
    beachEvents,
  };
};

export default function HomePage({ onAdminClick, onNavigate }) {
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchEvents = async () => {
      setLoadingEvents(true);
      try {
        const res = await fetch(`${API_BASE}/public/events`);
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.events)) {
          setEvents(data.events);
        } else if (isMounted) {
          setEvents([]);
        }
      } catch (err) {
        console.error('Failed to fetch events', err);
        if (isMounted) {
          setEvents([]);
        }
      } finally {
        if (isMounted) {
          setLoadingEvents(false);
        }
      }
    };

    fetchEvents();
    return () => {
      isMounted = false;
    };
  }, []);

  const { featuredEvents, mainEvents, recurringSeries, beachEvents } = useMemo(
    () => transformEvents(events),
    [events]
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation />

      <main>
        <Hero />
        <FirstTimeHere />
        <FeaturedEvents events={featuredEvents} loading={loadingEvents} />
        <RecurringEvents series={recurringSeries} />
        <LessonsSection />
        <BeachSeriesShowcase events={beachEvents} />

        <section id="schedule" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Schedule events={mainEvents} loading={loadingEvents} />
          </div>
        </section>

        <MapSection />

        <section id="about" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <About />
          </div>
        </section>

        <section id="suggest" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <ArtistSuggestion />
          </div>
        </section>
      </main>

      <BackToTopButton />
      <Footer onAdminClick={onAdminClick} onNavigate={onNavigate} />
    </div>
  );
}
