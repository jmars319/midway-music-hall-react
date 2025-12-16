// EventsModule: admin UI to create and manage events
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Edit, Copy, CheckCircle, XCircle, Archive as ArchiveIcon } from 'lucide-react';
import { API_BASE, getImageUrlSync } from '../apiConfig';
import ResponsiveImage from '../components/ResponsiveImage';
const SECTION_STORAGE_KEY = 'mmh_event_sections';

const VENUE_LABELS = {
  MMH: 'Midway Music Hall',
  TGP: 'The Gathering Place'
};

const TICKET_TYPE_LABELS = {
  general_admission: 'General Admission',
  reserved_seating: 'Reserved Seating',
  hybrid: 'Hybrid / Mixed'
};

const DEFAULT_STAFF_INBOX = 'midwayeventcenter@gmail.com';
const SEAT_ROUTING_SOURCE_LABELS = {
  event: 'Event override for this show',
  category: 'Category-specific inbox',
  category_slug: 'Beach Bands auto-routing',
  default: 'Default staff inbox',
};

const SESSION_TIMEZONE = 'America/New_York';

const SORT_OPTIONS = [
  { value: 'start_asc', label: 'Start date (upcoming first)' },
  { value: 'start_desc', label: 'Start date (recent first)' },
  { value: 'category', label: 'Category' },
  { value: 'venue', label: 'Venue' },
  { value: 'status', label: 'Status' },
  { value: 'title_az', label: 'Title (A–Z)' },
  { value: 'archived_state', label: 'Archived state' },
];

const GROUP_OPTIONS = [
  { value: 'category', label: 'Group by category' },
  { value: 'venue', label: 'Group by venue' },
];

const parseEventDate = (event) => {
  if (event.start_datetime) {
    const normalized = event.start_datetime.replace(' ', 'T');
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (event.event_date) {
    const normalized = `${event.event_date}T${event.event_time || '00:00:00'}`;
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};

const formatDateDisplay = (event) => {
  const date = parseEventDate(event);
  if (!date) return event.event_date || 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIMEZONE,
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(date);
};

const formatTimeDisplay = (event) => {
  const date = parseEventDate(event);
  if (!date) return event.event_time || 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
};

const formatDoorTime = (event) => {
  if (!event.door_time) return 'TBD';
  const normalized = event.door_time.includes('T') ? event.door_time : event.door_time.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return event.door_time;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_TIMEZONE,
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
};

const deriveDoorTimeInput = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const timePortion = raw.includes('T') ? raw.split('T')[1] : raw.includes(' ') ? raw.split(' ')[1] : raw;
  if (timePortion && timePortion.includes(':')) {
    const [hour, minute] = timePortion.split(':');
    if (hour !== undefined && minute !== undefined) {
      return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    }
  }
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    const hour = match[1].padStart(2, '0');
    return `${hour}:${match[2]}`;
  }
  return '';
};

const combineDateAndTime = (date, time) => {
  if (!date || !time) return null;
  const safeTime = time.length === 5 ? `${time}:00` : time;
  return `${date} ${safeTime}`;
};

const eventAllowsSeatRequests = (event = {}) => {
  if (!event) return false;
  if (Number(event.seating_enabled) === 1) return true;
  if (event.layout_id || event.layout_version_id) return true;
  return false;
};

const formatPrice = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return `$${num.toFixed(2).replace(/\.00$/, '')}`;
};

const formatPriceDisplay = (event) => {
  if (event.min_ticket_price && event.max_ticket_price && Number(event.min_ticket_price) !== Number(event.max_ticket_price)) {
    const min = formatPrice(event.min_ticket_price);
    const max = formatPrice(event.max_ticket_price);
    if (min && max) return `${min} - ${max}`;
  }
  return formatPrice(event.ticket_price) || formatPrice(event.door_price) || 'TBD';
};

const resolveSeatRoutingInfo = (event = {}) => {
  const email = event.seat_request_target_email || DEFAULT_STAFF_INBOX;
  const sourceKey = event.seat_request_target_source || 'default';
  const label = SEAT_ROUTING_SOURCE_LABELS[sourceKey] || SEAT_ROUTING_SOURCE_LABELS.default;
  return { email, sourceKey, label };
};

const normalizePriceInput = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  if (Number.isNaN(num)) return null;
  return Number(num.toFixed(2));
};

const isRecurringEvent = (event) => Boolean(event.is_series_master || event.series_master_id);

const normalizeVenueKey = (venueCode) => {
  const key = (venueCode || 'MMH').toUpperCase();
  return VENUE_LABELS[key] ? key : 'MMH';
};

const initialForm = {
  artist_name: '',
  event_date: '',
  event_time: '',
  door_time: '',
  genre: '',
  description: '',
  image_url: '',
  ticket_price: '',
  door_price: '',
  age_restriction: 'All Ages',
  venue_section: '',
  layout_id: '',
  category_id: '',
  seat_request_email_override: '',
  venue_code: 'MMH',
};

export default function EventsModule(){
  const [events, setEvents] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryError, setCategoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [collapsedSections, setCollapsedSections] = useState({});
  const [filters, setFilters] = useState({
    status: 'all',
    timeframe: 'upcoming',
    recurringOnly: false,
    seatingOnly: false,
    needsScheduleOnly: false,
    search: '',
    venue: 'all',
    category: 'all',
    sortBy: 'start_asc',
    groupBy: 'category',
  });
  const [listError, setListError] = useState('');
  const [seriesExpanded, setSeriesExpanded] = useState({});
  const [seriesActionId, setSeriesActionId] = useState(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const params = new URLSearchParams({
        limit: '500',
        scope: 'admin',
      });
      params.set('include_series_masters', '1');
      if (filters.status !== 'all') {
        params.set('status', filters.status);
      }
      if (filters.venue && filters.venue !== 'all') {
        params.set('venue', filters.venue);
      }
      if (filters.timeframe === 'archived') {
        params.set('archived', '1');
        params.set('timeframe', 'all');
      } else if (filters.timeframe === 'all') {
        params.set('archived', 'all');
        params.set('timeframe', 'all');
      } else {
        params.set('archived', '0');
        params.set('timeframe', filters.timeframe);
      }
      const res = await fetch(`${API_BASE}/events?${params.toString()}`);
      const responseText = await res.text();
      let data = null;
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch (parseErr) {
          console.error('Failed to parse admin events payload', parseErr, responseText);
        }
      }
      if (!res.ok) {
        console.error('Admin events API returned non-200', { status: res.status, body: responseText });
        setEvents([]);
        setListError(data?.message || data?.error || `Server returned status ${res.status}.`);
        return;
      }
      if (data && data.success && Array.isArray(data.events)) {
        setEvents(data.events);
        setListError('');
      } else {
        console.error('Unexpected admin events payload', data);
        setEvents([]);
        setListError(data?.message || 'Events list is temporarily unavailable.');
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
      setEvents([]);
      setListError('Events list is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.timeframe, filters.venue]);

  const fetchLayouts = async () => {
    try {
      const res = await fetch(`${API_BASE}/seating-layouts`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.layouts)) {
        setLayouts(data.layouts);
      }
    } catch (err) {
      console.error('Failed to fetch layouts', err);
    }
  };

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/event-categories`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.categories)) {
        setCategories(data.categories);
        setCategoryError('');
      } else {
        setCategoryError('Unable to load categories');
      }
    } catch (err) {
      console.error('Failed to load categories', err);
      setCategoryError('Unable to load categories');
    }
  }, []);

  useEffect(() => {
    fetchLayouts();
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SECTION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setCollapsedSections(parsed);
        }
      }
    } catch (err) {
      console.warn('Failed to read section state', err);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(collapsedSections));
    } catch (err) {
      console.warn('Failed to persist section state', err);
    }
  }, [collapsedSections]);

  const categoryLookup = useMemo(() => {
    const map = new Map();
    categories.forEach((cat) => {
      map.set(String(cat.id), cat);
    });
    return map;
  }, [categories]);

  const layoutNameForEvent = (event) => {
    if (!event.layout_id) return 'Not assigned';
    const found = layouts.find((layout) => String(layout.id) === String(event.layout_id));
    return found?.name || `Layout #${event.layout_id}`;
  };

  const categoryLabelForEvent = useCallback((event) => {
    if (!event) return 'Normal';
    if (event.category_name) return event.category_name;
    if (event.category_id && categoryLookup.has(String(event.category_id))) {
      return categoryLookup.get(String(event.category_id)).name;
    }
    if (event.category_slug === 'beach-bands') return 'Beach Bands';
    return 'Normal';
  }, [categoryLookup]);

  const categorySlugForEvent = useCallback((event) => {
    if (!event) return 'normal';
    if (event.category_slug) return event.category_slug;
    if (event.category_id && categoryLookup.has(String(event.category_id))) {
      return categoryLookup.get(String(event.category_id)).slug;
    }
    return 'normal';
  }, [categoryLookup]);

  const toggleSection = (sectionId) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const setAllSectionsState = (sectionIds, collapsed) => {
    setCollapsedSections((prev) => {
      const next = { ...prev };
      sectionIds.forEach((id) => {
        next[id] = collapsed;
      });
      return next;
    });
  };

  const normalizeEventStatus = (event) => (event?.status || 'draft').toLowerCase();
  const isEventArchived = (event) => Boolean(event?.archived_at);
  const buildSearchText = (event, extras = []) => {
    const haystack = [
      event.artist_name,
      event.title,
      event.genre,
      event.notes,
      event.description,
      event.venue_section,
      event.ticket_url,
      ...extras,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack;
  };
  const occurrenceDateForInstance = (event) => {
    if (event.event_date) return event.event_date;
    if (event.start_datetime) {
      return event.start_datetime.split(' ')[0];
    }
    return null;
  };

  const eventItems = useMemo(() => {
    if (!events.length) return [];
    const seriesMap = new Map();
    const ensureSeriesEntry = (id) => {
      const key = Number(id);
      if (!seriesMap.has(key)) {
        seriesMap.set(key, { master: null, instances: [] });
      }
      return seriesMap.get(key);
    };
    events.forEach((event) => {
      if (Number(event.is_series_master) === 1) {
        ensureSeriesEntry(event.id).master = event;
      }
    });
    events.forEach((event) => {
      if (event.series_master_id) {
        ensureSeriesEntry(event.series_master_id).instances.push(event);
      }
    });
    const items = [];
    const createSingleItem = (event) => {
      const status = normalizeEventStatus(event);
      const archived = isEventArchived(event);
      const bucket = archived ? 'archived' : (status === 'published' ? 'published' : 'drafts');
      const date = parseEventDate(event);
      const hasSeating = eventAllowsSeatRequests(event);
      const titleSortValue = `${event.artist_name || event.title || ''}`.toLowerCase();
      return {
        type: 'event',
        id: `event-${event.id}`,
        event,
        bucket,
        status,
        venueCode: normalizeVenueKey(event.venue_code),
        categorySlug: categorySlugForEvent(event),
        categoryLabel: categoryLabelForEvent(event),
        searchText: buildSearchText(event),
        sortDate: date ? date.getTime() : 0,
        hasSeating,
        needsSchedule: Boolean(event.missing_schedule),
        titleSortValue,
      };
    };
    const createSeriesItem = (entry) => {
      const master = entry.master;
      const sortedInstances = [...entry.instances].sort((a, b) => {
        const aDate = parseEventDate(a);
        const bDate = parseEventDate(b);
        const aVal = aDate ? aDate.getTime() : 0;
        const bVal = bDate ? bDate.getTime() : 0;
        return aVal - bVal;
      });
      let publishedCount = 0;
      let draftCount = 0;
      let archivedCount = 0;
      let skippedCount = 0;
      let hasSeating = false;
      sortedInstances.forEach((instance) => {
        const status = normalizeEventStatus(instance);
        const archived = isEventArchived(instance);
        if (archived || status === 'archived') {
          archivedCount += 1;
        } else if (status === 'published') {
          publishedCount += 1;
        } else {
          draftCount += 1;
        }
        if (instance.skipped_instance_exception_id) {
          skippedCount += 1;
        }
        if (eventAllowsSeatRequests(instance)) {
          hasSeating = true;
        }
      });
      if (!hasSeating && master && eventAllowsSeatRequests(master)) {
        hasSeating = true;
      }
      const nextInstance = sortedInstances.find(
        (instance) => !instance.skipped_instance_exception_id && !isEventArchived(instance)
      ) || sortedInstances[0] || null;
      const nextDate = nextInstance ? parseEventDate(nextInstance) : null;
      const bucket = publishedCount > 0 ? 'published' : (draftCount > 0 ? 'drafts' : 'archived');
      const categorySlug = categorySlugForEvent(master || nextInstance);
      const categoryLabel = categoryLabelForEvent(master || nextInstance);
      const venueCode = normalizeVenueKey((master && master.venue_code) || (nextInstance && nextInstance.venue_code));
      const searchText = buildSearchText(master || nextInstance || {}, sortedInstances.map((inst) => inst.event_date));
      const masterId = master ? master.id : (sortedInstances[0]?.series_master_id ?? `temp-${sortedInstances[0]?.id ?? Date.now()}`);
      const hasMissingInstance = sortedInstances.some((instance) => instance.missing_schedule);
      const needsSchedule = Boolean((master && master.missing_schedule) || hasMissingInstance);
      const masterTitle = master?.artist_name || master?.title || nextInstance?.artist_name || nextInstance?.title || 'Recurring Series';
      return {
        type: 'series',
        id: `series-${masterId}`,
        master,
        instances: sortedInstances,
        bucket,
        categorySlug,
        categoryLabel,
        venueCode,
        searchText,
        sortDate: nextDate ? nextDate.getTime() : 0,
        hasSeating,
        needsSchedule,
        titleSortValue: masterTitle.toLowerCase(),
        summary: {
          publishedCount,
          draftCount,
          archivedCount,
          skippedCount,
          totalInstances: sortedInstances.length,
          nextInstance,
        },
      };
    };
    events.forEach((event) => {
      if (event.series_master_id) {
        return;
      }
      if (Number(event.is_series_master) === 1) {
        const entry = seriesMap.get(Number(event.id)) || { master: event, instances: [] };
        entry.master = event;
        items.push(createSeriesItem(entry));
      } else {
        items.push(createSingleItem(event));
      }
    });
    seriesMap.forEach((entry, masterId) => {
      if (!entry.master && entry.instances.length) {
        const placeholder = { ...entry.instances[0], id: masterId, is_series_master: 1 };
        entry.master = placeholder;
        items.push(createSeriesItem(entry));
      }
    });
    return items;
  }, [events, categoryLabelForEvent, categorySlugForEvent]);

  const filteredItems = useMemo(() => {
    if (!eventItems.length) return [];
    const searchValue = filters.search.trim().toLowerCase();
    return eventItems.filter((item) => {
      if (filters.recurringOnly && item.type !== 'series') {
        return false;
      }
      if (filters.seatingOnly && !item.hasSeating) {
        return false;
      }
      if (filters.needsScheduleOnly && !item.needsSchedule) {
        return false;
      }
      if (filters.category !== 'all' && item.categorySlug !== filters.category) {
        return false;
      }
      if (filters.venue !== 'all' && item.venueCode !== filters.venue) {
        return false;
      }
      if (filters.status !== 'all') {
        const bucketKey = filters.status === 'draft' ? 'drafts' : filters.status;
        if (item.bucket !== bucketKey) {
          return false;
        }
      }
      if (searchValue && item.searchText && !item.searchText.includes(searchValue)) {
        return false;
      }
      return true;
    });
  }, [eventItems, filters]);

  const sortedItems = useMemo(() => {
    const compare = (a, b) => {
      switch (filters.sortBy) {
        case 'start_desc':
          return (b.sortDate || 0) - (a.sortDate || 0);
        case 'category':
          return (a.categoryLabel || '').localeCompare(b.categoryLabel || '');
        case 'venue':
          return (VENUE_LABELS[a.venueCode] || a.venueCode || '').localeCompare(VENUE_LABELS[b.venueCode] || b.venueCode || '');
        case 'status':
          const order = { published: 0, drafts: 1, archived: 2 };
          return (order[a.bucket] ?? 3) - (order[b.bucket] ?? 3);
        case 'title_az':
          return (a.titleSortValue || '').localeCompare(b.titleSortValue || '');
        case 'archived_state':
          return (a.bucket === 'archived' ? 1 : 0) - (b.bucket === 'archived' ? 1 : 0);
        case 'start_asc':
        default:
          return (a.sortDate || 0) - (b.sortDate || 0);
      }
    };
    return [...filteredItems].sort(compare);
  }, [filteredItems, filters.sortBy]);

  const groupedSections = useMemo(() => {
    if (!sortedItems.length) return [];
    const groups = new Map();
    sortedItems.forEach((item) => {
      const groupKey = filters.groupBy === 'venue'
        ? `venue-${item.venueCode || 'unknown'}`
        : `category-${item.categorySlug || 'normal'}`;
      const label = filters.groupBy === 'venue'
        ? (VENUE_LABELS[item.venueCode] || 'Events')
        : (item.categoryLabel || 'Normal');
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          label,
          published: [],
          drafts: [],
          archived: [],
        });
      }
      const bucketKey = item.bucket || 'drafts';
      const target = groups.get(groupKey);
      if (bucketKey === 'published') {
        target.published.push(item);
      } else if (bucketKey === 'archived') {
        target.archived.push(item);
      } else {
        target.drafts.push(item);
      }
    });
    return Array.from(groups.values());
  }, [sortedItems, filters.groupBy]);

  const sectionIds = useMemo(() => groupedSections.flatMap((group) => {
    const ids = [
      `${group.key}-published`,
      `${group.key}-drafts`,
    ];
    if (group.archived.length) {
      ids.push(`${group.key}-archived`);
    }
    return ids;
  }), [groupedSections]);

  const categoryOptions = useMemo(() => {
    if (!categories.length) return [];
    const currentSelection = formData.category_id ? String(formData.category_id) : '';
    return [...categories]
      .filter((cat) => cat.is_active || (currentSelection && String(cat.id) === currentSelection))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, formData.category_id]);

  const categoryFilterOptions = useMemo(() => {
    if (!categories.length) return [];
    return [...categories].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);
  const editingSeatRouting = useMemo(() => {
    if (!editing) return null;
    return resolveSeatRoutingInfo(editing);
  }, [editing]);

  const renderEventCard = (event) => {
    const eventTitle = event.artist_name || event.title || 'Untitled Event';
    const subtitle = event.title && event.title !== eventTitle ? event.title : event.notes;
    const ticketTypeLabel = TICKET_TYPE_LABELS[event.ticket_type] || 'General Admission';
    const priceCopy = formatPriceDisplay(event);
    const eventStatus = event.status || 'draft';
    const isArchived = Boolean(event.archived_at);
    const isPublished = eventStatus === 'published';
    const statusClasses = isPublished
      ? 'bg-green-500/15 text-green-200 border border-green-500/30'
      : isArchived
        ? 'bg-gray-500/15 text-gray-200 border border-gray-500/30'
        : 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30';
    const statusLabel = isPublished ? 'Published' : isArchived ? 'Archived' : 'Draft';
    const visibilityBadge = event.visibility === 'private'
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-500/20 text-gray-200 border border-gray-500/30">Private</span>
      : null;
    const recurrenceBadge = isRecurringEvent(event)
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">Recurring Series</span>
      : null;
    const seatingBadge = event.seating_enabled
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/30">Seating Enabled</span>
      : null;
    const categoryLabel = categoryLabelForEvent(event);
    const categoryInactive = event.category_is_active === 0 && event.category_name;
    const categoryBadge = categoryLabel
      ? (
        <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${categoryInactive ? 'bg-gray-700/40 text-gray-200 border-gray-500/30' : 'bg-cyan-500/15 text-cyan-100 border-cyan-500/30'}`}>
          {categoryInactive ? `${categoryLabel} (inactive)` : categoryLabel}
        </span>
      )
      : null;
    const imageSrc = getImageUrlSync(event.image_url || '');
    const archivedAtCopy = isArchived && event.deleted_at
      ? new Date(event.deleted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;
    const seatRouting = resolveSeatRoutingInfo(event);
    const hasSeatRequests = eventAllowsSeatRequests(event);
    const missingScheduleBadge = event.missing_schedule
      ? (
        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/40">
          Needs date &amp; time
        </span>
      )
      : null;

    return (
      <div key={event.id} className="bg-gray-900 rounded-xl border border-gray-700 p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row">
            <div className="w-full md:w-32 flex-shrink-0">
            <div className="w-full aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
              <ResponsiveImage src={imageSrc} alt={eventTitle} width={256} height={256} className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClasses}`}>
                {statusLabel}
              </span>
              {visibilityBadge}
              {recurrenceBadge}
              {missingScheduleBadge}
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">
                {ticketTypeLabel}
              </span>
              {seatingBadge}
              {categoryBadge}
            </div>
            <h4 className="text-lg font-semibold text-white">{eventTitle}</h4>
            {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
            {event.description && (
              <p className="text-sm text-gray-500">
                {event.description.length > 180 ? `${event.description.slice(0, 180)}…` : event.description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm text-gray-200">
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Date</p>
            <p>{formatDateDisplay(event)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Start Time</p>
            <p>{formatTimeDisplay(event)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Doors</p>
            <p>{event.door_time ? formatDoorTime(event) : 'TBD'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Price</p>
            <p>{priceCopy}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Category</p>
            <p>{categoryLabel}{categoryInactive ? ' (inactive)' : ''}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Venue Section</p>
            <p>{event.venue_section || VENUE_LABELS[normalizeVenueKey(event.venue_code)]}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Layout</p>
            <p>{layoutNameForEvent(event)}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Contact</p>
            <p>{event.contact_name || 'Donna Cheek'}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-gray-500 tracking-wide">Ticket Link</p>
            <p className="truncate">{event.ticket_url || 'Not provided'}</p>
          </div>
          {isArchived && (
            <div>
              <p className="text-xs uppercase text-gray-500 tracking-wide">Archived</p>
              <p>{archivedAtCopy || 'History only'}</p>
            </div>
          )}
        </div>

        <div className="mt-4 p-3 rounded-lg border border-gray-800 bg-gray-950/60 text-sm text-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">Seat requests</p>
          {hasSeatRequests ? (
            <>
              <p className="text-white font-semibold">{seatRouting.email}</p>
              <p className="text-xs text-gray-400">Route: {seatRouting.label}</p>
              {event.seat_request_email_override && (
                <p className="text-xs text-amber-200 mt-1">Event override in effect.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">Seat reservations are disabled for this event.</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => duplicateEvent(event)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
          >
            <Copy className="h-4 w-4" /> Duplicate
          </button>
          {isArchived ? (
            <button
              onClick={() => restoreEvent(event)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
            >
              <ArchiveIcon className="h-4 w-4" /> Restore
            </button>
          ) : (
            <>
              {isPublished ? (
                <button
                  onClick={() => unpublishEvent(event)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded"
                >
                  <XCircle className="h-4 w-4" /> Unpublish
                </button>
              ) : (
                <button
                  onClick={() => publishEvent(event)}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  <CheckCircle className="h-4 w-4" /> Publish
                </button>
              )}
              <button
                onClick={() => archiveEvent(event)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded"
              >
                <ArchiveIcon className="h-4 w-4" /> Archive
              </button>
              <button
                onClick={() => openEdit(event)}
                className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
              >
                <Edit className="h-4 w-4" /> Edit
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderSeriesInstanceRow = (seriesItem, instance) => {
    const status = normalizeEventStatus(instance);
    const archived = isEventArchived(instance);
    const statusClasses = status === 'published'
      ? 'bg-green-500/15 text-green-200 border border-green-500/30'
      : archived
        ? 'bg-gray-500/15 text-gray-200 border border-gray-500/30'
        : 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30';
    const statusLabel = archived ? 'Archived' : (status === 'published' ? 'Published' : 'Draft');
    const isSkipped = Boolean(instance.skipped_instance_exception_id);
    const isBusy = seriesActionId === instance.id;
    const missingSchedule = Boolean(instance.missing_schedule);
    return (
      <div key={`series-instance-${instance.id}`} className={`flex flex-col md:flex-row md:items-center justify-between gap-3 border border-gray-800 rounded-lg p-3 ${isSkipped ? 'bg-gray-900/60' : 'bg-gray-900/40'}`}>
        <div>
          <p className="text-base font-medium text-white">{formatDateDisplay(instance)} · {formatTimeDisplay(instance)}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClasses}`}>{statusLabel}</span>
            {isSkipped && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-red-500/15 text-red-200 border border-red-500/30">
                Skipped
              </span>
            )}
            {missingSchedule && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/40">
                Needs date &amp; time
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">Slug: {instance.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openEdit(instance)}
            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            Edit
          </button>
          {isSkipped ? (
            <button
              disabled={isBusy}
              onClick={() => unskipSeriesInstance(instance)}
              className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm disabled:opacity-50"
            >
              Re-enable
            </button>
          ) : (
            <button
              disabled={isBusy}
              onClick={() => skipSeriesInstance(instance)}
              className="px-3 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm disabled:opacity-50"
            >
              Skip Date
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSeriesCard = (seriesItem) => {
    const master = seriesItem.master || {};
    const eventTitle = master.artist_name || master.title || 'Recurring Series';
    const subtitle = master.title && master.title !== eventTitle ? master.title : master.notes;
    const expanded = !!seriesExpanded[seriesItem.id];
    const toggleSeries = () => {
      setSeriesExpanded((prev) => ({
        ...prev,
        [seriesItem.id]: !expanded,
      }));
    };
    const nextInstance = seriesItem.summary?.nextInstance;
    const instanceCount = seriesItem.summary?.totalInstances || seriesItem.instances.length;
    const skippedCount = seriesItem.summary?.skippedCount || 0;
    const seatRouting = resolveSeatRoutingInfo(master || seriesItem.summary?.nextInstance || {});
    const hasSeatRequests = Boolean(seriesItem.hasSeating);
    const missingScheduleBadge = seriesItem.needsSchedule ? (
      <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/40">
        Needs date &amp; time
      </span>
    ) : null;
    return (
      <div key={seriesItem.id} className="bg-gray-900 rounded-xl border border-blue-800/50 p-4 shadow-sm">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">
              Recurring Series
            </span>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-cyan-500/15 text-cyan-100 border border-cyan-500/30">
              {seriesItem.categoryLabel}
            </span>
            <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-500/15 text-gray-200 border border-gray-600">
              {VENUE_LABELS[seriesItem.venueCode] || 'Venue TBD'}
            </span>
            {missingScheduleBadge}
          </div>
          <div>
            <h4 className="text-lg font-semibold text-white">{eventTitle}</h4>
            {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
          </div>
          <p className="text-sm text-gray-400">
            {instanceCount} instances · {skippedCount} skipped · Next: {nextInstance ? `${formatDateDisplay(nextInstance)} (${formatTimeDisplay(nextInstance)})` : 'Not scheduled'}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={toggleSeries}
            className="px-4 py-2 rounded bg-amber-400 text-gray-900 text-sm font-semibold border border-amber-200 hover:bg-amber-300 transition"
          >
            {expanded ? 'Hide Dates' : 'Show Dates'}
          </button>
          <button
            type="button"
            onClick={() => openEdit(master)}
            className="px-3 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            Edit Series
          </button>
        </div>
        <div className="mt-4 p-3 rounded-lg border border-gray-800 bg-gray-950/60 text-sm text-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">Seat requests</p>
          {hasSeatRequests ? (
            <>
              <p className="text-white font-semibold">{seatRouting.email}</p>
              <p className="text-xs text-gray-400">Route: {seatRouting.label}</p>
            </>
          ) : (
            <p className="text-sm text-gray-400">Seat reservations disabled for this series.</p>
          )}
        </div>
        {expanded && (
          <div className="mt-4 space-y-3">
            {seriesItem.instances.length === 0 ? (
              <div className="p-4 bg-gray-900 border border-gray-800 rounded text-sm text-gray-400">
                No upcoming instances. Add dates from the event editor.
              </div>
            ) : (
              seriesItem.instances.map((instance) => renderSeriesInstanceRow(seriesItem, instance))
            )}
          </div>
        )}
      </div>
    );
  };

  const renderListItem = (item) => {
    if (item.type === 'series') {
      return renderSeriesCard(item);
    }
    return renderEventCard(item.event);
  };

  const renderEventSection = (heading, list, sectionId) => {
    const collapsed = !!collapsedSections[sectionId];
    return (
      <div className="mt-6" key={sectionId}>
        <button
          type="button"
          onClick={() => toggleSection(sectionId)}
          aria-expanded={!collapsed}
          className="w-full flex items-center justify-between mb-2 px-4 py-2 rounded-lg border border-gray-700 bg-gray-900/60 text-left focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <span className="text-lg font-semibold text-white">{heading}</span>
          <div className="flex items-center gap-3 text-sm text-gray-300">
            <span>{list.length} {list.length === 1 ? 'event' : 'events'}</span>
            <span className="text-xl leading-none">{collapsed ? '+' : '-'}</span>
          </div>
        </button>
        {collapsed ? null : (
          list.length === 0 ? (
            <div className="p-4 bg-gray-900 border border-dashed border-gray-700 rounded-lg text-sm text-gray-400">
              No events in this section.
            </div>
          ) : (
            <div className="space-y-4">
              {list.map(renderListItem)}
            </div>
          )
        )}
      </div>
    );
  };

  const openAdd = () => {
    setEditing(null);
    setFormData(initialForm);
    setImageFile(null);
    setImagePreview(null);
    setShowForm(true);
  };

  const openEdit = (event) => {
    setEditing(event);
    setFormData({
      artist_name: event.artist_name || '',
      event_date: event.event_date || '',
      event_time: event.event_time || '',
      door_time: deriveDoorTimeInput(event.door_time),
      genre: event.genre || '',
      description: event.description || '',
      image_url: event.image_url || '',
      ticket_price: event.ticket_price || '',
      door_price: event.door_price || '',
      age_restriction: event.age_restriction || 'All Ages',
      venue_section: event.venue_section || '',
      layout_id: event.layout_id || '',
      category_id: event.category_id ? String(event.category_id) : '',
      seat_request_email_override: event.seat_request_email_override || '',
      venue_code: event.venue_code || 'MMH',
    });
    setImageFile(null);
    setImagePreview(event.image_url ? getImageUrlSync(event.image_url) : null);
    setShowForm(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setFormData(prev => ({ ...prev, image_url: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      let finalImageUrl = formData.image_url;

      // If a new image file is selected, upload it
      if (imageFile) {
        const formDataUpload = new FormData();
        formDataUpload.append('image', imageFile);
        
        try {
          const uploadRes = await fetch(`${API_BASE}/upload-image`, {
            method: 'POST',
            body: formDataUpload,
          });
          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.url) {
            finalImageUrl = uploadData.url;
          }
        } catch (uploadErr) {
          console.error('Image upload error', uploadErr);
          setError('Image upload failed, but event will be saved without image');
        }
      }

      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${API_BASE}/events/${editing.id}` : `${API_BASE}/events`;
      const payload = { ...formData, image_url: finalImageUrl };
      payload.ticket_price = normalizePriceInput(payload.ticket_price);
      payload.door_price = normalizePriceInput(payload.door_price);
      const parsedLayoutId = payload.layout_id && payload.layout_id !== '' ? Number(payload.layout_id) : null;
      const normalizedLayoutId = Number.isFinite(parsedLayoutId) && parsedLayoutId > 0 ? parsedLayoutId : null;
      payload.layout_id = normalizedLayoutId;
      const parsedCategoryId = payload.category_id && payload.category_id !== '' ? Number(payload.category_id) : null;
      payload.category_id = Number.isFinite(parsedCategoryId) && parsedCategoryId > 0 ? parsedCategoryId : null;
      payload.seat_request_email_override = (payload.seat_request_email_override || '').trim() || null;
      if (!payload.layout_id) {
        payload.seating_enabled = false;
        payload.layout_version_id = null;
      } else if (typeof payload.seating_enabled === 'undefined') {
        payload.seating_enabled = true;
      }
      payload.venue_code = (payload.venue_code || 'MMH').toUpperCase();
      const normalizedDoorTime = combineDateAndTime(payload.event_date, payload.door_time);
      if (!normalizedDoorTime) {
        setError('Doors open time requires both an event date and a time.');
        setSubmitting(false);
        return;
      }
      payload.door_time = normalizedDoorTime;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data && data.success) {
        setShowForm(false);
        fetchEvents();
      } else {
        setError(data?.message || 'Failed to save event');
      }
    } catch (err) {
      console.error('Save event error', err);
      setError(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setSubmitting(false);
    }
  };

  const updateEventFields = async (id, payload, failureMessage = 'Failed to update event') => {
    try {
      const res = await fetch(`${API_BASE}/events/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
      } else {
        alert(data?.message || failureMessage);
      }
    } catch (err) {
      console.error('Event update error', err);
      alert(failureMessage);
    }
  };

  const publishEvent = async (event) => {
    await updateEventFields(event.id, { status: 'published', visibility: 'public' }, 'Failed to publish event');
  };

  const unpublishEvent = async (event) => {
    await updateEventFields(
      event.id,
      { status: 'draft', visibility: 'private' },
      'Failed to unpublish event'
    );
  };

  const archiveEvent = async (event) => {
    if (!window.confirm(`Archive "${event.artist_name || event.title || 'this event'}"?`)) return;
    try {
      const res = await fetch(`${API_BASE}/events/${event.id}/archive`, { method: 'POST' });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
      } else {
        alert(data?.message || 'Failed to archive event');
      }
    } catch (err) {
      console.error('Archive error', err);
      alert('Failed to archive event');
    }
  };

  const restoreEvent = async (event) => {
    try {
      const res = await fetch(`${API_BASE}/events/${event.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft', visibility: 'private' }),
      });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
      } else {
        alert(data?.message || 'Failed to restore event');
      }
    } catch (err) {
      console.error('Restore error', err);
      alert('Failed to restore event');
    }
  };

  const duplicateEvent = async (event) => {
    const baseName = event.artist_name || event.title || 'Untitled Event';
    const startParts = (event.start_datetime || '').split(' ');
    const fallbackDate = startParts[0] || '';
    const fallbackTime = startParts[1] ? startParts[1].slice(0, 5) : '';
    const eventDate = event.event_date || fallbackDate;
    const eventTime = event.event_time || fallbackTime;
    if (!eventDate || !eventTime) {
      alert('Please set a date and time before duplicating this event.');
      return;
    }
    if (!event.door_time) {
      alert('Please set a Doors Open time before duplicating this event.');
      return;
    }
    const payload = {
      artist_name: `${baseName} (Copy)`,
      title: event.title || '',
      description: event.description || '',
      notes: event.notes || '',
      genre: event.genre || '',
      event_date: eventDate,
      event_time: eventTime,
      door_time: event.door_time,
      ticket_price: event.ticket_price || '',
      door_price: event.door_price || '',
      min_ticket_price: event.min_ticket_price || '',
      max_ticket_price: event.max_ticket_price || '',
      ticket_type: event.ticket_type || 'general_admission',
      seating_enabled: Boolean(event.seating_enabled),
      venue_code: event.venue_code || 'MMH',
      venue_section: event.venue_section || '',
      layout_id: event.layout_id || null,
      ticket_url: event.ticket_url || '',
      contact_name: event.contact_name || '',
      contact_phone_raw: event.contact_phone_raw || event.contact_phone_normalized || '',
      contact_email: event.contact_email || '',
      age_restriction: event.age_restriction || 'All Ages',
      visibility: event.visibility || 'public',
      image_url: event.image_url || '',
      status: 'draft',
      category_tags: event.category_tags || null,
      category_id: event.category_id || null,
      hero_image_id: event.hero_image_id || null,
      poster_image_id: event.poster_image_id || null,
      seat_request_email_override: event.seat_request_email_override || null,
    };
    try {
      const res = await fetch(`${API_BASE}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
        alert('Event duplicated as a draft.');
      } else {
        alert(data?.message || 'Failed to duplicate event');
      }
    } catch (err) {
      console.error('Duplicate event error', err);
      alert('Failed to duplicate event');
    }
  };

  const skipSeriesInstance = async (instance) => {
    if (seriesActionId) return;
    if (!instance.series_master_id) {
      alert('This instance is not linked to a recurring series.');
      return;
    }
    const occurrenceDate = occurrenceDateForInstance(instance);
    if (!occurrenceDate) {
      alert('Unable to determine the event date for this instance.');
      return;
    }
    if (!window.confirm(`Hide ${instance.artist_name || instance.title || 'this event'} on ${occurrenceDate}?`)) {
      return;
    }
    setSeriesActionId(instance.id);
    try {
      const res = await fetch(`${API_BASE}/events/${instance.series_master_id}/recurrence/exceptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exception_date: occurrenceDate,
          exception_type: 'skip',
          notes: 'Hidden via admin panel',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to skip instance');
      }
      fetchEvents();
    } catch (err) {
      console.error('skipSeriesInstance error', err);
      alert(err.message || 'Failed to hide this date.');
    } finally {
      setSeriesActionId(null);
    }
  };

  const unskipSeriesInstance = async (instance) => {
    if (seriesActionId) return;
    const exceptionId = instance.skipped_instance_exception_id;
    if (!exceptionId) {
      return;
    }
    setSeriesActionId(instance.id);
    try {
      const res = await fetch(`${API_BASE}/recurrence-exceptions/${exceptionId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to restore date');
      }
      fetchEvents();
    } catch (err) {
      console.error('unskipSeriesInstance error', err);
      alert(err.message || 'Failed to restore this date.');
    } finally {
      setSeriesActionId(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Events</h1>
        <div>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">
            <Plus className="h-4 w-4" /> Add Event
          </button>
        </div>
      </div>

      {listError && (
        <div className="mb-6 p-4 rounded-xl border border-red-500/40 bg-red-900/30 text-red-100 text-sm">
          {listError}
        </div>
      )}
      {categoryError && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/40 bg-amber-800/30 text-amber-100 text-sm">
          {categoryError}
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-gray-900 border border-purple-500/20 rounded-xl p-4 mb-6 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="text-xs uppercase text-gray-400 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
                className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
              >
                <option value="published">Published only</option>
                <option value="draft">Draft only</option>
                <option value="all">All statuses</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs uppercase text-gray-400 mb-1">Timeframe</label>
              <select
                value={filters.timeframe}
                onChange={(e) => setFilters((prev) => ({ ...prev, timeframe: e.target.value }))}
                className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
              >
                <option value="upcoming">Upcoming only</option>
                <option value="past">Past events</option>
                <option value="all">All dates</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs uppercase text-gray-400 mb-1">Venue</label>
              <select
                value={filters.venue}
                onChange={(e) => setFilters((prev) => ({ ...prev, venue: e.target.value }))}
                className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
              >
                <option value="all">All venues</option>
                <option value="MMH">Midway Music Hall</option>
                <option value="TGP">Gathering Place</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs uppercase text-gray-400 mb-1">Category</label>
              <select
                value={filters.category}
                onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
                className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
              >
                <option value="all">All categories</option>
                {categoryFilterOptions.map((cat) => (
                  <option key={cat.slug} value={cat.slug}>
                    {cat.name}{cat.is_active ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-600"
                checked={filters.recurringOnly}
                onChange={(e) => setFilters((prev) => ({ ...prev, recurringOnly: e.target.checked }))}
              />
              Recurring only
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-600"
                checked={filters.seatingOnly}
                onChange={(e) => setFilters((prev) => ({ ...prev, seatingOnly: e.target.checked }))}
              />
              With seating only
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-600"
                checked={filters.needsScheduleOnly}
                onChange={(e) => setFilters((prev) => ({ ...prev, needsScheduleOnly: e.target.checked }))}
              />
              Needs date/time only
            </label>
            <div className="flex flex-col">
              <label className="text-xs uppercase text-gray-400 mb-1">Sort</label>
              <select
                value={filters.sortBy}
                onChange={(e) => setFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
                className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs uppercase text-gray-400 mb-1">Grouping</label>
              <select
                value={filters.groupBy}
                onChange={(e) => setFilters((prev) => ({ ...prev, groupBy: e.target.value }))}
                className="px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
              >
                {GROUP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="sr-only" htmlFor="event-search">Search events</label>
            <input
              id="event-search"
              type="search"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Search artist, title, notes, venue..."
              className="w-full px-3 py-2 bg-gray-800 text-white rounded border border-gray-700 text-sm"
            />
          </div>
          <p className="text-xs text-gray-500">
            Upcoming shows load by default. Switch timeframe to “Past” for recent history or “Archived” to manage cleanups.
          </p>
        </div>
      )}

      {filters.timeframe === 'archived' && (
        <div className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-sm text-amber-100">
          Archived events are snapshots for record keeping. Restore to edit or duplicate for new bookings.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : sortedItems.length === 0 ? (
        <div className="p-6 bg-gray-800 rounded-xl border border-gray-700 text-center text-gray-400">
          {events.length === 0
            ? 'No events yet. Click "Add Event" to create your first listing.'
            : 'No events match the selected filters.'}
        </div>
      ) : (
        <>
          {sectionIds.length > 0 && (
            <div className="flex justify-end gap-2 mb-4">
              <button
                type="button"
                onClick={() => setAllSectionsState(sectionIds, false)}
                className="px-3 py-2 text-sm rounded bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-700"
              >
                Expand All
              </button>
              <button
                type="button"
                onClick={() => setAllSectionsState(sectionIds, true)}
                className="px-3 py-2 text-sm rounded bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-700"
              >
                Collapse All
              </button>
            </div>
          )}
          <div className="space-y-10">
            {groupedSections.map((group) => {
              const viewingArchivedOnly = filters.timeframe === 'archived';
              const includeArchivedInline = filters.timeframe === 'all';
              const groupTotal = viewingArchivedOnly
                ? group.archived.length
                : includeArchivedInline
                  ? group.published.length + group.drafts.length + group.archived.length
                  : group.published.length + group.drafts.length;
              return (
                <section key={group.key} className="bg-gray-800 rounded-2xl border border-purple-500/20 p-6">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <h3 className="text-xl font-bold text-white">{group.label}</h3>
                      <p className="text-sm text-gray-400">Organized by publish state and recurring status.</p>
                    </div>
                    <span className="text-sm text-gray-400">
                      {groupTotal} total
                    </span>
                  </div>
                  {viewingArchivedOnly ? (
                    renderEventSection('Archived / Historical', group.archived, `${group.key}-archived`)
                  ) : (
                    <>
                      {renderEventSection('Published Schedule', group.published, `${group.key}-published`)}
                      {renderEventSection('Draft & Private', group.drafts, `${group.key}-drafts`)}
                      {includeArchivedInline && group.archived.length > 0 && renderEventSection('Archived / Historical', group.archived, `${group.key}-archived`)}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-50 overflow-auto">
          <div className="bg-gray-800 rounded-xl max-w-3xl w-full p-6 border border-purple-500/30">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">{editing ? 'Edit Event' : 'Add Event'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">Close</button>
            </div>

            {error && (
              <div
                className="mb-4 p-3 bg-red-600/10 border border-red-600 text-red-400 rounded"
                role="alert"
                aria-live="assertive"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Artist Name*</label>
                <input name="artist_name" value={formData.artist_name} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Genre</label>
                <input name="genre" value={formData.genre} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Category</label>
                <select
                  name="category_id"
                  value={formData.category_id}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                >
                  <option value="">Normal</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}{cat.is_active ? '' : ' (inactive)'}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Inactive categories remain selectable if already assigned to this event.</p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Event Date*</label>
                <input type="date" name="event_date" value={formData.event_date} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Event Time*</label>
                <input type="time" name="event_time" value={formData.event_time} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Doors Open Time*</label>
                <input
                  type="time"
                  name="door_time"
                  value={formData.door_time}
                  onChange={handleChange}
                  required
                  aria-describedby="door-time-help"
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                />
                <p id="door-time-help" className="text-xs text-gray-400 mt-1">
                  This feeds the “Doors Open” line on the public schedule.
                </p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Ticket Price</label>
                <input
                  name="ticket_price"
                  value={formData.ticket_price}
                  onChange={handleChange}
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Leave blank for free shows"
                />
                <p className="text-xs text-gray-400 mt-1">Leave blank if this event is free or donation-based.</p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Door Price</label>
                <input
                  name="door_price"
                  value={formData.door_price}
                  onChange={handleChange}
                  type="number"
                  step="0.01"
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Leave blank if no door cover"
                />
                <p className="text-xs text-gray-400 mt-1">If there is no separate door price, leave blank.</p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Age Restriction</label>
                <select name="age_restriction" value={formData.age_restriction} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded">
                  <option>All Ages</option>
                  <option>18+</option>
                  <option>21+</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Venue Section</label>
                <input name="venue_section" value={formData.venue_section} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Venue*</label>
                <select
                  name="venue_code"
                  value={formData.venue_code}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                >
                  <option value="MMH">Midway Music Hall</option>
                  <option value="TGP">The Gathering Place</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">Controls which public schedule and filtering bucket this show appears in.</p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Seating Layout</label>
                <select name="layout_id" value={formData.layout_id} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded">
                  <option value="">None (No seat reservations)</option>
                  {layouts.map(layout => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name} {layout.is_default === 1 ? '(Default)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Select a saved layout or leave as None if this event doesn't use seat reservations</p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Seat request email (optional)</label>
                <input
                  type="email"
                  name="seat_request_email_override"
                  value={formData.seat_request_email_override}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Leave blank for default routing"
                />
                <p className="text-xs text-gray-400 mt-1">
                  {editingSeatRouting
                    ? `Currently routed to ${editingSeatRouting.email} (${editingSeatRouting.label}).`
                    : 'Leave blank to use the Beach Bands inbox for beach shows or the main staff inbox for everything else.'}
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-2">Event Image</label>
                <div className="space-y-3">
                  {/* Image Preview */}
                  {(imagePreview || formData.image_url) && (
                    <div className="relative inline-block">
                      <ResponsiveImage 
                        src={imagePreview || getImageUrlSync(formData.image_url)} 
                        alt="Event preview"
                        width={256}
                        height={256}
                        className="w-32 h-32 object-cover rounded-lg border-2 border-gray-600"
                      />
                      <button
                        type="button"
                        onClick={clearImage}
                        className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  
                  {/* File Input */}
                  <div>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={handleImageChange}
                      className="block w-full text-sm text-gray-300
                        file:mr-4 file:py-2 file:px-4
                        file:rounded file:border-0
                        file:text-sm file:font-medium
                        file:bg-purple-600 file:text-white
                        hover:file:bg-purple-700
                        file:cursor-pointer cursor-pointer"
                    />
                    <p className="text-xs text-gray-400 mt-1">Upload a custom image or leave empty to use the default logo</p>
                  </div>
                  
                  {/* URL Input (fallback) */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Or enter image URL:</label>
                    <input 
                      name="image_url" 
                      value={formData.image_url} 
                      onChange={handleChange} 
                      className="w-full px-3 py-2 bg-gray-700 text-white rounded text-sm" 
                      placeholder="https://example.com/image.jpg"
                    />
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange} rows="4" className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">{submitting ? 'Saving...' : 'Save Event'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
 
