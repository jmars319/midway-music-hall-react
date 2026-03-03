import { formatSeatLabel } from './seatLabelUtils.js';

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

const eventNameForRequest = (request = {}) =>
  request.event_display_name || request.event_artist_name || request.event_title || `Event ${request.event_id || ''}`.trim();

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
  // Simplified behavior: always print one marker per seat.
  if (mode === 'seat' || mode === 'table') {
    return seats.map((seatId) => markerForSeat(request, seatId));
  }
  return [];
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
      .marker-inner {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        width: 100%;
        padding: 18px 16px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
      }
      .guest {
        margin: 0 0 10px;
        font-size: 40px;
        line-height: 1.1;
        font-weight: 800;
        letter-spacing: 0.01em;
      }
      h2 {
        margin: 0 0 10px;
        font-size: 34px;
        line-height: 1.1;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .event {
        margin: 0 0 8px;
        font-size: 24px;
        line-height: 1.2;
        font-weight: 600;
      }
      .date {
        margin: 0;
        font-size: 20px;
        line-height: 1.25;
        color: #374151;
        font-weight: 500;
      }
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
