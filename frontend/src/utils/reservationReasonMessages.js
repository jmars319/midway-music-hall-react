export const RESERVATION_REASON_FALLBACK_MESSAGE =
  'Unable to complete the reservation. Try again or pick different seats.';

const seatReasonMessages = {
  reserved: 'Seat already confirmed for another guest.',
  pending: 'Seat is part of a pending request awaiting review.',
};

const reservationReasonMessages = {
  missing_selected_seats: 'Select at least one seat before saving the reservation.',
  missing_event_id: 'The reservation is missing its event reference. Reload and pick an event.',
  missing_customer_name: 'Add the guest’s name before confirming.',
  missing_contact_phone: 'Add a phone number so staff can reach the guest.',
  invalid_contact_email: 'Enter a valid email address for the guest.',
  event_not_found: 'This event no longer exists or was removed.',
  event_not_seating_enabled: 'Reserved seating is disabled for this event.',
  seat_conflict: 'One or more seats were taken before this reservation could be saved.',
  invalid_json: 'The submission could not be read. Refresh and try again.',
  runtime_validation_error: 'The request was rejected before reaching the server. Check the form and retry.',
  server_error: 'A server error prevented the reservation. Try again in a moment.',
  unknown: RESERVATION_REASON_FALLBACK_MESSAGE,
};

const reservationReasonFormatters = {
  seat_conflict: (extra = {}) => {
    if (Array.isArray(extra.conflicts) && extra.conflicts.length) {
      const list = extra.conflicts.join(', ');
      return `These seats were already taken: ${list}. Select different seats.`;
    }
    return reservationReasonMessages.seat_conflict;
  },
};

const normalizeCode = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

export const getSeatReasonMessage = (code) => seatReasonMessages[normalizeCode(code)] || null;

export function getAdminReservationFailureMessage(code, fallback, extra = {}) {
  const normalized = normalizeCode(code);
  if (reservationReasonFormatters[normalized]) {
    return reservationReasonFormatters[normalized](extra);
  }
  if (normalized && reservationReasonMessages[normalized]) {
    return reservationReasonMessages[normalized];
  }
  return fallback || RESERVATION_REASON_FALLBACK_MESSAGE;
}
