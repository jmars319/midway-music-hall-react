import React, { useCallback, useMemo } from 'react';
import { Users } from 'lucide-react';
import { resolveSeatVisualState } from '../utils/seatingTheme';
import { buildSeatId, buildSeatLabel } from '../utils/seatLabelUtils';
import {
  DEFAULT_TABLE_SHAPE,
  getTableLayoutMetrics,
  normalizeTableShapeValue,
} from '../utils/tableLayoutGeometry';

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
  seatStatusMap = null,
  textRotation = 0,
  tierVisual = null,
}) {
  const shape = tableShape || row.table_shape || row.seat_type || DEFAULT_TABLE_SHAPE;
  const normalizedShape = normalizeTableShapeValue(shape) || DEFAULT_TABLE_SHAPE;
  const surfaceLabel = resolveTableSurfaceLabel(row);
  const formatSeatLabel = (value) => (typeof labelFormatter === 'function' ? labelFormatter(value) : value);
  const textRotationStyle = textRotation ? { transform: `rotate(${textRotation}deg)` } : null;
  const layoutMetrics = useMemo(
    () => getTableLayoutMetrics(normalizedShape, { size }),
    [normalizedShape, size]
  );
  
  const rowReservedList = useMemo(() => parseSelectedSeatList(row.selected_seats), [row.selected_seats]);
  const reservedSeatSet = useMemo(() => {
    const set = toSeatSet(reservedSeats);
    rowReservedList.forEach((seatId) => set.add(seatId));
    return set;
  }, [reservedSeats, rowReservedList]);
  const pendingSeatSet = useMemo(() => toSeatSet(pendingSeats), [pendingSeats]);
  const holdSeatSet = useMemo(() => toSeatSet(holdSeats), [holdSeats]);
  const selectedSeatSet = useMemo(() => toSeatSet(selectedSeats), [selectedSeats]);

  const readSeatStatusFromMap = useCallback(
    (seatId) => {
      if (!seatStatusMap) return null;
      if (seatStatusMap instanceof Map) {
        return seatStatusMap.get(seatId) || null;
      }
      if (typeof seatStatusMap === 'object') {
        return seatStatusMap[seatId] || null;
      }
      return null;
    },
    [seatStatusMap]
  );

  const getSeatStatus = (seatId) => {
    const mappedStatus = readSeatStatusFromMap(seatId);
    const isReserved = mappedStatus === 'reserved' || reservedSeatSet.has(seatId);
    const isPending =
      mappedStatus === 'pending' || (!isReserved && pendingSeatSet.has(seatId));
    const isHold =
      mappedStatus === 'hold' || (!isReserved && !isPending && holdSeatSet.has(seatId));
    const isSelected =
      mappedStatus === 'selected' ||
      (!isReserved && !isPending && !isHold && selectedSeatSet.has(seatId));
    const statusKey =
      mappedStatus ||
      (isReserved ? 'reserved' : isPending ? 'pending' : isHold ? 'hold' : 'available');
    return { isReserved, isHold, isPending, isSelected, statusKey };
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
    const visualClass =
      visual.statusKey === 'available' ? seatTypeClass(row.seat_type) : visual.className;
    return { className: `absolute flex items-center justify-center rounded-full ${cursor} ${visualClass}`, status, visual };
  };

  const getSeatCue = (statusKey) => {
    switch (statusKey) {
      case 'selected':
        return 'S';
      case 'reserved':
        return 'R';
      case 'pending':
        return 'P';
      case 'hold':
        return 'H';
      default:
        return 'A';
    }
  };

  // Render individual seat
  const renderSeat = (seatNum, x, y, seatSize) => {
    const seatId = buildSeatId(row, seatNum);
    const seatLabel = formatSeatLabel(buildSeatLabel(row, seatNum));
    const displayLabel = seatLabel.length > 4 ? seatLabel.slice(0, 4) : seatLabel;
    const { className, status, visual } = getSeatClasses(seatId);
    const pointerEventsValue = interactive ? 'auto' : 'none';
    const cueText = getSeatCue(visual.statusKey);
    const statusOverlayStyles = {
      reserved: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.28), rgba(0,0,0,0.28) 3px, rgba(255,255,255,0.04) 3px, rgba(255,255,255,0.04) 6px)',
      pending: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.18), rgba(0,0,0,0.18) 3px, rgba(255,255,255,0.05) 3px, rgba(255,255,255,0.05) 6px)',
      hold: 'repeating-linear-gradient(0deg, rgba(15,23,42,0.14), rgba(15,23,42,0.14) 2px, rgba(255,255,255,0.08) 2px, rgba(255,255,255,0.08) 5px)',
    };
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
      backgroundImage: statusOverlayStyles[visual.statusKey] || 'none',
      outline: visual.statusKey === 'selected' ? '2px solid rgba(255,255,255,0.9)' : undefined,
      outlineOffset: visual.statusKey === 'selected' ? '1px' : undefined,
    };
    const disabledReason = status.isReserved
      ? 'reserved'
      : status.isPending
        ? 'pending'
        : status.isHold
          ? 'hold'
          : null;
    const resolvedReason = disabledReason && typeof seatReasonResolver === 'function'
      ? seatReasonResolver(disabledReason)
      : null;
    const statusLabel = disabledReason ? (resolvedReason || visual.label) : visual.label;
    const titleParts = [seatLabel, statusLabel];
    const titleText = titleParts.filter(Boolean).join(' – ');

    if (interactive) {
      const handleClick = (event) => {
        const dataSeatState = event?.currentTarget?.dataset?.seatState || visual.statusKey;
        onToggleSeat?.(seatId, {
          dataSeatState,
          seatStatus: status.statusKey,
        });
      };
      return (
        <button 
          key={seatId} 
          onClick={handleClick} 
          className={className} 
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
          <span
            className="text-[9px] font-bold relative z-10 inline-flex items-center justify-center"
            style={{ textShadow: '0 0 4px rgba(0,0,0,0.7)', ...(textRotationStyle || {}) }}
          >
            {displayLabel}
          </span>
          <span
            className="absolute -top-1 -right-1 rounded-full bg-black/65 px-1 text-[8px] font-bold text-white leading-tight"
            style={textRotationStyle || undefined}
            aria-hidden="true"
          >
            {cueText}
          </span>
        </button>
      );
    }
    
    return (
      <div
        key={seatId}
        className={className}
        style={style}
        title={titleText}
        data-seat-id={seatId}
        data-seat-state={visual.statusKey}
      >
        <span
          className="text-[9px] font-bold inline-flex items-center justify-center"
          style={{ textShadow: '0 0 4px rgba(0,0,0,0.7)', ...(textRotationStyle || {}) }}
        >
          {displayLabel}
        </span>
        <span
          className="absolute -top-1 -right-1 rounded-full bg-black/65 px-1 text-[8px] font-bold text-white leading-tight"
          style={textRotationStyle || undefined}
          aria-hidden="true"
        >
          {cueText}
        </span>
      </div>
    );
  };

  // Render table center
  const renderTableCenter = (width, height, label = 'Table', isRound = false) => {
    const labelText = label === 'Table' ? surfaceLabel : label;
    return (
      <div
        data-tier-surface={tierVisual?.id || undefined}
        data-tier-pattern={tierVisual?.patternId || undefined}
        data-tier-color={tierVisual?.color || undefined}
        style={{
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
          ...(tierVisual?.surfaceStyle || {}),
        }}
      >
        <span style={textRotationStyle ? { ...textRotationStyle, display: 'inline-block' } : undefined}>{labelText}</span>
      </div>
    );
  };

  if (String(normalizedShape).startsWith('standing-')) {
    const count = parseInt(normalizedShape.split('-')[1], 10) || layoutMetrics.seats.length || 10;
    const standingLabel = surfaceLabel || `Standing (${count})`;

    return (
      <div
        data-tier-surface={tierVisual?.id || undefined}
        data-tier-pattern={tierVisual?.patternId || undefined}
        data-tier-color={tierVisual?.color || undefined}
        style={{
          width: layoutMetrics.width,
          height: layoutMetrics.height,
          position: 'relative',
          background: '#10b981',
          borderRadius: 8,
          border: '2px dashed #059669',
          ...(tierVisual?.surfaceStyle || {}),
        }}
        >
        <div style={{ position: 'absolute', top: 4, left: 4, fontSize: 10, color: '#fff', fontWeight: 'bold', pointerEvents: 'none' }}>
          {standingLabel}
        </div>
        {layoutMetrics.seats.map((seat) => {
          const seatId = buildSeatId(row, seat.number);
          const classes = getSeatClasses(seatId);
          const style = {
            left: seat.x,
            top: seat.y,
            transform: 'translate(-50%, -50%)',
            width: seat.size,
            height: seat.size,
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
                className={classes.className}
                style={style}
                disabled={getSeatStatus(seatId).isReserved}
              >
                <Users className="h-3 w-3" />
              </button>
            );
          }

          return (
            <div key={seatId} className={classes.className} style={style}>
              <Users className="h-3 w-3" />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ width: layoutMetrics.width, height: layoutMetrics.height, position: 'relative' }}>
      {layoutMetrics.surface
        ? renderTableCenter(
            layoutMetrics.surface.width,
            layoutMetrics.surface.height,
            surfaceLabel || shape,
            Boolean(layoutMetrics.surface.round)
          )
        : null}
      {layoutMetrics.seats.map((seat) => renderSeat(seat.number, seat.x, seat.y, seat.size))}
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
