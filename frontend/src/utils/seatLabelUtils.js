const DEFAULT_SECTION = 'Section';
const DEFAULT_ROW = 'Row';

const isSeatRow = (row = {}) => {
  const type = (row.element_type || row.elementType || 'table').toLowerCase();
  return type === 'table' || type === 'chair';
};

const normalizeSeatLabels = (value) => {
  if (!value) return {};
  let labels = value;
  if (typeof labels === 'string') {
    try {
      labels = JSON.parse(labels);
    } catch (err) {
      labels = {};
    }
  }
  if (!labels || typeof labels !== 'object') {
    return {};
  }
  const normalized = {};
  Object.entries(labels).forEach(([key, val]) => {
    const trimmed = String(val ?? '').trim();
    if (trimmed) {
      normalized[String(key)] = trimmed;
    }
  });
  return normalized;
};

const buildSeatId = (row = {}, seatNumber = 1) => {
  const sectionRaw = row.section_name || row.section || DEFAULT_SECTION;
  const rowLabel = row.row_label || row.row || DEFAULT_ROW;
  const section = String(sectionRaw).trim() || DEFAULT_SECTION;
  const rowPart = String(rowLabel).trim() || DEFAULT_ROW;
  return `${section}-${rowPart}-${seatNumber}`;
};

const getSeatCount = (row = {}) => {
  if (!row) return 0;
  if (typeof row.total_seats === 'number') return row.total_seats;
  if (typeof row.totalSeats === 'number') return row.totalSeats;
  if (typeof row.capacity === 'number') return row.capacity;
  const parsed = Number(row.total_seats || row.totalSeats || row.capacity || 0);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const buildDefaultSeatLabel = (row = {}, seatNumber = 1) => {
  const base = row.row_label || row.row || DEFAULT_ROW;
  const totalSeats = getSeatCount(row);
  if (totalSeats <= 1) {
    return base || DEFAULT_ROW;
  }
  const letterIndex = seatNumber - 1;
  const alphabetSize = 26;
  if (letterIndex < alphabetSize) {
    return `${base || DEFAULT_ROW}${String.fromCharCode(65 + letterIndex)}`;
  }
  const repeatCount = Math.floor(letterIndex / alphabetSize) + 1;
  const remainder = letterIndex % alphabetSize;
  return `${base || DEFAULT_ROW}${String.fromCharCode(65 + remainder).repeat(repeatCount)}`;
};

const buildSeatLabel = (row = {}, seatNumber = 1) => {
  const labels = normalizeSeatLabels(row.seat_labels || row.seatLabels);
  const override = labels[String(seatNumber)] || labels[seatNumber];
  if (override) {
    return override;
  }
  return buildDefaultSeatLabel(row, seatNumber);
};

const resolveRowHeaderLabels = (row = {}) => {
  const sectionLabel = String(row.section_name || row.section || '').trim();
  const totalSeats = getSeatCount(row);
  const baseRowLabel = String(row.row_label || row.row || '').trim();
  let rowLabel = baseRowLabel;
  if (totalSeats <= 1) {
    rowLabel = buildSeatLabel(row, 1);
  } else if (!rowLabel) {
    rowLabel = buildSeatLabel(row, 1);
  }
  return {
    sectionLabel,
    rowLabel,
  };
};

const seatIdsForRow = (row = {}) => {
  const total = Number(row.total_seats) || 0;
  if (total <= 0) return [];
  return Array.from({ length: total }, (_, index) => buildSeatId(row, index + 1));
};

const buildSeatLookupMap = (rows = []) => {
  const map = {};
  rows.filter(isSeatRow).forEach((row) => {
    const total = Number(row.total_seats) || 0;
    for (let seatNumber = 1; seatNumber <= total; seatNumber += 1) {
      const id = buildSeatId(row, seatNumber);
      map[id] = buildSeatLabel(row, seatNumber);
    }
  });
  return map;
};

const seatLetterFromIndex = (index) => {
  const value = Number(index);
  if (!Number.isFinite(value) || value <= 0) return '';
  let n = Math.floor(value);
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

const normalizeTableToken = (token) => {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const digitMatch = raw.match(/\d+/);
  if (digitMatch) return digitMatch[0];
  return raw;
};

const formatSeatLabel = (rawSeatId, options = {}) => {
  const mode = options.mode === 'table' ? 'table' : 'seat';
  const raw = String(rawSeatId || '').trim();
  if (!raw) return '';

  const directSeatMatch = raw.match(/^(\d+)\s*[- ]?\s*([A-Za-z]+)$/);
  if (directSeatMatch) {
    const table = directSeatMatch[1];
    const seat = directSeatMatch[2].toUpperCase();
    return mode === 'table' ? table : `${table}${seat}`;
  }

  const parts = raw.split('-').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return raw;
  }

  const seatPart = parts[parts.length - 1];
  const rowPart = parts[parts.length - 2];
  const table = normalizeTableToken(rowPart) || rowPart;
  if (mode === 'table') {
    return table || raw;
  }

  const seatNumber = Number(seatPart);
  if (Number.isFinite(seatNumber) && seatNumber > 0) {
    const letter = seatLetterFromIndex(seatNumber);
    if (table && letter) {
      return `${table}${letter}`;
    }
  }

  const seatSuffix = String(seatPart || '').trim();
  if (table && seatSuffix) {
    return `${table}${seatSuffix.toUpperCase()}`;
  }
  return raw;
};

const describeSeatSelection = (seatId, label) => {
  const formatted = formatSeatLabel(label || seatId, { mode: 'seat' });
  if (formatted) return formatted;
  return formatSeatLabel(seatId, { mode: 'seat' }) || String(seatId || '').trim();
};

export {
  buildSeatId,
  buildSeatLabel,
  buildSeatLookupMap,
  describeSeatSelection,
  formatSeatLabel,
  isSeatRow,
  normalizeSeatLabels,
  resolveRowHeaderLabels,
  seatIdsForRow,
};
