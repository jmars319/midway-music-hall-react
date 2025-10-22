import React from 'react';
import { Armchair } from 'lucide-react';

// small helper to pick classes per seat type
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

export default function Table6({ row, size = 80, selectedSeats = [], pendingSeats = [], onToggleSeat, interactive = true, shape = 'rect' }){
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
  const reservedList = (row.selected_seats && typeof row.selected_seats === 'string') ? (()=>{try{return JSON.parse(row.selected_seats);}catch(e){return []}})() : (row.selected_seats || []);
  const isReserved = reservedList.includes(seatId);
  const isPending = (!isReserved) && Array.isArray(pendingSeats) && pendingSeats.includes(seatId);
  const isSelected = selectedSeats.includes(seatId) && !isReserved && !isPending;
  const classes = `absolute flex items-center justify-center rounded-full ${isReserved ? 'bg-red-600 ring-2 ring-red-400 text-white' : isPending ? 'bg-purple-500/80 border-2 border-dashed border-purple-300 text-white' : seatTypeClass(row.seat_type, isSelected)}`;
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
  const reservedList2 = (row.selected_seats && typeof row.selected_seats === 'string') ? (()=>{try{return JSON.parse(row.selected_seats);}catch(e){return []}})() : (row.selected_seats || []);
  const isReserved2 = reservedList2.includes(seatId);
  const isPending2 = (!isReserved2) && Array.isArray(pendingSeats) && pendingSeats.includes(seatId);
  const isSelected2 = selectedSeats.includes(seatId) && !isReserved2 && !isPending2;
  const classes = `absolute flex items-center justify-center rounded-full ${isReserved2 ? 'bg-red-600 ring-2 ring-red-400 text-white' : isPending2 ? 'bg-purple-500/80 border-2 border-dashed border-purple-300 text-white' : seatTypeClass(row.seat_type, isSelected2)}`;
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
  const reservedList3 = (row.selected_seats && typeof row.selected_seats === 'string') ? (()=>{try{return JSON.parse(row.selected_seats);}catch(e){return []}})() : (row.selected_seats || []);
  const isReserved3 = reservedList3.includes(seatId);
  const isPending3 = (!isReserved3) && Array.isArray(pendingSeats) && pendingSeats.includes(seatId);
  const isSelected3 = selectedSeats.includes(seatId) && !isReserved3 && !isPending3;
  const classes = `absolute flex items-center justify-center rounded-full ${isReserved3 ? 'bg-red-600 ring-2 ring-red-400 text-white' : isPending3 ? 'bg-purple-500/80 border-2 border-dashed border-purple-300 text-white' : seatTypeClass(row.seat_type, isSelected3)}`;
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
