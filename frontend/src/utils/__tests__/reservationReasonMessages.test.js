import { getAdminReservationFailureMessage, RESERVATION_REASON_FALLBACK_MESSAGE } from '../reservationReasonMessages';

describe('reservation reason messages', () => {
  it('falls back to the default message for unknown codes', () => {
    const message = getAdminReservationFailureMessage('made_up_code', '', {});

    expect(message).toBe(RESERVATION_REASON_FALLBACK_MESSAGE);
    expect(typeof message).toBe('string');
    expect(message.trim().length).toBeGreaterThan(0);
  });
});
