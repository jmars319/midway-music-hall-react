import { filterUnavailableSeats, resolveSeatDisableReason, SeatDisableReasons, simulateSequentialReservationRun } from '../seatAvailability';

describe('seatAvailability sequential guard', () => {
  test('sequential reservations succeed until inventory exhausted', () => {
    const reserved = new Set();
    const pending = new Set();
    let workingSelection = [];
    const totalSeats = 80;

    for (let i = 1; i <= totalSeats; i += 1) {
      const seatId = `SIM-${i}`;
      expect(resolveSeatDisableReason(seatId, reserved, pending)).toBeNull();
      workingSelection = [...workingSelection, seatId];
      const stillAvailable = filterUnavailableSeats(workingSelection, reserved, pending);
      expect(stillAvailable).toContain(seatId);
      reserved.add(seatId);
      const trimmedSelection = filterUnavailableSeats(workingSelection, reserved, pending);
      expect(trimmedSelection).not.toContain(seatId);
    }

    expect(reserved.size).toBe(totalSeats);
    const exhaustedReason = resolveSeatDisableReason(`SIM-${totalSeats}`, reserved, pending);
    expect(exhaustedReason).toBe(SeatDisableReasons.RESERVED);
  });

  test('pending seats surface explicit reason codes', () => {
    const reserved = new Set(['SIM-1']);
    const pending = new Set(['SIM-2', 'SIM-4']);

    expect(resolveSeatDisableReason('SIM-1', reserved, pending)).toBe(SeatDisableReasons.RESERVED);
    expect(resolveSeatDisableReason('SIM-2', reserved, pending)).toBe(SeatDisableReasons.PENDING);
    expect(resolveSeatDisableReason('SIM-3', reserved, pending)).toBeNull();
  });

  test('stress helper stays healthy for large runs', () => {
    const result = simulateSequentialReservationRun({ totalSeats: 120, pendingInterval: 7 });
    expect(result.successfulRequests).toBe(120);
    expect(result.reservedCount).toBe(120);
    expect(result.exhaustionReason).toBe(SeatDisableReasons.RESERVED);
    expect(result.blockedRequests).toBe(0);
  });
});
