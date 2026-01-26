import React, { useState, useEffect, useMemo } from 'react';
import Navigation from '../components/Navigation';
import AnnouncementBanner from '../components/AnnouncementBanner';
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
import { API_BASE } from '../apiConfig';
import { getEventStartDate, getEventEndDate } from '../utils/eventFormat';
import { resolveEventImageUrl } from '../utils/imageVariants';

const SITE_BASE_URL = 'https://midwaymusichall.net';

const SERIES_OVERRIDES = [
  {
    key: 'community-jam',
    match: /jam session/i,
    schedule: 'Thursdays · 6:00 – 10:00 PM',
    summary: 'Open community jam hosted by local musicians.',
  },
  {
    key: 'dj-dan',
    match: /dancin'? dan|friday night dj/i,
    schedule: 'Fridays · 6:00 – 10:00 PM',
    summary: 'Friday Night DJ dance party with Dancin’ Dan.',
  },
  {
    key: 'cruise-in',
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

const BEACH_SERIES_TAGS = ['beach_music', 'beach_series', 'carolina_beach_music_series', 'beach_band'];
const BEACH_SERIES_PHRASES = ['carolina beach music series', 'beach music series'];
const BEACH_SERIES_LINEUP = [
  'the embers',
  'special occasion band',
  'gary lowder and smokin hot',
  'the entertainers',
  'the catalinas',
  'jim quick and coastline',
  'too much sylvia',
  'band of oz',
];

const normalizeLower = (value) => {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).toLowerCase();
};

const hasBeachSeriesPhrase = (value = '') => {
  const lower = normalizeLower(value);
  return BEACH_SERIES_PHRASES.some((phrase) => lower.includes(phrase));
};

const isBeachSeriesEvent = (event = {}) => {
  const categorySlug = (event.category_slug || '').toLowerCase();
  if (categorySlug === 'beach-bands') {
    return true;
  }
  const title = `${event.artist_name || event.title || ''}`.toLowerCase();
  if (/dj/i.test(title)) {
    return false;
  }
  const tags = (parseTags(event.category_tags) || []).map((tag) => tag.toLowerCase());
  if (tags.some((tag) => BEACH_SERIES_TAGS.includes(tag))) {
    return true;
  }
  if (hasBeachSeriesPhrase(event.venue_section)) return true;
  if (hasBeachSeriesPhrase(event.series_name) || hasBeachSeriesPhrase(event.series_label)) return true;
  if (hasBeachSeriesPhrase(event.notes)) return true;
  if (BEACH_SERIES_LINEUP.some((name) => title.includes(name))) return true;
  return false;
};

const getEventDateValue = (event) => getEventStartDate(event);

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

const EVENT_STATUS_MAP = {
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
  rescheduled: 'https://schema.org/EventRescheduled',
};

const sanitizeDescription = (value = '') => {
  if (!value || typeof value !== 'string') {
    return '';
  }
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
};

const coerceDecimal = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(num) ? num : null;
};

const resolveEventOffer = (event, baseUrl, startDate) => {
  const prices = [
    coerceDecimal(event.ticket_price),
    coerceDecimal(event.door_price),
    coerceDecimal(event.min_ticket_price),
    coerceDecimal(event.max_ticket_price),
  ].filter((price) => price !== null && price >= 0);
  const minPrice = prices.length ? Math.min(...prices) : null;
  return {
    '@type': 'Offer',
    priceCurrency: 'USD',
    price: (minPrice !== null ? minPrice : 0).toFixed(2),
    availability: 'https://schema.org/InStock',
    url: event.id ? `${baseUrl}/#event-${event.id}` : baseUrl,
    validFrom: startDate ? startDate.toISOString() : undefined,
  };
};

const resolveEventStatus = (event) => {
  const status = (event.status || '').toLowerCase();
  return EVENT_STATUS_MAP[status] || 'https://schema.org/EventScheduled';
};

const lookupSeriesMetadata = (master) => {
  const override = SERIES_OVERRIDES.find((item) => item.match.test(master.title || master.artist_name || ''));
  const getTrimmed = (value) => (typeof value === 'string' ? value.trim() : '');
  const customSummary = getTrimmed(master.series_summary);
  const customSchedule = getTrimmed(master.series_schedule_label);
  const customFooter = getTrimmed(master.series_footer_note);
  const summary = customSummary || override?.summary || master.description || master.notes || 'Recurring community series.';
  const scheduleLabel = customSchedule || override?.schedule || 'Recurring schedule';
  const footerNote = customFooter || null;
  return { summary, scheduleLabel, footerNote, overrideKey: override?.key || null };
};

const getSeriesDisplayName = (event = {}) => event.series_label || event.artist_name || event.title || 'Recurring Series';

const normalizeSeriesKey = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'series';

const buildRecurringSeries = (masters, occurrences, now) => {
  const occMap = new Map();
  occurrences.forEach((occ) => {
    if (!occ.series_master_id) return;
    if (!occMap.has(occ.series_master_id)) {
      occMap.set(occ.series_master_id, []);
    }
    occMap.get(occ.series_master_id).push(occ);
  });

  const usedKeys = new Set();
  const registerKey = (baseKey, fallbackSuffix) => {
    let key = baseKey || null;
    if (key && !usedKeys.has(key)) {
      usedKeys.add(key);
      return key;
    }
    const suffix = fallbackSuffix ? `-${fallbackSuffix}` : `-${usedKeys.size + 1}`;
    const sanitizedBase = baseKey || 'series';
    key = `${sanitizedBase}${suffix}`;
    let attempt = key;
    let counter = 1;
    while (usedKeys.has(attempt)) {
      counter += 1;
      attempt = `${key}-${counter}`;
    }
    usedKeys.add(attempt);
    return attempt;
  };

  const buildPayload = (reference, masterId, occList = []) => {
    const filtered = occList.filter((occ) => {
      const dt = getEventDateValue(occ);
      return dt && dt >= now;
    }).sort((a, b) => {
      const aDate = getEventDateValue(a);
      const bDate = getEventDateValue(b);
      return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
    });
    const masterLike = reference || filtered[0];
    if (!masterLike && !filtered.length) {
      return null;
    }
    const nextOccurrence = filtered[0] || null;
    if (!nextOccurrence && !filtered.length) {
      return null;
    }
    const happeningThisWeek = nextOccurrence ? sameWeek(getEventDateValue(nextOccurrence), now) : false;
    const { summary, scheduleLabel, footerNote, overrideKey } = lookupSeriesMetadata(masterLike || {});
    const displayNameSource = masterLike || {};
    const fallbackBaseKey = normalizeSeriesKey(getSeriesDisplayName(displayNameSource));
    const baseKey = overrideKey || fallbackBaseKey;
    const key = registerKey(baseKey, masterId || reference?.id || filtered[0]?.id);
    const sourceIds = [
      reference?.id,
      masterId && (!reference || reference.id !== masterId) ? masterId : null,
      ...filtered.map((occ) => occ.id),
    ].filter(Boolean);

    return {
      key,
      master: reference || masterLike,
      nextOccurrence,
      upcomingOccurrences: filtered.slice(0, 6),
      happeningThisWeek,
      summary,
      scheduleLabel,
      footerNote,
      sourceEventIds: Array.from(new Set(sourceIds)),
    };
  };

  const series = [];
  masters.forEach((master) => {
    const payload = buildPayload(master, master.id, occMap.get(master.id) || []);
    if (payload) {
      series.push(payload);
    }
    occMap.delete(master.id);
  });

  occMap.forEach((occList, masterId) => {
    const payload = buildPayload(occList[0], masterId, occList);
    if (payload) {
      series.push(payload);
    }
  });

  return series.filter((item) => item.nextOccurrence || item.upcomingOccurrences.length);
};

const buildManualRecurringSeries = (events, now, existingKeys = new Set()) => SERIES_OVERRIDES.map((override) => {
  const key = override.key || normalizeSeriesKey(override.scheduleLabel || override.summary || override.match.toString());
  if (existingKeys.has(key)) {
    return null;
  }
  const matched = events.filter((event) => override.match.test(event.title || event.artist_name || ''));
  if (!matched.length) {
    return null;
  }
  const upcoming = matched.filter((event) => {
    const dt = getEventDateValue(event);
    return dt && dt >= now;
  }).sort((a, b) => {
    const aDate = getEventDateValue(a);
    const bDate = getEventDateValue(b);
    return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
  });
  const nextOccurrence = upcoming[0] || null;
  return {
    key,
    master: matched[0],
    nextOccurrence,
    upcomingOccurrences: upcoming.slice(0, 6),
    happeningThisWeek: nextOccurrence ? sameWeek(getEventDateValue(nextOccurrence), now) : false,
    summary: override.summary,
    scheduleLabel: override.schedule,
    footerNote: null,
    sourceEventIds: matched.map((event) => event.id).filter(Boolean),
  };
}).filter(Boolean);

const DEV_MODE = process.env.NODE_ENV !== 'production';
let hasLoggedRecurringWarning = false;
let hasLoggedBeachWarning = false;

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

  const decoratedOccurrences = occurrences.map((event) => ({
    ...event,
    isBeachSeries: isBeachSeriesEvent(event),
  }));

  const recurringSeriesBase = buildRecurringSeries(masters, decoratedOccurrences, startOfToday);
  const existingRecurringKeys = new Set(recurringSeriesBase.map((series) => series.key));
  const recurringCandidates = decoratedOccurrences.length
    ? [...decoratedOccurrences, ...decoratedSingles]
    : decoratedSingles;
  const manualRecurring = buildManualRecurringSeries(recurringCandidates, startOfToday, existingRecurringKeys);
  const recurringSeries = [...recurringSeriesBase, ...manualRecurring];
  const recurringEventIds = new Set(
    manualRecurring.flatMap((series) => series.sourceEventIds || []),
  );

  const sortedSingles = decoratedSingles
    .filter((event) => {
      if (recurringEventIds.has(event.id)) {
        return false;
      }
      const dt = getEventDateValue(event);
      return dt ? dt >= startOfToday : true;
    })
    .sort((a, b) => {
      const aDate = getEventDateValue(a);
      const bDate = getEventDateValue(b);
      return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
    });

  const featuredEvents = sortedSingles.slice(0, 3);
  const beachEligibleEvents = decoratedSingles.filter((event) => event.isBeachSeries);
  const beachEvents = sortedSingles.filter((event) => event.isBeachSeries);

  if (DEV_MODE && !recurringSeries.length && !hasLoggedRecurringWarning && events.length) {
    hasLoggedRecurringWarning = true;
    console.warn('Recurring events section has no entries.', {
      totalFetched: events.length,
      singlesConsidered: decoratedSingles.length,
      recurrenceCandidates: recurringCandidates.length,
      automaticSeries: recurringSeriesBase.length,
      manualSeries: manualRecurring.length,
    });
  }
  if (DEV_MODE && !beachEvents.length && beachEligibleEvents.length > 0 && !hasLoggedBeachWarning) {
    hasLoggedBeachWarning = true;
    console.warn('Beach Music series is empty despite matching acts.', {
      totalFetched: events.length,
      singlesConsidered: decoratedSingles.length,
      beachEligibleCount: beachEligibleEvents.length,
      beachEventNames: beachEligibleEvents.map((event) => event.artist_name || event.title),
    });
  }

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
  const [eventsError, setEventsError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const fetchEvents = async () => {
      setLoadingEvents(true);
      setEventsError('');
      try {
        const params = new URLSearchParams({
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
            console.error('Failed to parse events payload', parseErr, responseText);
          }
        }
        if (!res.ok) {
          console.error('Events API returned non-200', { status: res.status, body: responseText });
          if (isMounted) {
            setEvents([]);
            setEventsError(data?.message || data?.error || `Server returned status ${res.status}.`);
          }
          return;
        }
        if (isMounted && data && data.success && Array.isArray(data.events)) {
          setEvents(data.events);
          setEventsError('');
        } else if (isMounted) {
          console.error('Unexpected events payload', data);
          setEvents([]);
          setEventsError('Events list is temporarily unavailable. Please try again soon.');
        }
      } catch (err) {
        console.error('Failed to fetch events', err);
        if (isMounted) {
          setEvents([]);
          setEventsError('Events list is temporarily unavailable. Please try again soon.');
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
  const eventSchema = useMemo(() => {
    const baseUrl = SITE_BASE_URL;
    const graph = mainEvents.slice(0, 8).map((event) => {
      const start = getEventStartDate(event);
      const end = getEventEndDate(event);
      if (!start) return null;
      const venueName =
        event.venue_code === 'TGP'
          ? 'The Gathering Place'
          : 'Midway Music Hall';
      const imageUrl = resolveEventImageUrl(event, `${baseUrl}/og-image.png`);
      const description =
        sanitizeDescription(event.description) ||
        sanitizeDescription(event.notes) ||
        'Live music event at Midway Music Hall.';
      const performerName = (event.artist_name || event.title || '').trim();
      const performer = performerName
        ? {
            '@type': 'MusicGroup',
            name: performerName,
          }
        : undefined;

      return {
        '@type': 'Event',
        name: event.artist_name || event.title || 'Midway Music Hall Event',
        startDate: start.toISOString(),
        endDate: end ? end.toISOString() : undefined,
        url: event.id ? `${baseUrl}/#event-${event.id}` : baseUrl,
        image: imageUrl,
        description,
        eventStatus: resolveEventStatus(event),
        performer,
        offers: [resolveEventOffer(event, baseUrl, start)],
        location: {
          '@type': 'Place',
          name: venueName,
          address: {
            '@type': 'PostalAddress',
            streetAddress: '11141 Old US Hwy 52',
            addressLocality: 'Winston-Salem',
            addressRegion: 'NC',
            postalCode: '27107',
            addressCountry: 'US',
          },
        },
        organizer: {
          '@type': 'Organization',
          name: 'Midway Music Hall',
          url: baseUrl,
          email: 'midwayeventcenter@gmail.com',
          telephone: '(336) 793-4218',
        },
      };
    }).filter(Boolean);
    if (!graph.length) return null;
    return {
      '@context': 'https://schema.org',
      '@graph': graph,
    };
  }, [mainEvents]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navigation />
      <AnnouncementBanner />

      <main id="main" role="main">
        <Hero />
        <FirstTimeHere />
        <FeaturedEvents events={featuredEvents} loading={loadingEvents} />
        <RecurringEvents series={recurringSeries} />
        <LessonsSection />
        <BeachSeriesShowcase events={beachEvents} />

        <section id="schedule" className="py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <Schedule events={mainEvents} loading={loadingEvents} errorMessage={eventsError} />
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
      {eventSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(eventSchema) }}
        />
      )}
    </div>
  );
}
