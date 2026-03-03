import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import useSiteContent from '../hooks/useSiteContent';

const POPUP_DISMISS_KEY_PREFIX = 'mmh_announcement_popup_dismissed_v2_';
const POPUP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const DEFAULT_POPUP = {
  enabled: false,
  message: '',
  severity: 'info',
  link_url: '',
  link_text: '',
  allow_during_seat_selection: false,
};

const SEVERITY_STYLES = {
  info: 'bg-sky-600 text-white border-sky-700',
  warning: 'bg-amber-400 text-slate-900 border-amber-500',
  urgent: 'bg-red-600 text-white border-red-700',
};

const normalizePopup = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_POPUP, ...source };
  merged.enabled = Boolean(merged.enabled);
  merged.message = typeof merged.message === 'string' ? merged.message.trim() : '';
  merged.severity = ['info', 'warning', 'urgent'].includes(merged.severity) ? merged.severity : 'info';
  merged.link_url = typeof merged.link_url === 'string' ? merged.link_url.trim() : '';
  merged.link_text = typeof merged.link_text === 'string' ? merged.link_text.trim() : '';
  merged.allow_during_seat_selection = Boolean(merged.allow_during_seat_selection);
  if (!merged.link_url || !merged.link_text) {
    merged.link_url = '';
    merged.link_text = '';
  }
  return merged;
};

const hasAnyModalOpen = () => {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
};

const popupVersionHash = (popup) => {
  const payload = [
    popup.enabled ? '1' : '0',
    popup.message || '',
    popup.severity || 'info',
    popup.link_text || '',
    popup.link_url || '',
  ].join('|');
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const dismissStorageKey = (popup) => `${POPUP_DISMISS_KEY_PREFIX}${popupVersionHash(popup)}`;

const isInCooldownWindow = (storageKey) => {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) return false;
    const dismissedAt = Number(rawValue);
    if (!Number.isFinite(dismissedAt) || dismissedAt <= 0) return false;
    return Date.now() - dismissedAt < POPUP_COOLDOWN_MS;
  } catch (err) {
    return false;
  }
};

export default function AnnouncementPopup() {
  const siteContent = useSiteContent();
  const popup = useMemo(() => normalizePopup(siteContent?.announcement_popup || {}), [siteContent]);
  const popupDismissKey = useMemo(() => dismissStorageKey(popup), [popup]);
  const [dismissed, setDismissed] = useState(false);
  const [isBlockedByModal, setIsBlockedByModal] = useState(() => hasAnyModalOpen());

  useEffect(() => {
    setDismissed(false);
  }, [popup.enabled, popup.message, popup.severity, popup.link_url, popup.link_text, popupDismissKey]);

  useLayoutEffect(() => {
    if (!popup.enabled) {
      setIsBlockedByModal(false);
      return undefined;
    }
    const updateModalState = () => {
      const nextState = hasAnyModalOpen();
      setIsBlockedByModal((prev) => (prev === nextState ? prev : nextState));
    };
    updateModalState();
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || !document.body) {
      return undefined;
    }
    const observer = new MutationObserver(() => {
      updateModalState();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal', 'aria-labelledby', 'class', 'style'],
    });
    return () => observer.disconnect();
  }, [popup.enabled]);

  const blockedByModalNow = popup.enabled && hasAnyModalOpen();

  if (!popup.enabled || !popup.message || dismissed || isInCooldownWindow(popupDismissKey) || isBlockedByModal || blockedByModalNow) {
    return null;
  }

  const dismissPopup = () => {
    setDismissed(true);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(popupDismissKey, String(Date.now()));
      } catch (err) {
        // Ignore storage failures and continue with in-memory dismissal.
      }
    }
  };

  const styleClass = SEVERITY_STYLES[popup.severity] || SEVERITY_STYLES.info;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      onClick={dismissPopup}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismissPopup();
        }
      }}
      role="presentation"
    >
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
      <div
        className={`relative z-10 w-full max-w-xl rounded-xl border shadow-2xl ${styleClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-4 sm:p-5 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm sm:text-base font-medium break-words [overflow-wrap:anywhere]">{popup.message}</p>
            {popup.link_url && popup.link_text && (
              <a
                href={popup.link_url}
                className="inline-block mt-2 text-sm font-semibold underline break-words [overflow-wrap:anywhere]"
              >
                {popup.link_text}
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={dismissPopup}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/15 hover:bg-black/25"
            aria-label="Dismiss announcement"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
