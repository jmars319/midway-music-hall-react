import React from 'react';
import { Armchair } from 'lucide-react';
import { seatingStatusClasses } from '../utils/seatingTheme';

// small helper to pick classes per seat type
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

// Table6 component
// Renders a 6-seat table in either rectangular (two rows of 3) or circular layout.
// Props:
// - row: seating row object (contains section_name, row_label, selected_seats, seat_type, etc.)
// - selectedSeats: array of seat ids the user has selected
// - pendingSeats: seats with pending requests (rendered with dashed border)
// - onToggleSeat(seatId): callback when user clicks a seat
// - interactive: when false, renders static view
// - shape: 'rect' or 'round'
export default function Table6({ row, size = 80, selectedSeats = [], pendingSeats = [], onToggleSeat, interactive = true, shape = 'rect' }){
  /* Developer notes - rendering and data shapes
     - `row` is the seating row model from the backend. Important fields:
         * section_name / section: textual section identifier
         * row_label: label for the row/group (e.g., 'A')
         * selected_seats: JSON array (or JSON string) stored in DB for
           seats already reserved on this row
         * seat_type: used to determine color/visual treatment
     - `selectedSeats` (prop) represents the user's current in-memory
       selection across the chart and may include seats from multiple rows.
     - `pendingSeats` (prop) is a list of seatIds which are part of
       outstanding seat_requests with status 'pending'; they should be
       considered temporarily unavailable for selection.
     - Visual state priority is: reserved (DB) > pending (requests) > user-selected.
  */
  // shape: 'rect' (two rows of 3) or 'round' (circle with 6 around)
  const isRound = shape === 'round';
  const center = size/2;
  const seatSize = Math.min(28, Math.floor(size * 0.28));
  const gap = Math.max(4, Math.floor(size * 0.04));

  // For rectangular layout we'll place three seats along the top edge and three along the bottom edge,
  // centered horizontally. For round layout fallback to previous radial layout.
  const topY = Math.max(seatSize/2 + gap, Math.floor(size * 0.18));
  const bottomY = size - topY;
  const startX = (size - (3 * seatSize) - (2 * gap)) / 2 + seatSize/2; // center x of first seat

  const radialAngles = [270, 330, 30, 90, 150, 210];

  const reservedSeatList = (() => {
    if (!row.selected_seats) return [];
    if (typeof row.selected_seats === 'string') {
      try {
        return JSON.parse(row.selected_seats);
      } catch (e) {
        return [];
      }
    }
    return row.selected_seats;
  })();

  const seatClasses = (seatId) => {
    const isReserved = reservedSeatList.includes(seatId);
    const isPending = (!isReserved) && Array.isArray(pendingSeats) && pendingSeats.includes(seatId);
    const isSelected = selectedSeats.includes(seatId) && !isReserved && !isPending;
    if (isReserved) return seatingStatusClasses.reserved;
    if (isPending) return seatingStatusClasses.pending;
    if (isSelected) return seatingStatusClasses.selected;
    return seatTypeClass(row.seat_type);
  };

  return (
    <div style={{ width: size, height: size, position: 'relative' }}>
      {/* center table */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: isRound ? size*0.45 : size*0.6, height: isRound ? size*0.45 : size*0.4, borderRadius: isRound ? '50%' : 6, background: '#4b5563', display: 'flex', alignItems: 'center', justifyContent: 'center', color:'#fff', fontSize: 12 }}>
        Table
      </div>

      {[0,1,2].map(i => {
        // top row seats (seat 1..3)
        const seatNum = i + 1;
        const x = startX + i * (seatSize + gap);
        const y = topY;
        const seatId = `${row.section_name || row.section}-${row.row_label}-${seatNum}`;
  const classes = `absolute flex items-center justify-center rounded-full ${seatClasses(seatId)}`;
        const style = { left: x, top: y, transform: 'translate(-50%, -50%)', width: seatSize, height: seatSize };
        if (interactive) {
          return (
            <button key={seatId} onClick={() => onToggleSeat && onToggleSeat(seatId)} className={classes} style={style}>
              <Armchair className="h-4 w-4" />
            </button>
          );
        }
        return (
          <div key={seatId} className={classes} style={style}>
            <Armchair className="h-4 w-4" />
          </div>
        );
      })}

      {[0,1,2].map(i => {
        // bottom row seats (seat 4..6)
        const seatNum = 4 + i;
        const x = startX + i * (seatSize + gap);
        const y = bottomY;
        const seatId = `${row.section_name || row.section}-${row.row_label}-${seatNum}`;
  const classes = `absolute flex items-center justify-center rounded-full ${seatClasses(seatId)}`;
        const style = { left: x, top: y, transform: 'translate(-50%, -50%)', width: seatSize, height: seatSize };
        if (interactive) {
          return (
            <button key={seatId} onClick={() => onToggleSeat && onToggleSeat(seatId)} className={classes} style={style}>
              <Armchair className="h-4 w-4" />
            </button>
          );
        }
        return (
          <div key={seatId} className={classes} style={style}>
            <Armchair className="h-4 w-4" />
          </div>
        );
      })}

      {/* fallback round layout (hidden when rectangular view used) - keep for shape='round' */}
      {isRound && radialAngles.map((ang, i) => {
        const rad = (ang * Math.PI) / 180;
        const radius = size * 0.38; // radius for seats
        const x = center + Math.cos(rad) * radius;
        const y = center + Math.sin(rad) * radius;
        const seatNum = i + 1;
        const seatId = `${row.section_name || row.section}-${row.row_label}-${seatNum}`;
  const classes = `absolute flex items-center justify-center rounded-full ${seatClasses(seatId)}`;
        const style = { left: x, top: y, transform: 'translate(-50%, -50%)', width: seatSize, height: seatSize };
        if (interactive) {
          return (
            <button key={seatId} onClick={() => onToggleSeat && onToggleSeat(seatId)} className={classes} style={style}>
              <Armchair className="h-4 w-4" />
            </button>
          );
        }
        return (
          <div key={seatId} className={classes} style={style}>
            <Armchair className="h-4 w-4" />
          </div>
        );
      })}
    </div>
  );
}
