import { useCallback, useEffect, useMemo, useState } from 'react';

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

export function useSeatDebugProbe(ref, logger, options = {}) {
  const highlightDuration = options.highlightDuration ?? 900;
  const enabled = Boolean(logger?.enabled);
  const logFn = useMemo(() => (typeof logger?.log === 'function' ? logger.log : null), [logger]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return () => {};
    const node = ref?.current;
    if (!node) return () => {};
    const handlePointerDown = (event) => {
      const seatTarget = event.target?.closest?.('[data-seat-id]');
      if (seatTarget) return;

      const point = 'touches' in event ? event.touches[0] : event;
      if (!point) return;
      const blocker = document.elementFromPoint(point.clientX, point.clientY);
      if (!blocker || !(blocker instanceof Element)) return;

      const classList =
        typeof blocker.className === 'string'
          ? blocker.className
          : Array.from(blocker.classList || []).join(' ');
      if (logFn) {
        logFn('seat-pointer-blocked', {
          targetTag: event.target?.tagName,
          blockerTag: blocker.tagName,
          blockerClasses: classList,
          clientX: Math.round(point.clientX),
          clientY: Math.round(point.clientY),
        });
      }

      const prevOutline = blocker.style?.outline;
      const prevOffset = blocker.style?.outlineOffset;
      blocker.dataset.seatDebugHighlight = '1';
      blocker.style.outline = '2px dashed #fb923c';
      blocker.style.outlineOffset = '2px';
      window.setTimeout(() => {
        if (!blocker) return;
        if (blocker.dataset.seatDebugHighlight) {
          blocker.style.outline = prevOutline || '';
          blocker.style.outlineOffset = prevOffset || '';
          delete blocker.dataset.seatDebugHighlight;
        }
      }, highlightDuration);
    };

    node.addEventListener('pointerdown', handlePointerDown, true);
    node.addEventListener('touchstart', handlePointerDown, true);

    return () => {
      node.removeEventListener('pointerdown', handlePointerDown, true);
      node.removeEventListener('touchstart', handlePointerDown, true);
    };
  }, [enabled, highlightDuration, logFn, ref]);
}
