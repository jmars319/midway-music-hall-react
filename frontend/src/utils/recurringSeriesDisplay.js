import { getEventStartDate } from './eventFormat';

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const SHORT_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

const WEEKDAY_OPTIONS = [
  { value: 'SU', label: 'Sunday', pluralLabel: 'Sundays' },
  { value: 'MO', label: 'Monday', pluralLabel: 'Mondays' },
  { value: 'TU', label: 'Tuesday', pluralLabel: 'Tuesdays' },
  { value: 'WE', label: 'Wednesday', pluralLabel: 'Wednesdays' },
  { value: 'TH', label: 'Thursday', pluralLabel: 'Thursdays' },
  { value: 'FR', label: 'Friday', pluralLabel: 'Fridays' },
  { value: 'SA', label: 'Saturday', pluralLabel: 'Saturdays' },
];

const WEEKDAY_LABELS = Object.fromEntries(
  WEEKDAY_OPTIONS.map((option) => [option.value, option.label]),
);

const WEEKDAY_PLURAL_LABELS = Object.fromEntries(
  WEEKDAY_OPTIONS.map((option) => [option.value, option.pluralLabel]),
);

const MONTHLY_ORDINAL_OPTIONS = [
  { value: '1', label: 'First' },
  { value: '2', label: 'Second' },
  { value: '3', label: 'Third' },
  { value: '4', label: 'Fourth' },
  { value: '5', label: 'Fifth' },
  { value: '-1', label: 'Last' },
];

const MONTHLY_ORDINAL_LABELS = Object.fromEntries(
  MONTHLY_ORDINAL_OPTIONS.map((option) => [option.value, option.label]),
);

const parseRulePayload = (value) => {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeDelimitedTokens = (value) => {
  if (!value) return [];
  const queue = Array.isArray(value) ? [...value] : [value];
  const tokens = [];
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate === null || candidate === undefined || candidate === false) continue;
    if (Array.isArray(candidate)) {
      queue.push(...candidate);
      continue;
    }
    const raw = String(candidate).trim();
    if (!raw) continue;
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          queue.push(...parsed);
          continue;
        }
      } catch {
        // Ignore invalid JSON-like strings and fall through to token splitting.
      }
    }
    if (/[,\s]/.test(raw)) {
      raw.split(/[\s,]+/).filter(Boolean).forEach((part) => queue.push(part));
      continue;
    }
    tokens.push(raw);
  }
  return tokens;
};

const normalizeWeekdayTokens = (value) => {
  const seen = new Set();
  normalizeDelimitedTokens(value).forEach((token) => {
    const normalized = String(token || '').trim().toUpperCase();
    if (WEEKDAY_LABELS[normalized]) {
      seen.add(normalized);
    }
  });
  return WEEKDAY_OPTIONS.map((option) => option.value).filter((token) => seen.has(token));
};

const normalizeSetposTokens = (value) => {
  const seen = new Set();
  const aliasMap = {
    first: '1',
    '1st': '1',
    second: '2',
    '2nd': '2',
    third: '3',
    '3rd': '3',
    fourth: '4',
    '4th': '4',
    fifth: '5',
    '5th': '5',
    last: '-1',
  };
  normalizeDelimitedTokens(value).forEach((token) => {
    const normalized = aliasMap[String(token || '').trim().toLowerCase()] || String(token || '').trim();
    if (MONTHLY_ORDINAL_LABELS[normalized]) {
      seen.add(normalized);
    }
  });
  return MONTHLY_ORDINAL_OPTIONS.map((option) => option.value).filter((token) => seen.has(token));
};

const normalizeMonthdayTokens = (value) => {
  const seen = new Set();
  normalizeDelimitedTokens(value).forEach((token) => {
    const parsed = Number.parseInt(String(token || '').trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 31) {
      seen.add(parsed);
    }
  });
  return Array.from(seen).sort((left, right) => left - right);
};

const joinLabels = (labels = []) => {
  const filtered = labels.filter(Boolean);
  if (!filtered.length) return '';
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(', ')}, and ${filtered[filtered.length - 1]}`;
};

const formatMonthday = (value) => {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return '';
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${day}th`;
  }
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
};

const getOccurrenceDate = (value = {}) => getEventStartDate({
  start_datetime: value?.start_datetime || '',
  event_date: value?.event_date || value?.occurrence_date || '',
  event_time: value?.event_time || value?.start_time || '',
});

const getReferenceTimeLabel = (master = {}, upcomingOccurrences = []) => {
  const reference = upcomingOccurrences.find(Boolean) || master;
  const date = getOccurrenceDate(reference);
  return date ? SHORT_TIME_FORMATTER.format(date) : '';
};

const buildWeeklyScheduleLabel = (weekdayTokens = [], timeLabel = '') => {
  if (!weekdayTokens.length) {
    return timeLabel ? `Recurring · ${timeLabel}` : 'Recurring schedule';
  }
  const dayLabels = weekdayTokens.map((token) => WEEKDAY_PLURAL_LABELS[token]).filter(Boolean);
  const daySummary = joinLabels(dayLabels);
  return timeLabel ? `${daySummary} · ${timeLabel}` : daySummary;
};

const buildMonthlyScheduleLabel = (weekdayTokens = [], setposTokens = [], monthdayTokens = [], timeLabel = '') => {
  let base = 'Monthly';
  if (monthdayTokens.length > 0) {
    const labels = monthdayTokens.map((token) => formatMonthday(token)).filter(Boolean);
    if (labels.length > 0) {
      base = labels.length === 1
        ? `Monthly on the ${labels[0]}`
        : `Monthly on the ${joinLabels(labels)}`;
    }
  } else if (weekdayTokens.length > 0) {
    const weekdayLabel = WEEKDAY_LABELS[weekdayTokens[0]] || 'Weekday';
    const ordinalLabels = setposTokens
      .map((token) => MONTHLY_ORDINAL_LABELS[token])
      .filter(Boolean);
    if (ordinalLabels.length > 0) {
      base = `${joinLabels(ordinalLabels)} ${weekdayLabel} each month`;
    } else {
      base = `Monthly on ${weekdayLabel}`;
    }
  }
  return timeLabel ? `${base} · ${timeLabel}` : base;
};

export const deriveRecurringSeriesSummary = (master = {}) => {
  const customSummary = typeof master.series_summary === 'string' ? master.series_summary.trim() : '';
  if (customSummary) return customSummary;
  if (typeof master.description === 'string' && master.description.trim()) return master.description.trim();
  if (typeof master.notes === 'string' && master.notes.trim()) return master.notes.trim();
  return 'Recurring community series.';
};

export const deriveRecurringSeriesFooterNote = (master = {}) => {
  const value = typeof master.series_footer_note === 'string' ? master.series_footer_note.trim() : '';
  return value || null;
};

export const resolveRecurringSeriesDisplayOccurrences = (master = {}, fallbackOccurrences = []) => {
  const configured = Array.isArray(master?.public_recurrence_occurrences)
    ? master.public_recurrence_occurrences.filter(Boolean)
    : [];
  if (configured.length > 0) {
    return configured;
  }
  return Array.isArray(fallbackOccurrences) ? fallbackOccurrences : [];
};

export const deriveRecurringSeriesScheduleLabel = (master = {}, upcomingOccurrences = []) => {
  const customLabel = typeof master.series_schedule_label === 'string' ? master.series_schedule_label.trim() : '';
  if (customLabel) return customLabel;

  const payload = parseRulePayload(master.recurrence_rule_payload);
  const frequency = String(
    master.recurrence_frequency
      || payload.frequency
      || '',
  ).trim().toLowerCase();
  const weekdayTokens = normalizeWeekdayTokens(master.recurrence_byweekday || payload.byweekday || '');
  const setposTokens = normalizeSetposTokens(master.recurrence_bysetpos || payload.setpos || '');
  const monthdayTokens = normalizeMonthdayTokens(master.recurrence_bymonthday || payload.bymonthday || '');
  const timeLabel = getReferenceTimeLabel(master, upcomingOccurrences);

  if (frequency === 'weekly') {
    return buildWeeklyScheduleLabel(weekdayTokens, timeLabel);
  }

  if (frequency === 'monthly') {
    return buildMonthlyScheduleLabel(weekdayTokens, setposTokens, monthdayTokens, timeLabel);
  }

  return timeLabel ? `Recurring · ${timeLabel}` : 'Recurring schedule';
};

export const formatRecurringOccurrenceDateLabel = (occurrence = {}) => {
  const date = getOccurrenceDate(occurrence);
  return date ? SHORT_DATE_FORMATTER.format(date) : '';
};

export const formatRecurringOccurrenceTimeLabel = (occurrence = {}) => {
  const date = getOccurrenceDate(occurrence);
  return date ? SHORT_TIME_FORMATTER.format(date) : '';
};
