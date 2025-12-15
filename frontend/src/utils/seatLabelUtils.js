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

const describeSeatSelection = (seatId, label) => {
  if (!label || label === seatId) {
    return seatId;
  }
  return `${label} (${seatId})`;
};

export {
  buildSeatId,
  buildSeatLabel,
  buildSeatLookupMap,
  describeSeatSelection,
  isSeatRow,
  normalizeSeatLabels,
  resolveRowHeaderLabels,
  seatIdsForRow,
};
