import { useCallback, useEffect, useState } from 'react';

const QUERY_FLAG = 'debugSeats';
const STORAGE_FLAG = 'SEAT_DEBUG';

export const isSeatDebugEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get(QUERY_FLAG);
    if (queryValue && ['1', 'true', 'yes', 'debug'].includes(queryValue.toLowerCase())) {
      return true;
    }
  } catch (err) {
    // no-op
  }
  try {
    const localValue = window.localStorage?.getItem(STORAGE_FLAG);
    if (localValue && ['1', 'true', 'yes'].includes(localValue.toLowerCase())) {
      return true;
    }
  } catch (err) {
    // ignore storage restrictions
  }
  return false;
};

export function useSeatDebugLogger(scope = 'seat') {
  const [enabled, setEnabled] = useState(() => isSeatDebugEnabled());

  useEffect(() => {
    if (typeof window === 'undefined') return () => {};
    const sync = () => setEnabled(isSeatDebugEnabled());
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('storage', sync);
    };
  }, []);

  const log = useCallback(
    (message, detail = {}) => {
      if (!enabled || typeof console === 'undefined') return;
      try {
        const payload = { scope, message, ...detail };
        console.debug(`[seat-debug:${scope}] ${message}`, payload);
      } catch (err) {
        // Swallow logging errors – debug mode should never break UX.
      }
    },
    [enabled, scope]
  );

  return { enabled, log };
}

export function enableSeatDebugSession() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_FLAG, '1');
  } catch (err) {
    // ignore storage errors
  }
}
