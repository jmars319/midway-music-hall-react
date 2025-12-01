import React from 'react';
import { Armchair, Users } from 'lucide-react';

// Helper to get seat styling based on type
const seatTypeClass = (type, selected) => {
  if (selected) return 'bg-purple-700 ring-2 ring-purple-400 text-white';
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
  tableShape
}) {
  const shape = tableShape || row.table_shape || row.seat_type || 'table-6';
  
  // Parse reserved seats from DB
  const reservedList = (() => {
    if (!row.selected_seats) return [];
    if (typeof row.selected_seats === 'string') {
      try { return JSON.parse(row.selected_seats); } catch(e) { return []; }
    }
    return row.selected_seats;
  })();

  // Check seat status
  const getSeatStatus = (seatId) => {
    const isReserved = reservedList.includes(seatId);
    const isPending = !isReserved && pendingSeats.includes(seatId);
    const isSelected = selectedSeats.includes(seatId) && !isReserved && !isPending;
    return { isReserved, isPending, isSelected };
  };

  // Generate seat classes
  const getSeatClasses = (seatId) => {
    const { isReserved, isPending, isSelected } = getSeatStatus(seatId);
    return `absolute flex items-center justify-center rounded-full ${
      isReserved ? 'bg-red-600 ring-2 ring-red-400 text-white' : 
      isPending ? 'bg-purple-500/80 border-2 border-dashed border-purple-300 text-white' : 
      seatTypeClass(row.seat_type, isSelected)
    }`;
  };

  // Generate seat label (AA, AB, AC, etc.)
  const getSeatLabel = (seatNum) => {
    const rowLabel = row.row_label || 'A';
    // Convert number to letter: 1->A, 2->B, etc.
    const letter = String.fromCharCode(64 + seatNum); // 65 is 'A'
    return `${rowLabel}${letter}`;
  };

  // Render individual seat
  const renderSeat = (seatNum, x, y, seatSize) => {
    const seatId = `${row.section_name || row.section}-${row.row_label}-${seatNum}`;
    const seatLabel = getSeatLabel(seatNum);
    const classes = getSeatClasses(seatId);
    const style = { 
      left: x, 
      top: y, 
      transform: 'translate(-50%, -50%)', 
      width: seatSize, 
      height: seatSize,
      cursor: interactive ? 'pointer' : 'default'
    };

    if (interactive) {
      return (
        <button 
          key={seatId} 
          onClick={() => onToggleSeat && onToggleSeat(seatId)} 
          className={classes} 
          style={style}
          disabled={getSeatStatus(seatId).isReserved}
          title={seatLabel}
        >
          <span className="text-[8px] font-bold">{seatLabel}</span>
        </button>
      );
    }
    
    return (
      <div key={seatId} className={classes} style={style} title={seatLabel}>
        <span className="text-[8px] font-bold">{seatLabel}</span>
      </div>
    );
  };

  // Render table center
  const renderTableCenter = (width, height, label = 'Table', isRound = false) => {
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
        fontWeight: 500
      }}>
        {label}
      </div>
    );
  };

  // TABLE-2: Two seats opposite each other
  if (shape === 'table-2') {
    const seatSize = Math.floor(size * 0.32);
    const gap = Math.floor(size * 0.05);
    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.5, size * 0.35, 'Table')}
        {renderSeat(1, size / 2, gap + seatSize / 2, seatSize)}
        {renderSeat(2, size / 2, size - gap - seatSize / 2, seatSize)}
      </div>
    );
  }

  // TABLE-4: Two on each side (rectangular)
  if (shape === 'table-4') {
    const seatSize = Math.floor(size * 0.28);
    const gap = Math.floor(size * 0.05);
    const topY = gap + seatSize / 2;
    const bottomY = size - topY;
    const leftX = gap + seatSize / 2;
    const rightX = size - leftX;
    
    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.5, size * 0.4, 'Table')}
        {renderSeat(1, leftX, size / 2, seatSize)}
        {renderSeat(2, size / 2, topY, seatSize)}
        {renderSeat(3, rightX, size / 2, seatSize)}
        {renderSeat(4, size / 2, bottomY, seatSize)}
      </div>
    );
  }

  // TABLE-6: Three on each side (rectangular) - DEFAULT
  if (shape === 'table-6' || shape === 'table6') {
    const seatSize = Math.min(28, Math.floor(size * 0.28));
    const gap = Math.max(4, Math.floor(size * 0.04));
    const topY = Math.max(seatSize / 2 + gap, Math.floor(size * 0.18));
    const bottomY = size - topY;
    const startX = (size - (3 * seatSize) - (2 * gap)) / 2 + seatSize / 2;

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.6, size * 0.4, 'Table')}
        {[0, 1, 2].map(i => renderSeat(i + 1, startX + i * (seatSize + gap), topY, seatSize))}
        {[0, 1, 2].map(i => renderSeat(i + 4, startX + i * (seatSize + gap), bottomY, seatSize))}
      </div>
    );
  }

  // TABLE-8: Four on each side
  if (shape === 'table-8') {
    const seatSize = Math.floor(size * 0.22);
    const gap = Math.floor(size * 0.03);
    const topY = gap + seatSize / 2;
    const bottomY = size - topY;
    const startX = (size - (4 * seatSize) - (3 * gap)) / 2 + seatSize / 2;

    return (
      <div style={{ width: size * 1.2, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.8, size * 0.35, 'Table')}
        {[0, 1, 2, 3].map(i => renderSeat(i + 1, startX + i * (seatSize + gap), topY, seatSize))}
        {[0, 1, 2, 3].map(i => renderSeat(i + 5, startX + i * (seatSize + gap), bottomY, seatSize))}
      </div>
    );
  }

  // ROUND-6: Six seats in circle
  if (shape === 'round-6') {
    const center = size / 2;
    const seatSize = Math.floor(size * 0.28);
    const radius = size * 0.38;
    const angles = [270, 330, 30, 90, 150, 210];

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.45, size * 0.45, 'Table', true)}
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
  if (shape === 'round-8') {
    const center = size / 2;
    const seatSize = Math.floor(size * 0.24);
    const radius = size * 0.4;
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];

    return (
      <div style={{ width: size, height: size, position: 'relative' }}>
        {renderTableCenter(size * 0.48, size * 0.48, 'Table', true)}
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
  if (shape === 'bar-6') {
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
          fontSize: 12
        }}>
          Bar
        </div>
        {[0, 1, 2, 3, 4, 5].map(i => renderSeat(i + 1, startX + i * (seatSize + gap), y, seatSize))}
      </div>
    );
  }

  // BOOTH-4: Four seats, two facing two (booth style)
  if (shape === 'booth-4') {
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
  if (shape.startsWith('standing-')) {
    const count = parseInt(shape.split('-')[1]) || 10;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const iconSize = Math.floor(size / Math.max(cols, rows) * 0.7);
    const gapX = (size - cols * iconSize) / (cols + 1);
    const gapY = (size - rows * iconSize) / (rows + 1);

    return (
      <div style={{ width: size, height: size, position: 'relative', background: '#10b981', borderRadius: 8, border: '2px dashed #059669' }}>
        <div style={{ position: 'absolute', top: 4, left: 4, fontSize: 10, color: '#fff', fontWeight: 'bold' }}>
          Standing ({count})
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
            cursor: interactive ? 'pointer' : 'default'
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
      {renderTableCenter(size * 0.6, size * 0.6, shape, true)}
    </div>
  );
}
