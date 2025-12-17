// seatAvailability utilities keep seat enable/disable logic centralized so the
// public and admin flows derive their UI state from the same rules.
export const SeatDisableReasons = {
  RESERVED: 'reserved',
  PENDING: 'pending',
};

const toSeatSet = (collection = []) => {
  if (collection instanceof Set) return collection;
  if (Array.isArray(collection)) return new Set(collection);
  return new Set();
};

export function resolveSeatDisableReason(seatId, reservedSeats, pendingSeats) {
  if (!seatId) return null;
  const reservedSet = toSeatSet(reservedSeats);
  if (reservedSet.has(seatId)) return SeatDisableReasons.RESERVED;
  const pendingSet = toSeatSet(pendingSeats);
  if (pendingSet.has(seatId)) return SeatDisableReasons.PENDING;
  return null;
}

export function filterUnavailableSeats(selection = [], reservedSeats, pendingSeats) {
  if (!Array.isArray(selection) || selection.length === 0) return [];
  const reservedSet = toSeatSet(reservedSeats);
  const pendingSet = toSeatSet(pendingSeats);
  return selection.filter((seatId) => seatId && !reservedSet.has(seatId) && !pendingSet.has(seatId));
}

// Stress helper used by tests to validate sequential reservation flows.
export function simulateSequentialReservationRun({
  totalSeats = 60,
  seatPrefix = 'SIM-SEAT',
  pendingInterval = 0,
} = {}) {
  const reserved = new Set();
  const pending = new Set();
  let successfulRequests = 0;
  let blockedRequests = 0;

  for (let i = 1; i <= totalSeats; i += 1) {
    const seatId = `${seatPrefix}-${i}`;
    const reason = resolveSeatDisableReason(seatId, reserved, pending);
    if (reason) {
      blockedRequests += 1;
      continue;
    }
    successfulRequests += 1;
    reserved.add(seatId);
    if (pendingInterval > 0 && i % pendingInterval === 0) {
      pending.add(`${seatPrefix}-PENDING-${i}`);
    }
  }

  const exhaustionReason = resolveSeatDisableReason(`${seatPrefix}-${totalSeats}`, reserved, pending);
  return {
    successfulRequests,
    blockedRequests,
    reservedCount: reserved.size,
    exhaustionReason,
  };
}
