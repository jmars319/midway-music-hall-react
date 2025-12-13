// EventsModule: admin UI to create and manage events
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit, Copy, CheckCircle, XCircle, Archive as ArchiveIcon } from 'lucide-react';
import { API_BASE, getImageUrlSync } from '../App';
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

const SESSION_TIMEZONE = 'America/New_York';

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

const isRecurringEvent = (event) => Boolean(event.is_series_master || event.series_master_id);

const normalizeVenueKey = (venueCode) => {
  const key = (venueCode || 'MMH').toUpperCase();
  return VENUE_LABELS[key] ? key : 'MMH';
};

const initialForm = {
  artist_name: '',
  event_date: '',
  event_time: '',
  genre: '',
  description: '',
  image_url: '',
  ticket_price: '',
  door_price: '',
  age_restriction: 'All Ages',
  venue_section: '',
  layout_id: '',
};

export default function EventsModule(){
  const [events, setEvents] = useState([]);
  const [layouts, setLayouts] = useState([]);
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
    search: '',
  });

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/events`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.events)) {
        setEvents(data.events);
      } else {
        setEvents([]);
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

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

  useEffect(() => { 
    fetchEvents();
    fetchLayouts();
  }, []);

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

  const layoutNameForEvent = (event) => {
    if (!event.layout_id) return 'Not assigned';
    const found = layouts.find((layout) => String(layout.id) === String(event.layout_id));
    return found?.name || `Layout #${event.layout_id}`;
  };

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

  const filteredEvents = useMemo(() => {
    if (!events.length) return [];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const searchValue = filters.search.trim().toLowerCase();
    return events.filter((event) => {
      if (filters.status !== 'all' && (event.status || 'draft') !== filters.status) {
        return false;
      }
      if (filters.seatingOnly && !event.seating_enabled) {
        return false;
      }
      if (filters.recurringOnly && !isRecurringEvent(event)) {
        return false;
      }
      const eventDate = parseEventDate(event);
      if (filters.timeframe === 'upcoming' && eventDate && eventDate < startOfToday) {
        return false;
      }
      if (filters.timeframe === 'past' && eventDate && eventDate >= startOfToday) {
        return false;
      }
      if (searchValue) {
        const haystack = [
          event.artist_name,
          event.title,
          event.genre,
          event.notes,
          event.description,
          event.venue_section,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchValue)) {
          return false;
        }
      }
      return true;
    });
  }, [events, filters]);

  const venueGroups = useMemo(() => {
    if (!filteredEvents.length) return [];
    const sorted = [...filteredEvents].sort((a, b) => {
      const aDate = parseEventDate(a);
      const bDate = parseEventDate(b);
      const aValue = aDate ? aDate.getTime() : 0;
      const bValue = bDate ? bDate.getTime() : 0;
      return aValue - bValue;
    });
    const grouped = sorted.reduce((acc, event) => {
      const venueKey = normalizeVenueKey(event.venue_code);
      if (!acc[venueKey]) {
        acc[venueKey] = {
          key: venueKey,
          label: VENUE_LABELS[venueKey] || 'Events',
          published: [],
          drafts: []
        };
      }
      const bucket = event.status === 'published' ? 'published' : 'drafts';
      acc[venueKey][bucket].push(event);
      return acc;
    }, {});
    return Object.values(grouped);
  }, [filteredEvents]);

  const sectionIds = useMemo(() => {
    return venueGroups.flatMap((group) => [
      `${group.key}-published`,
      `${group.key}-drafts`,
    ]);
  }, [venueGroups]);

  const renderEventCard = (event) => {
    const eventTitle = event.artist_name || event.title || 'Untitled Event';
    const subtitle = event.title && event.title !== eventTitle ? event.title : event.notes;
    const ticketTypeLabel = TICKET_TYPE_LABELS[event.ticket_type] || 'General Admission';
    const priceCopy = formatPriceDisplay(event);
    const statusClasses = event.status === 'published'
      ? 'bg-green-500/15 text-green-200 border border-green-500/30'
      : 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30';
    const visibilityBadge = event.visibility === 'private'
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-gray-500/20 text-gray-200 border border-gray-500/30">Private</span>
      : null;
    const recurrenceBadge = isRecurringEvent(event)
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">Recurring Series</span>
      : null;
    const seatingBadge = event.seating_enabled
      ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/30">Seating Enabled</span>
      : null;
    const imageSrc = getImageUrlSync(event.image_url || '');

    return (
      <div key={event.id} className="bg-gray-900 rounded-xl border border-gray-700 p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row">
          <div className="w-full md:w-32 flex-shrink-0">
            <div className="w-full aspect-square bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
              <img src={imageSrc} alt={eventTitle} className="w-full h-full object-cover" />
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClasses}`}>
                {event.status === 'published' ? 'Published' : 'Draft'}
              </span>
              {visibilityBadge}
              {recurrenceBadge}
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-500/15 text-blue-200 border border-blue-500/30">
                {ticketTypeLabel}
              </span>
              {seatingBadge}
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
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => duplicateEvent(event)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
          >
            <Copy className="h-4 w-4" /> Duplicate
          </button>
          {event.status === 'published' ? (
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
        </div>
      </div>
    );
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
              {list.map(renderEventCard)}
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
      genre: event.genre || '',
      description: event.description || '',
      image_url: event.image_url || '',
      ticket_price: event.ticket_price || '',
      door_price: event.door_price || '',
      age_restriction: event.age_restriction || 'All Ages',
      venue_section: event.venue_section || '',
      layout_id: event.layout_id || '',
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
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, image_url: finalImageUrl }),
      });
      const data = await res.json();
      if (data && data.success) {
        setShowForm(false);
        fetchEvents();
      } else {
        setError('Failed to save event');
      }
    } catch (err) {
      console.error('Save event error', err);
      setError('Failed to save event');
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
      const res = await fetch(`${API_BASE}/events/${event.id}`, { method: 'DELETE' });
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
    const payload = {
      artist_name: `${baseName} (Copy)`,
      title: event.title || '',
      description: event.description || '',
      notes: event.notes || '',
      genre: event.genre || '',
      event_date: eventDate,
      event_time: eventTime,
      door_time: event.door_time || '',
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
      hero_image_id: event.hero_image_id || null,
      poster_image_id: event.poster_image_id || null,
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
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
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
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : filteredEvents.length === 0 ? (
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
            {venueGroups.map((group) => (
              <section key={group.key} className="bg-gray-800 rounded-2xl border border-purple-500/20 p-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-white">{group.label}</h3>
                    <p className="text-sm text-gray-400">Organized by publish state and recurring status.</p>
                  </div>
                  <span className="text-sm text-gray-400">
                    {group.published.length + group.drafts.length} total
                  </span>
                </div>
                {renderEventSection('Published Schedule', group.published, `${group.key}-published`)}
                {renderEventSection('Draft & Private', group.drafts, `${group.key}-drafts`)}
              </section>
            ))}
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

            {error && <div className="mb-4 p-3 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>}

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
                <label className="block text-sm text-gray-300 mb-1">Event Date*</label>
                <input type="date" name="event_date" value={formData.event_date} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Event Time*</label>
                <input type="time" name="event_time" value={formData.event_time} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Ticket Price*</label>
                <input name="ticket_price" value={formData.ticket_price} onChange={handleChange} type="number" step="0.01" required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Door Price*</label>
                <input name="door_price" value={formData.door_price} onChange={handleChange} type="number" step="0.01" required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
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
                <label className="block text-sm text-gray-300 mb-2">Event Image</label>
                <div className="space-y-3">
                  {/* Image Preview */}
                  {(imagePreview || formData.image_url) && (
                    <div className="relative inline-block">
                      <img 
                        src={imagePreview || getImageUrlSync(formData.image_url)} 
                        alt="Event preview"
                        className="w-32 h-32 object-cover rounded-lg border-2 border-gray-600"
                        onError={(e) => { e.target.src = '/android-chrome-192x192.png'; }}
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
 
