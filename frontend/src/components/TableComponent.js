import React, { useMemo } from 'react';
import { Users } from 'lucide-react';
import { resolveSeatVisualState } from '../utils/seatingTheme';
import { buildSeatId, buildSeatLabel } from '../utils/seatLabelUtils';

const shapeAliases = {
  'table-8-rect': 'table-8',
};

const resolveTableSurfaceLabel = (row = {}, fallback = 'Table') => {
  const raw =
    row?.table_number ??
    row?.tableNumber ??
    row?.table_label ??
    row?.display_label ??
    row?.row_label ??
    row?.row ??
    row?.label ??
    '';
  if (raw === '' || raw === null || raw === undefined) return fallback;
  const trimmed = String(raw).replace(/^table\s*/i, '').trim();
  return trimmed || fallback;
};

// Helper to get seat styling based on type
const seatTypeClass = (type) => {
  switch ((type || '').toLowerCase()) {
    case 'vip':
      return 'bg-yellow-500 hover:bg-yellow-400 text-black';
    case 'premium':
      return 'bg-purple-500 hover:bg-purple-400 text-white';
    case 'accessible':
      return 'bg-blue-500 hover:bg-blue-400 text-white';
    case 'standing':
      return 'bg-green-500 hover:bg-green-400 text-white';
    default:
      return 'bg-gray-500 hover:bg-gray-400 text-white';
  }
};

const toSeatSet = (collection = []) => {
  if (collection instanceof Set) return new Set(collection);
  if (Array.isArray(collection)) return new Set(collection);
  return new Set();
};

const parseSelectedSeatList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return [];
    }
  }
  return [];
};

// TableComponent - Flexible seating visualization
// Props:
// - row: seating row object from backend
// - size: base size for rendering (default 60)
// - selectedSeats: array of seat IDs selected by user
// - pendingSeats: array of seat IDs with pending requests
// - onToggleSeat: callback(seatId) when seat clicked
// - interactive: boolean, whether seats are clickable
// - tableShape: type of table ('table-2', 'table-4', 'table-6', 'table-8', 'bar-6', 'booth-4', 'standing-10', 'round-6', etc.)
export default function TableComponent({
  row,
  size = 60,
  selectedSeats = [],
  pendingSeats = [],
  onToggleSeat,
  interactive = true,
  tableShape,
  reservedSeats = [],
  holdSeats = [],
  labelFormatter = null,
  seatReasonResolver = null,
}) {
  const shape = tableShape || row.table_shape || row.seat_type || 'table-6';
  const normalizedShape = shapeAliases[shape] || shape;
  const surfaceLabel = resolveTableSurfaceLabel(row);
  const formatSeatLabel = (value) => (typeof labelFormatter === 'function' ? labelFormatter(value) : value);
  
  const rowReservedList = useMemo(() => parseSelectedSeatList(row.selected_seats), [row.selected_seats]);
  const reservedSeatSet = useMemo(() => {
    const set = toSeatSet(reservedSeats);
    rowReservedList.forEach((seatId) => set.add(seatId));
    return set;
  }, [reservedSeats, rowReservedList]);
  const pendingSeatSet = useMemo(() => toSeatSet(pendingSeats), [pendingSeats]);
  const holdSeatSet = useMemo(() => toSeatSet(holdSeats), [holdSeats]);
  const selectedSeatSet = useMemo(() => toSeatSet(selectedSeats), [selectedSeats]);

  // Check seat status
  const getSeatStatus = (seatId) => {
    const isReserved = reservedSeatSet.has(seatId);
    const isHold = !isReserved && holdSeatSet.has(seatId);
    const isPending = !isReserved && !isHold && pendingSeatSet.has(seatId);
    const isSelected = !isReserved && !isHold && !isPending && selectedSeatSet.has(seatId);
    return { isReserved, isHold, isPending, isSelected };
  };

  // Generate seat classes
  const getSeatClasses = (seatId) => {
    const status = getSeatStatus(seatId);
    const visual = resolveSeatVisualState(status);
    let cursor = 'cursor-pointer';
    if (!interactive) {
      cursor = 'cursor-default';
    } else if (status.isReserved || status.isHold || status.isPending) {
      cursor = 'cursor-not-allowed';
    }
    const visualClass = visual.statusKey === 'available' ? seatTypeClass(row.seat_type) : visual.className;
    return `absolute flex items-center justify-center rounded-full ${cursor} ${visualClass}`;
  };

  // Render individual seat
  const renderSeat = (seatNum, x, y, seatSize) => {
    const seatId = buildSeatId(row, seatNum);
    const seatLabel = formatSeatLabel(buildSeatLabel(row, seatNum));
    const displayLabel = seatLabel.length > 4 ? seatLabel.slice(0, 4) : seatLabel;
    const classes = getSeatClasses(seatId);
    const pointerEventsValue = interactive ? 'auto' : 'none';
    const style = { 
      left: x, 
      top: y, 
      transform: 'translate(-50%, -50%)', 
      width: seatSize, 
      height: seatSize,
      pointerEvents: pointerEventsValue,
      zIndex: 5,
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'transparent',
    };
    const seatStatus = getSeatStatus(seatId);
    const visual = resolveSeatVisualState(seatStatus);
    const disabledReason = seatStatus.isReserved
      ? 'reserved'
      : seatStatus.isHold
        ? 'hold'
        : seatStatus.isPending
          ? 'pending'
          : null;
    const resolvedReason = disabledReason && typeof seatReasonResolver === 'function'
      ? seatReasonResolver(disabledReason)
      : null;
    const titleParts = [seatLabel];
    if (disabledReason) {
      titleParts.push(resolvedReason || visual.label);
    }
    const titleText = titleParts.filter(Boolean).join(' – ');

    if (interactive) {
      return (
        <button 
          key={seatId} 
          onClick={() => onToggleSeat && onToggleSeat(seatId)} 
          className={classes} 
          style={style}
          disabled={Boolean(disabledReason)}
          type="button"
          aria-disabled={Boolean(disabledReason)}
          data-seat-id={seatId}
          data-seat-state={visual.statusKey}
          data-seat-table={row?.row_label || row?.section_name || 'table'}
          title={titleText}
          aria-label={titleText}
        >
          <span className="text-[9px] font-bold relative z-10" style={{ textShadow: '0 0 4px rgba(0,0,0,0.7)' }}>{displayLabel}</span>
        </button>
      );
    }
    
    return (
      <div
        key={seatId}
        className={classes}
        style={style}
        title={titleText}
        data-seat-id={seatId}
        data-seat-state={visual.statusKey}
      >
        <span className="text-[9px] font-bold" style={{ textShadow: '0 0 4px rgba(0,0,0,0.7)' }}>{displayLabel}</span>
      </div>
    );
  };

  // Render table center
  const renderTableCenter = (width, height, label = 'Table', isRound = false) => {
    const labelText = label === 'Table' ? surfaceLabel : label;
    return (
      <div style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width,
        height,
        borderRadius: isRound ? '50%' : 6,
        background: '#4b5563',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 12,
        fontWeight: 500,
        pointerEvents: 'none',
        zIndex: 1,
      }}>
        {labelText}
      </div>
    );
  };

  // TABLE-2: Two seats opposite each other
  if (normalizedShape === 'table-2') {
    const seatSize = Math.max(30, Math.floor(size * 0.36));
    const gap = Math.floor(size * 0.05);
    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.5, size * 0.35, surfaceLabel || 'Table')}
        {renderSeat(1, size / 2, gap + seatSize / 2, seatSize)}
        {renderSeat(2, size / 2, size - gap - seatSize / 2, seatSize)}
      </div>
    );
  }

  // HIGH-TOP-2: Two seats sharing one side (wall-friendly)
  if (normalizedShape === 'high-top-2') {
    const seatSize = Math.floor(size * 0.3);
    const gap = Math.floor(size * 0.08);
    const seatY = size - gap - seatSize / 2;
    const startX = (size - (2 * seatSize) - gap) / 2 + seatSize / 2;
    const tableWidth = size * 0.65;
    const tableHeight = Math.max(18, Math.floor(size * 0.22));

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(tableWidth, tableHeight, surfaceLabel || 'High-Top')}
        {[0, 1].map((i) => renderSeat(i + 1, startX + i * (seatSize + gap), seatY, seatSize))}
      </div>
    );
  }

  // TABLE-4: Two on each side (rectangular)
  if (normalizedShape === 'table-4') {
    const seatSize = Math.floor(size * 0.28);
    const gap = Math.floor(size * 0.05);
    const topY = gap + seatSize / 2;
    const bottomY = size - topY;
    const leftX = gap + seatSize / 2;
    const rightX = size - leftX;
    
    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.5, size * 0.4, surfaceLabel || 'Table')}
        {renderSeat(1, leftX, size / 2, seatSize)}
        {renderSeat(2, size / 2, topY, seatSize)}
        {renderSeat(3, rightX, size / 2, seatSize)}
        {renderSeat(4, size / 2, bottomY, seatSize)}
      </div>
    );
  }

  // TABLE-6: Three on each side (rectangular) - DEFAULT
  if (normalizedShape === 'table-6' || normalizedShape === 'table6') {
    const seatSize = Math.min(28, Math.floor(size * 0.28));
    const gap = Math.max(4, Math.floor(size * 0.04));
    const topY = Math.max(seatSize / 2 + gap, Math.floor(size * 0.18));
    const bottomY = size - topY;
    const startX = (size - (3 * seatSize) - (2 * gap)) / 2 + seatSize / 2;

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.6, size * 0.4, surfaceLabel || 'Table')}
        {[0, 1, 2].map(i => renderSeat(i + 1, startX + i * (seatSize + gap), topY, seatSize))}
        {[0, 1, 2].map(i => renderSeat(i + 4, startX + i * (seatSize + gap), bottomY, seatSize))}
      </div>
    );
  }

  // TABLE-8: Four on each side
  if (normalizedShape === 'table-8') {
    const isLegacyRect = shape === 'table-8-rect';
    const seatSize = Math.floor(size * 0.22);
    const gap = Math.floor(size * 0.03);
    const widthFactor = isLegacyRect ? 1.35 : 1.2;
    const tableWidth = size * widthFactor;
    const startX = (tableWidth - (4 * seatSize) - (3 * gap)) / 2 + seatSize / 2;
    const topY = gap + seatSize / 2;
    const bottomY = size - topY;

    return (
      <div style={{ width: tableWidth, height: size, position: 'relative' }}>
        {renderTableCenter(tableWidth * 0.6, size * 0.35, surfaceLabel || 'Table')}
        {[0, 1, 2, 3].map((i) => renderSeat(i + 1, startX + i * (seatSize + gap), topY, seatSize))}
        {[0, 1, 2, 3].map((i) => renderSeat(i + 5, startX + i * (seatSize + gap), bottomY, seatSize))}
      </div>
    );
  }

  if (normalizedShape === 'chair') {
    const seatSize = Math.max(28, Math.floor(size * 0.55));
    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderSeat(1, size / 2, size / 2, seatSize)}
      </div>
    );
  }

  // ROUND-6: Six seats in circle
  if (normalizedShape === 'round-6') {
    const center = size / 2;
    const seatSize = Math.floor(size * 0.28);
    const radius = size * 0.38;
    const angles = [270, 330, 30, 90, 150, 210];

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.45, size * 0.45, surfaceLabel || 'Table', true)}
        {angles.map((ang, i) => {
          const rad = (ang * Math.PI) / 180;
          const x = center + Math.cos(rad) * radius;
          const y = center + Math.sin(rad) * radius;
          return renderSeat(i + 1, x, y, seatSize);
        })}
      </div>
    );
  }

  // ROUND-8: Eight seats in circle
  if (normalizedShape === 'round-8') {
    const center = size / 2;
    const seatSize = Math.floor(size * 0.24);
    const radius = size * 0.4;
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.48, size * 0.48, surfaceLabel || 'Table', true)}
        {angles.map((ang, i) => {
          const rad = (ang * Math.PI) / 180;
          const x = center + Math.cos(rad) * radius;
          const y = center + Math.sin(rad) * radius;
          return renderSeat(i + 1, x, y, seatSize);
        })}
      </div>
    );
  }

  // BAR-6: Six seats in a row (bar seating)
  if (normalizedShape === 'bar-6') {
    const seatSize = Math.floor(size * 0.28);
    const gap = Math.floor(size * 0.04);
    const startX = (size * 2 - (6 * seatSize) - (5 * gap)) / 2 + seatSize / 2;
    const y = size / 2;

    return (
      <div style={{ width: size * 2, height: size, position: 'relative' }}>
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: size * 1.8,
          height: size * 0.25,
          background: '#6b4423',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 12,
          pointerEvents: 'none'
        }}>
          {surfaceLabel || 'Bar'}
        </div>
        {[0, 1, 2, 3, 4, 5].map(i => renderSeat(i + 1, startX + i * (seatSize + gap), y, seatSize))}
      </div>
    );
  }

  // BOOTH-4: Four seats, two facing two (booth style)
  if (normalizedShape === 'booth-4') {
    const seatSize = Math.floor(size * 0.28);
    const gap = Math.floor(size * 0.08);
    const topY = gap + seatSize / 2;
    const bottomY = size - topY;
    const leftX = size * 0.3;
    const rightX = size * 0.7;

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.35, size * 0.5, 'Booth')}
        {renderSeat(1, leftX, topY, seatSize)}
        {renderSeat(2, rightX, topY, seatSize)}
        {renderSeat(3, leftX, bottomY, seatSize)}
        {renderSeat(4, rightX, bottomY, seatSize)}
      </div>
    );
  }

  // STANDING-10: Standing room section (visualized as grouped people icons)
  if (String(normalizedShape).startsWith('standing-')) {
    const count = parseInt(normalizedShape.split('-')[1], 10) || 10;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const iconSize = Math.floor(size / Math.max(cols, rows) * 0.7);
    const gapX = (size - cols * iconSize) / (cols + 1);
    const gapY = (size - rows * iconSize) / (rows + 1);
    const standingLabel = surfaceLabel || `Standing (${count})`;

    return (
      <div style={{ width: size, height: size, position: 'relative', background: '#10b981', borderRadius: 8, border: '2px dashed #059669' }}>
        <div style={{ position: 'absolute', top: 4, left: 4, fontSize: 10, color: '#fff', fontWeight: 'bold', pointerEvents: 'none' }}>
          {standingLabel}
        </div>
        {Array.from({ length: count }).map((_, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = gapX + col * (iconSize + gapX) + iconSize / 2;
          const y = gapY + row * (iconSize + gapY) + iconSize / 2;
          const seatId = `${row.section_name || row.section}-${row.row_label}-${i + 1}`;
          const classes = getSeatClasses(seatId);
          const style = {
            left: x,
            top: y,
            transform: 'translate(-50%, -50%)',
            width: iconSize,
            height: iconSize,
            cursor: interactive ? 'pointer' : 'default',
            pointerEvents: interactive ? 'auto' : 'none',
            touchAction: 'manipulation',
            zIndex: 5,
          };

          if (interactive) {
            return (
              <button
                key={seatId}
                onClick={() => onToggleSeat && onToggleSeat(seatId)}
                className={classes}
                style={style}
                disabled={getSeatStatus(seatId).isReserved}
              >
                <Users className="h-3 w-3" />
              </button>
            );
          }

          return (
            <div key={seatId} className={classes} style={style}>
              <Users className="h-3 w-3" />
            </div>
          );
        })}
      </div>
    );
  }

  // FALLBACK: Render as simple generic table
  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      {renderTableCenter(size * 0.6, size * 0.6, surfaceLabel || shape, true)}
    </div>
  );
}

// Utility: check if a seat is reserved for a given row (uses row.selected_seats and explicit reservedSeats)
export function isSeatReserved(row, seatId, reservedSeats = []) {
  const reservedList = (() => {
    if (!row.selected_seats) return [];
    if (typeof row.selected_seats === 'string') {
      try { return JSON.parse(row.selected_seats); } catch (e) { return []; }
    }
    return row.selected_seats;
  })();
  return (Array.isArray(reservedList) && reservedList.includes(seatId)) || reservedSeats.includes(seatId);
}
