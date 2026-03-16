import { getTieredPriceSummary } from './eventPricing';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

const formatPriceValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return `$${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)}`;
};

const DEFAULT_EVENT_TIME = '18:00:00';

const extractTimeToken = (value = '') => {
  if (!value) return null;
  const token = value.split(/-|–|to/i)[0]?.trim();
  return token || null;
};

const to24HourTime = (token) => {
  const match = token.match(/(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  let minute = match[2] ? parseInt(match[2], 10) : 0;
  let second = match[3] ? parseInt(match[3], 10) : 0;
  const suffix = match[4] ? match[4].toLowerCase() : null;
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (!suffix && hour === 24) hour = 0;
  return [
    String(hour).padStart(2, '0'),
    String(minute).padStart(2, '0'),
    String(second).padStart(2, '0'),
  ].join(':');
};

const buildDateFromParts = (dateStr, timeToken) => {
  if (!dateStr) return null;
  const normalizedTime = timeToken ? (to24HourTime(timeToken) || DEFAULT_EVENT_TIME) : DEFAULT_EVENT_TIME;
  const iso = `${dateStr}T${normalizedTime}`;
  const dt = new Date(iso);
  if (!Number.isNaN(dt.getTime())) return dt;
  const fallback = new Date(`${dateStr}T${DEFAULT_EVENT_TIME}`);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const normalizeEventOccurrences = (event = {}) => {
  const occurrences = Array.isArray(event?.occurrences) ? [...event.occurrences] : [];
  return occurrences.sort((left, right) => {
    const leftStart = left?.start_datetime || `${left?.occurrence_date || left?.event_date || ''}T${left?.start_time || left?.event_time || DEFAULT_EVENT_TIME}`;
    const rightStart = right?.start_datetime || `${right?.occurrence_date || right?.event_date || ''}T${right?.start_time || right?.event_time || DEFAULT_EVENT_TIME}`;
    return String(leftStart).localeCompare(String(rightStart));
  });
};

export const getEventStartDate = (event = {}) => {
  if (!event) return null;
  if (event.start_datetime) {
    const normalized = event.start_datetime.includes('T')
      ? event.start_datetime
      : event.start_datetime.replace(' ', 'T');
    const dt = new Date(normalized);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  if (!event.event_date) return null;
  const token = extractTimeToken(event.event_time || '');
  return buildDateFromParts(event.event_date, token);
};

export const getEventDoorDate = (event = {}) => {
  if (event.door_time) {
    const normalized = event.door_time.includes('T')
      ? event.door_time
      : event.door_time.replace(' ', 'T');
    const dt = new Date(normalized);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  if (event.event_date && event.door_time) {
    const token = extractTimeToken(event.door_time);
    return buildDateFromParts(event.event_date, token);
  }
  return null;
};

export const getEventEndDate = (event = {}, fallbackHours = 4) => {
  if (event.end_datetime) {
    const normalized = event.end_datetime.includes('T')
      ? event.end_datetime
      : event.end_datetime.replace(' ', 'T');
    const dt = new Date(normalized);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const start = getEventStartDate(event);
  if (!start) return null;
  const hours = Math.max(1, fallbackHours);
  return new Date(start.getTime() + hours * 60 * 60 * 1000);
};

export const getEventOccurrences = (event = {}) => normalizeEventOccurrences(event);

export const isMultiDayEvent = (event = {}) => (
  Number(event?.is_multi_day) === 1
  || Number(event?.occurrence_count) > 1
  || normalizeEventOccurrences(event).length > 1
);

export const getEventAnchorKey = (event = {}) => {
  const raw = event?.occurrence_key || event?.id || event?.slug || '';
  return String(raw).trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
};

export const getEventAnchorId = (event = {}) => {
  const key = getEventAnchorKey(event);
  return key ? `event-${key}` : '';
};

export const formatEventOccurrenceLabel = (occurrence = {}, fallbackEvent = {}) => {
  const start = getEventStartDate({
    ...fallbackEvent,
    ...occurrence,
    start_datetime: occurrence?.start_datetime || fallbackEvent?.start_datetime,
    event_date: occurrence?.event_date || occurrence?.occurrence_date || fallbackEvent?.event_date,
    event_time: occurrence?.event_time || occurrence?.start_time || fallbackEvent?.event_time,
  });
  if (!start) return 'Date & time TBA';
  return `${dateFormatter.format(start)} • ${timeFormatter.format(start)}`;
};

export const formatEventRunSummary = (event = {}, limit = 3) => {
  const occurrences = normalizeEventOccurrences(event);
  if (occurrences.length <= 1) return null;
  const labels = occurrences
    .slice(0, limit)
    .map((occurrence) => formatEventOccurrenceLabel(occurrence, event))
    .filter(Boolean);
  if (!labels.length) return null;
  const suffix = occurrences.length > labels.length ? ` +${occurrences.length - labels.length} more` : '';
  return `${labels.join(' | ')}${suffix}`;
};

export const formatAdditionalOccurrencesSummary = (event = {}, limit = 2) => {
  const occurrences = normalizeEventOccurrences(event);
  if (occurrences.length <= 1) return null;
  const filtered = occurrences.filter((occurrence) => {
    if (event?.occurrence_id && occurrence?.id) {
      return Number(occurrence.id) !== Number(event.occurrence_id);
    }
    if (event?.start_datetime && occurrence?.start_datetime) {
      return occurrence.start_datetime !== event.start_datetime;
    }
    return true;
  });
  if (!filtered.length) return null;
  const labels = filtered
    .slice(0, limit)
    .map((occurrence) => formatEventOccurrenceLabel(occurrence, event))
    .filter(Boolean);
  if (!labels.length) return null;
  const suffix = filtered.length > labels.length ? ` +${filtered.length - labels.length} more` : '';
  return `${labels.join(' | ')}${suffix}`;
};

export const formatEventDateTimeLabel = (event = {}) => {
  const start = getEventStartDate(event);
  if (!start) return 'Date & time TBA';
  return `${dateFormatter.format(start)} • ${timeFormatter.format(start)}`;
};

export const formatDoorsLabel = (event = {}) => {
  const door = getEventDoorDate(event);
  if (!door) return null;
  return timeFormatter.format(door);
};

export const formatEventStartTime = (event = {}) => {
  const start = getEventStartDate(event);
  if (!start) return null;
  return timeFormatter.format(start);
};

export const formatEventPriceDisplay = (event = {}) => {
  const tieredSummary = getTieredPriceSummary(event);
  if (tieredSummary) {
    return tieredSummary;
  }
  const hasValue = (value) => value !== null && value !== undefined && value !== '';
  const formatTicket = hasValue(event.ticket_price) ? formatPriceValue(event.ticket_price) : null;
  const formatDoor = hasValue(event.door_price) ? formatPriceValue(event.door_price) : null;

  if (formatTicket || formatDoor) {
    const normalizeNumber = (value) => {
      if (!hasValue(value)) return null;
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    };
    const ticketNum = normalizeNumber(event.ticket_price);
    const doorNum = normalizeNumber(event.door_price);
    const pricesMatch = (
      ticketNum !== null &&
      doorNum !== null &&
      ticketNum === doorNum
    ) || (formatTicket && formatDoor && formatTicket === formatDoor);

    if (pricesMatch) {
      return formatTicket || formatDoor;
    }

    const segments = [];
    if (formatTicket) segments.push(`Advance ${formatTicket}`);
    if (formatDoor) segments.push(`Door ${formatDoor}`);
    return segments.join(' • ') || null;
  }

  const min = formatPriceValue(event.min_ticket_price);
  const max = formatPriceValue(event.max_ticket_price);
  if (min && max && min !== max) {
    return `${min} – ${max}`;
  }
  return (
    formatPriceValue(event.ticket_price) ||
    formatPriceValue(event.door_price) ||
    null
  );
};

export const eventHasSeating = (event = {}) => {
  if (!event) return false;
  const layoutVersion = event.layout_version_id || event.seating_layout_version_id;
  const layoutId = event.layout_id || event.seating_layout_id;
  if (layoutVersion || layoutId) {
    return true;
  }
  if (event.seating_layout && (event.seating_layout.id || event.seating_layout.version_id)) {
    return true;
  }
  return false;
};

export const isRecurringEvent = (event = {}) => {
  if (!event) return false;
  if (Number(event.is_series_master) === 1 || Number(event.series_master_id) > 0) {
    return true;
  }
  if (event.recurrence_rule_id || event.parent_recurrence_rule_id) {
    return true;
  }
  const slug = (event.category_slug || '').toLowerCase();
  return slug === 'recurring';
};
