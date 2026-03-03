import React, { useEffect, useMemo, useState } from 'react';
import useSiteContent from '../hooks/useSiteContent';

const DEFAULT_BANNER = {
  enabled: false,
  message: '',
  label: '',
  link_url: '',
  link_text: '',
  severity: 'info',
};

const SEVERITY_STYLES = {
  info: {
    container: 'bg-sky-600/20 text-sky-100 border-sky-500/40',
    label: 'bg-sky-200/20 text-sky-100',
    link: 'text-sky-100 underline',
  },
  warning: {
    container: 'bg-amber-500/20 text-amber-100 border-amber-400/40',
    label: 'bg-amber-200/20 text-amber-100',
    link: 'text-amber-100 underline',
  },
  urgent: {
    container: 'bg-red-600/20 text-red-100 border-red-500/40',
    label: 'bg-red-200/20 text-red-100',
    link: 'text-red-100 underline',
  },
};

const normalizeBanner = (raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_BANNER, ...source };
  merged.enabled = Boolean(merged.enabled);
  merged.message = typeof merged.message === 'string' ? merged.message.trim() : '';
  merged.label = typeof merged.label === 'string' ? merged.label.trim() : '';
  merged.link_url = typeof merged.link_url === 'string' ? merged.link_url.trim() : '';
  merged.link_text = typeof merged.link_text === 'string' ? merged.link_text.trim() : '';
  merged.severity = ['info', 'warning', 'urgent'].includes(merged.severity) ? merged.severity : 'info';
  return merged;
};

export default function ReservationBanner() {
  const siteContent = useSiteContent();
  const banner = normalizeBanner(siteContent?.reservation_banner || {});
  const [expanded, setExpanded] = useState(false);
  const isVisible = banner.enabled && Boolean(banner.message);
  const messageLength = banner.message.length;
  const canExpand = messageLength > 180;
  const collapsedPreview = useMemo(() => {
    if (!canExpand) return banner.message;
    return `${banner.message.slice(0, 180).trimEnd()}...`;
  }, [banner.message, canExpand]);
  const messageText = expanded ? banner.message : collapsedPreview;
  const styles = SEVERITY_STYLES[banner.severity] || SEVERITY_STYLES.info;
  const hasLink = banner.link_url && banner.link_text;
  const messageClampClass = expanded
    ? 'max-h-24 sm:max-h-32'
    : 'max-h-14 sm:max-h-20';

  useEffect(() => {
    setExpanded(false);
  }, [banner.message, banner.label, banner.link_url, banner.link_text, banner.severity]);

  if (!isVisible) {
    return null;
  }

  return (
    <section className="px-6 py-2 sm:py-3 border-b border-purple-500/20 shrink-0 sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm reservation-banner-shell" aria-live="polite">
      <div className={`rounded-lg border px-4 py-3 ${styles.container}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className={`flex flex-col gap-2 sm:flex-row sm:items-center overflow-y-auto pr-1 min-w-0 ${messageClampClass}`}>
            {banner.label && (
              <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded ${styles.label}`}>
                {banner.label}
              </span>
            )}
            <p className="text-sm break-words [overflow-wrap:anywhere]">{messageText}</p>
          </div>
          {hasLink && (
            <a href={banner.link_url} className={`text-sm font-semibold break-words [overflow-wrap:anywhere] sm:max-w-[45%] ${styles.link}`}>
              {banner.link_text}
            </a>
          )}
        </div>
        {canExpand && (
          <button
            type="button"
            className="mt-2 text-xs font-semibold underline decoration-dotted text-white/90 hover:text-white"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </section>
  );
}
