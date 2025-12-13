import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]'
].join(',');

const getFocusableWithin = (node) => {
  if (!node) return [];
  return Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.tabIndex === -1) return false;
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.visibility === 'hidden' || style.display === 'none')) {
      return false;
    }
    return true;
  });
};

export default function useFocusTrap(containerRef, { onClose, enabled = true, autoFocus = true, initialFocusRef } = {}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = containerRef?.current;
    if (!enabled || !node) return undefined;

    const focusable = getFocusableWithin(node);
    const previousActive = document.activeElement;
    const initialTarget = initialFocusRef?.current || focusable[0] || node;
    if (autoFocus && typeof initialTarget?.focus === 'function') {
      initialTarget.focus({ preventScroll: true });
    }

    const handleKeyDown = (event) => {
      if (!node.contains(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof closeRef.current === 'function') {
          closeRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const currentFocusable = getFocusableWithin(node);
      if (currentFocusable.length === 0) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus({ preventScroll: true });
      }
    };
  }, [containerRef, enabled, autoFocus, initialFocusRef]);
}
