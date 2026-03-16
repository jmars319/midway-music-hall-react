import { buildSeatLookupMap, describeSeatSelection, formatSeatLabel, isSeatRow } from './seatLabelUtils.js';
import { buildEventRunDisplayLabel } from './eventRunSummary.js';

const MARKERS_PER_PAGE = 4;
const seatSortCollator = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });

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

const withSeatDash = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d+)([A-Za-z]+)$/);
  if (direct) {
    return `${direct[1]}-${direct[2].toUpperCase()}`;
  }
  return raw;
};

const parseSeatSnapshot = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object' && Array.isArray(value.layout_data)) return value.layout_data;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.layout_data)) return parsed.layout_data;
    } catch (err) {
      return [];
    }
  }
  return [];
};

const resolveDisplaySeatLabel = (seatId, lookup = {}) => {
  const mappedLabel = lookup[seatId] || '';
  const display = mappedLabel ? describeSeatSelection(seatId, mappedLabel) : describeSeatSelection(seatId);
  return withSeatDash(display);
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatSingleEventDate = (request = {}) => {
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

const formatEventDate = (request = {}) => buildEventRunDisplayLabel(request, {
  formatSingleDay: (rawValue) => formatSingleEventDate({ ...request, start_datetime: rawValue }),
});

const eventNameForRequest = (request = {}) =>
  request.event_display_name || request.event_artist_name || request.event_title || `Event ${request.event_id || ''}`.trim();

const markerForSeat = (request, seatId, lookup = {}) => {
  const seatLabel = resolveDisplaySeatLabel(seatId, lookup) || withSeatDash(formatSeatLabel(seatId, { mode: 'seat' }));
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

const seatSortParts = (displayLabel, seatId) => {
  const display = String(displayLabel || '').trim();
  const resolvedSeat = formatSeatLabel(display || seatId, { mode: 'seat' }) || '';
  const tableFromDisplay = formatSeatLabel(display || resolvedSeat || seatId, { mode: 'table' }) || '';
  const tableToken = String(tableFromDisplay).trim();
  const tableNumberMatch = tableToken.match(/\d+/);
  const tableNumber = tableNumberMatch ? Number(tableNumberMatch[0]) : Number.POSITIVE_INFINITY;
  const lettersMatch = (resolvedSeat || display).match(/([A-Za-z]+)$/);
  const seatLetters = lettersMatch ? lettersMatch[1].toUpperCase() : '';
  return {
    tableNumber,
    tableToken,
    seatLetters,
    display,
    seatId: String(seatId || '').trim(),
  };
};

const compareSeatEntries = (left, right) => {
  const leftSort = seatSortParts(left.displayLabel, left.seatId);
  const rightSort = seatSortParts(right.displayLabel, right.seatId);
  if (leftSort.tableNumber !== rightSort.tableNumber) {
    return leftSort.tableNumber - rightSort.tableNumber;
  }
  const tableTokenCmp = seatSortCollator.compare(leftSort.tableToken, rightSort.tableToken);
  if (tableTokenCmp !== 0) return tableTokenCmp;
  const seatLabelCmp = seatSortCollator.compare(leftSort.seatLetters, rightSort.seatLetters);
  if (seatLabelCmp !== 0) return seatLabelCmp;
  const displayCmp = seatSortCollator.compare(leftSort.display, rightSort.display);
  if (displayCmp !== 0) return displayCmp;
  return seatSortCollator.compare(leftSort.seatId, rightSort.seatId);
};

const chunkMarkers = (markers = []) => {
  if (!markers.length) return [];
  const pages = [];
  for (let i = 0; i < markers.length; i += MARKERS_PER_PAGE) {
    pages.push(markers.slice(i, i + MARKERS_PER_PAGE));
  }
  return pages;
};

const buildMarkersForRequest = (request = {}, options = {}) => {
  const mode = options.mode === 'seat' ? 'seat' : 'table';
  const seats = parseSeats(request.selected_seats).filter(Boolean);
  if (!seats.length) return [];
  const snapshotRows = parseSeatSnapshot(request.seat_map_snapshot).filter(isSeatRow);
  const seatLookup = buildSeatLookupMap(snapshotRows);
  const sortedSeats = seats
    .map((seatId) => ({
      seatId,
      // Sorting is display-only and based on the same resolved labels used elsewhere.
      displayLabel: resolveDisplaySeatLabel(seatId, seatLookup) || withSeatDash(formatSeatLabel(seatId, { mode: 'seat' })),
    }))
    .sort(compareSeatEntries)
    .map((entry) => entry.seatId);
  // Simplified behavior: always print one marker per seat.
  if (mode === 'seat' || mode === 'table') {
    return sortedSeats.map((seatId) => markerForSeat(request, seatId, seatLookup));
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
  const pages = chunkMarkers(markers);
  const renderedPages = pages.length
    ? pages.map((pageMarkers) => `
      <section class="sheet">
        <div class="markers-grid">
          ${pageMarkers.map((marker) => markerCardHtml(marker)).join('')}
        </div>
      </section>
    `).join('')
    : '<section class="sheet"><p class="empty">No markers available for the selected filters.</p></section>';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      @page { margin: 0.25in; }
      html, body { margin: 0; padding: 0; }
      body { font-family: "Helvetica Neue", Arial, sans-serif; background: #fff; color: #111827; display: flex; flex-direction: column; min-height: 100%; }
      .toolbar { padding: 14px 18px; border-bottom: 1px solid #e5e7eb; display: flex; gap: 10px; align-items: center; }
      .toolbar button { padding: 8px 12px; border: 1px solid #1f2937; background: #111827; color: #fff; border-radius: 6px; cursor: pointer; }
      .pages { flex: 1; width: 100%; }
      .sheet { width: 100%; min-height: 10.5in; box-sizing: border-box; padding: 4px; }
      .markers-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; height: 100%; gap: 4px; }
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
        html, body { width: 100%; height: 100%; }
        .toolbar { display: none; }
        .pages { height: 100%; }
        .sheet {
          padding: 0;
          min-height: 0;
          height: 100%;
          break-after: page;
          page-break-after: always;
        }
        .sheet:last-child {
          break-after: auto;
          page-break-after: auto;
        }
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
    <main class="pages">${renderedPages}</main>
  </body>
</html>`;
};

export { buildMarkersForRequest, buildSeatMarkerPrintHtml };
