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
