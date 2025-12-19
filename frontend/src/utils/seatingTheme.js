const seatStatusVisualMap = {
  available: {
    label: 'Available',
    className: 'bg-gray-500 text-white',
    tooltip: 'Seat currently available.',
  },
  selected: {
    label: 'Your Selection',
    className: 'bg-purple-600 ring-2 ring-purple-300 text-white',
    tooltip: 'Seat you have selected.',
  },
  hold: {
    label: 'Held (24h)',
    className: 'bg-sky-500/90 ring-2 ring-sky-200 text-slate-900',
    tooltip: 'Seat is on a temporary hold window.',
  },
  pending: {
    label: 'Pending Review',
    className: 'bg-amber-500/80 border-2 border-amber-200 text-amber-950',
    tooltip: 'Seat is part of a pending request.',
  },
  reserved: {
    label: 'Reserved',
    className: 'bg-red-600 ring-2 ring-red-400 text-white',
    tooltip: 'Seat is fully confirmed.',
  },
};

export const seatingStatusVisuals = seatStatusVisualMap;

export const seatingStatusClasses = {
  selected: seatStatusVisualMap.selected.className,
  pending: seatStatusVisualMap.pending.className,
  hold: seatStatusVisualMap.hold.className,
  reserved: seatStatusVisualMap.reserved.className,
};

export const seatingLegendSwatches = Object.fromEntries(
  Object.entries(seatStatusVisualMap).map(([key, value]) => [key, value.className])
);

export const seatingStatusLabels = Object.fromEntries(
  Object.entries(seatStatusVisualMap).map(([key, value]) => [key, value.label])
);

export const SEAT_STATUS_ORDER = ['available', 'selected', 'hold', 'pending', 'reserved'];

export const buildSeatLegendItems = (keys = SEAT_STATUS_ORDER) =>
  keys
    .filter((key) => seatingStatusLabels[key])
    .map((key) => ({
      key,
      label: seatingStatusLabels[key],
      className: seatingLegendSwatches[key],
    }));

const STATUS_PRIORITY = {
  available: 0,
  hold: 1,
  pending: 2,
  reserved: 3,
};

const normalizeSeatList = (value = []) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((id) => (typeof id === 'string' || typeof id === 'number' ? String(id).trim() : ''))
      .filter(Boolean);
  }
  if (value instanceof Set) {
    return Array.from(value).map((id) => String(id)).filter(Boolean);
  }
  return [];
};

export function buildSeatStatusMap({ reserved = [], pending = [], hold = [] } = {}) {
  const statusMap = new Map();
  const applyStatus = (ids, status) => {
    normalizeSeatList(ids).forEach((seatId) => {
      const current = statusMap.get(seatId);
      if (!current || STATUS_PRIORITY[status] >= STATUS_PRIORITY[current]) {
        statusMap.set(seatId, status);
      }
    });
  };
  applyStatus(hold, 'hold');
  applyStatus(pending, 'pending');
  applyStatus(reserved, 'reserved');
  return statusMap;
}

export function resolveSeatVisualState({
  isSelected = false,
  isReserved = false,
  isPending = false,
  isHold = false,
} = {}) {
  let statusKey = 'available';
  if (isSelected) statusKey = 'selected';
  else if (isReserved) statusKey = 'reserved';
  else if (isPending) statusKey = 'pending';
  else if (isHold) statusKey = 'hold';

  const visual = seatStatusVisualMap[statusKey] || seatStatusVisualMap.available;
  return {
    statusKey,
    className: visual.className,
    label: visual.label,
    tooltip: visual.tooltip || visual.label,
  };
}
