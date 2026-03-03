import { buildSeatId, formatSeatLabel, isSeatRow } from './seatLabelUtils.js';

const parseSeats = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
};

const parseSnapshotRows = (snapshot) => {
  if (!snapshot) return [];
  let source = snapshot;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (err) {
      return [];
    }
  }
  if (Array.isArray(source)) return source;
  if (source && typeof source === 'object' && Array.isArray(source.layout_data)) {
    return source.layout_data;
  }
  return [];
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatEventDate = (request = {}) => {
  const dateValue =
    request.start_datetime ||
    (request.event_date
      ? `${request.event_date}${request.event_time ? ` ${request.event_time}` : ''}`
      : '');
  if (!dateValue) return '';
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return String(dateValue);
  return dt.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const buildTableSeatMeta = (request = {}) => {
  const rows = parseSnapshotRows(request.seat_map_snapshot).filter(isSeatRow);
  const map = new Map();
  rows.forEach((row) => {
    const totalSeats = Number(row.total_seats) || 0;
    if (totalSeats <= 0) return;
    const tableLabel = formatSeatLabel(row.row_label || row.row || '', { mode: 'table' });
    if (!tableLabel) return;
    const ids = new Set();
    for (let seatNumber = 1; seatNumber <= totalSeats; seatNumber += 1) {
      ids.add(buildSeatId(row, seatNumber));
    }
    map.set(tableLabel, { totalSeats, seatIds: ids });
  });
  return map;
};

const seatSuffix = (tableLabel, seatLabel) => {
  const table = String(tableLabel || '').trim();
  const seat = String(seatLabel || '').trim();
  if (!table || !seat) return seat;
  if (seat.toUpperCase().startsWith(table.toUpperCase())) {
    const suffix = seat.slice(table.length).trim();
    return suffix.replace(/^-+/, '') || seat;
  }
  return seat;
};

const eventNameForRequest = (request = {}) =>
  request.event_display_name || request.event_artist_name || request.event_title || `Event ${request.event_id || ''}`.trim();

const markerForTableGroup = (request, tableLabel, seats, totalSeats) => {
  const fullTable = totalSeats > 0 && seats.length >= totalSeats;
  const seatLabels = seats.map((seat) => formatSeatLabel(seat, { mode: 'seat' }));
  const suffixes = seatLabels.map((label) => seatSuffix(tableLabel, label));
  return {
    kind: fullTable ? 'table' : 'partial',
    title: fullTable
      ? `Table ${tableLabel} Reserved`
      : `Table ${tableLabel} - Seats ${suffixes.join(', ')}`,
    subtitle: request.customer_name || 'Guest',
    eventName: eventNameForRequest(request),
    eventDate: formatEventDate(request),
  };
};

const markerForSeat = (request, seatId) => {
  const seatLabel = formatSeatLabel(seatId, { mode: 'seat' });
  const tableLabel = formatSeatLabel(seatId, { mode: 'table' });
  return {
    kind: 'seat',
    title: `Seat ${seatLabel}`,
    subtitle: request.customer_name || 'Guest',
    eventName: eventNameForRequest(request),
    eventDate: formatEventDate(request),
    tableLabel,
  };
};

const buildMarkersForRequest = (request = {}, options = {}) => {
  const mode = options.mode === 'seat' ? 'seat' : 'table';
  const seats = parseSeats(request.selected_seats).filter(Boolean);
  if (!seats.length) return [];
  const groups = new Map();
  seats.forEach((seatId) => {
    const table = formatSeatLabel(seatId, { mode: 'table' }) || 'Unknown';
    if (!groups.has(table)) groups.set(table, []);
    groups.get(table).push(seatId);
  });
  if (mode === 'seat') {
    return seats.map((seatId) => markerForSeat(request, seatId));
  }
  const tableMeta = buildTableSeatMeta(request);
  return Array.from(groups.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
    .map(([tableLabel, groupedSeats]) => {
      const totalSeats = tableMeta.get(tableLabel)?.totalSeats || 0;
      return markerForTableGroup(request, tableLabel, groupedSeats, totalSeats);
    });
};

const markerCardHtml = (marker) => `
  <article class="marker-card marker-${escapeHtml(marker.kind)}">
    <div class="marker-inner">
      <h2>${escapeHtml(marker.title)}</h2>
      <p class="guest">${escapeHtml(marker.subtitle)}</p>
      <p class="event">${escapeHtml(marker.eventName)}</p>
      <p class="date">${escapeHtml(marker.eventDate)}</p>
    </div>
  </article>
`;

const buildSeatMarkerPrintHtml = (markers = [], options = {}) => {
  const title = options.title || 'Seat Markers';
  const renderedMarkers = markers.length
    ? markers.map((marker) => markerCardHtml(marker)).join('')
    : '<p class="empty">No markers available for the selected filters.</p>';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; font-family: "Helvetica Neue", Arial, sans-serif; background: #fff; color: #111827; }
      .toolbar { padding: 14px 18px; border-bottom: 1px solid #e5e7eb; display: flex; gap: 10px; align-items: center; }
      .toolbar button { padding: 8px 12px; border: 1px solid #1f2937; background: #111827; color: #fff; border-radius: 6px; cursor: pointer; }
      .page { width: 100%; min-height: 100vh; padding: 8px; box-sizing: border-box; }
      .markers-grid { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: calc(50vh - 12px); gap: 8px; }
      .marker-card { border: 1px dashed #9ca3af; box-sizing: border-box; padding: 10px; display: flex; }
      .marker-inner { border: 1px solid #e5e7eb; border-radius: 10px; width: 100%; padding: 14px; display: flex; flex-direction: column; justify-content: center; }
      h2 { margin: 0 0 10px; font-size: 30px; line-height: 1.15; letter-spacing: 0.02em; }
      .guest { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
      .event { margin: 0 0 6px; font-size: 16px; }
      .date { margin: 0; font-size: 14px; color: #4b5563; }
      .empty { padding: 24px; color: #6b7280; }
      @media print {
        .toolbar { display: none; }
        .page { padding: 0; }
        .markers-grid { gap: 0; }
        .marker-card { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button onclick="window.print()">Print</button>
      <button onclick="window.close()">Close</button>
      <span>${escapeHtml(title)}</span>
    </div>
    <main class="page">
      <section class="markers-grid">
        ${renderedMarkers}
      </section>
    </main>
  </body>
</html>`;
};

export { buildMarkersForRequest, buildSeatMarkerPrintHtml };
