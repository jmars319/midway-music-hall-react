const padTwo = (value) => String(value).padStart(2, '0');

const expandFriendlyYear = (value) => {
  const raw = String(value || '').trim();
  if (!/^\d{2}(\d{2})?$/.test(raw)) return null;
  if (raw.length === 4) {
    return Number(raw);
  }
  return 2000 + Number(raw);
};

const parseIsoDateToken = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const test = new Date(Date.UTC(year, month - 1, day));
  if (
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() !== month - 1 ||
    test.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

const toFriendlyTime = (hour24, minute) => {
  const normalizedHour = Number(hour24);
  const normalizedMinute = Number(minute);
  const suffix = normalizedHour >= 12 ? 'PM' : 'AM';
  const hour12 = normalizedHour % 12 || 12;
  return `${hour12}:${padTwo(normalizedMinute)} ${suffix}`;
};

const extractClockToken = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let timePart = raw;
  if (raw.includes('T')) {
    [, timePart] = raw.split('T', 2);
  } else if (/^\d{4}-\d{2}-\d{2}\s+/.test(raw)) {
    [, timePart] = raw.split(/\s+/, 2);
  }
  return timePart
    .replace(/\.\d+/, '')
    .replace(/([zZ]|[+-]\d{2}:?\d{2})$/, '')
    .trim();
};

const parseCanonicalTimeToken = (value) => {
  const token = extractClockToken(value);
  if (!token) return null;
  const match = token.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const toCanonicalDate = (year, month, day) => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const test = new Date(Date.UTC(year, month - 1, day));
  if (
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() !== month - 1 ||
    test.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${padTwo(month)}-${padTwo(day)}`;
};

export const parseFriendlyEventDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Accept canonical ISO date as a valid input shortcut.
  const parsedIso = parseIsoDateToken(raw);
  if (parsedIso) {
    return `${parsedIso.year}-${padTwo(parsedIso.month)}-${padTwo(parsedIso.day)}`;
  }

  const slashMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (slashMatch) {
    const year = expandFriendlyYear(slashMatch[3]);
    if (year !== null) {
      return toCanonicalDate(year, Number(slashMatch[1]), Number(slashMatch[2]));
    }
  }

  const digits = raw.replace(/\D+/g, '');
  if (!digits) return null;

  const candidateSplits = [];
  if (digits.length === 8) {
    candidateSplits.push([2, 2, 4]); // MMDDYYYY
  } else if (digits.length === 7) {
    candidateSplits.push([1, 2, 4], [2, 1, 4]); // MDDYYYY or MMDYYYY
  } else if (digits.length === 6) {
    candidateSplits.push([2, 2, 2], [1, 1, 4]); // MMDDYY or MDYYYY
  } else if (digits.length === 5) {
    candidateSplits.push([1, 2, 2], [2, 1, 2]); // MDDYY or MMDYY
  } else if (digits.length === 4) {
    candidateSplits.push([1, 1, 2]); // MDYY
  }

  for (const [monthLen, dayLen, yearLen] of candidateSplits) {
    const monthToken = digits.slice(0, monthLen);
    const dayToken = digits.slice(monthLen, monthLen + dayLen);
    const yearToken = digits.slice(monthLen + dayLen, monthLen + dayLen + yearLen);
    if (yearToken.length !== yearLen) continue;
    const year = expandFriendlyYear(yearToken);
    if (year === null) continue;
    const normalized = toCanonicalDate(year, Number(monthToken), Number(dayToken));
    if (normalized) return normalized;
  }

  return null;
};

export const formatEventDateForInput = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const isoToken = raw.includes('T')
    ? raw.split('T', 1)[0]
    : raw.includes(' ')
      ? raw.split(' ', 1)[0]
      : raw;

  const parsedIso = parseIsoDateToken(isoToken);
  if (parsedIso) {
    return `${padTwo(parsedIso.month)}/${padTwo(parsedIso.day)}/${parsedIso.year}`;
  }

  const parsedFriendly = parseFriendlyEventDate(raw);
  if (!parsedFriendly) return '';
  const parsedCanonical = parseIsoDateToken(parsedFriendly);
  if (!parsedCanonical) return '';
  return `${padTwo(parsedCanonical.month)}/${padTwo(parsedCanonical.day)}/${parsedCanonical.year}`;
};

export const parseFriendlyEventTime = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // 24-hour canonical input like 19:30 or 19:30:00
  const canonical = parseCanonicalTimeToken(raw);
  if (canonical) {
    return `${padTwo(canonical.hour)}:${padTwo(canonical.minute)}:00`;
  }

  // 12-hour shorthand, supports 7:30pm, 730pm, 0730 PM, 7pm, 7p, 7.30 pm
  const twelveHourToken = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
  const twelveHourMatch = twelveHourToken.match(/^(\d{1,2})(?::?(\d{2}))?([ap])m?$/);
  if (twelveHourMatch) {
    let hour = Number(twelveHourMatch[1]);
    const minute = Number(twelveHourMatch[2] ?? '0');
    const suffix = twelveHourMatch[3].toUpperCase() === 'A' ? 'AM' : 'PM';
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (suffix === 'AM' && hour === 12) {
      hour = 0;
    } else if (suffix === 'PM' && hour < 12) {
      hour += 12;
    }
    return `${padTwo(hour)}:${padTwo(minute)}:00`;
  }

  // 24-hour compact input like 1930, 730, 19
  const compact = raw.replace(/\s+/g, '');
  if (/^\d{3,4}$/.test(compact)) {
    const hour = Number(compact.length === 3 ? compact.slice(0, 1) : compact.slice(0, 2));
    const minute = Number(compact.slice(-2));
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${padTwo(hour)}:${padTwo(minute)}:00`;
    }
    return null;
  }
  if (/^\d{1,2}$/.test(compact)) {
    const hour = Number(compact);
    if (hour >= 0 && hour <= 23) {
      return `${padTwo(hour)}:00:00`;
    }
  }

  return null;
};

export const formatEventTimeForInput = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const friendlyParsed = parseFriendlyEventTime(raw);
  if (friendlyParsed) {
    const [hour, minute] = friendlyParsed.split(':');
    return toFriendlyTime(Number(hour), Number(minute));
  }

  const canonical = parseCanonicalTimeToken(raw);
  if (!canonical) return '';
  return toFriendlyTime(canonical.hour, canonical.minute);
};
