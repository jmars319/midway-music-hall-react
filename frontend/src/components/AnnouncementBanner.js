import React from 'react';
import useSiteContent from '../hooks/useSiteContent';

const DEFAULT_BANNER = {
  enabled: false,
  message: '',
  label: '',
  link_url: '',
  link_text: '',
  severity: 'info',
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

const SEVERITY_STYLES = {
  info: {
    container: 'bg-sky-600 text-white border-sky-700',
    label: 'bg-white/15 text-white',
    link: 'text-white underline',
  },
  warning: {
    container: 'bg-amber-400 text-slate-900 border-amber-500',
    label: 'bg-black/10 text-slate-900',
    link: 'text-slate-900 underline',
  },
  urgent: {
    container: 'bg-red-600 text-white border-red-700',
    label: 'bg-white/15 text-white',
    link: 'text-white underline',
  },
};

export default function AnnouncementBanner({ className = '' }) {
  const siteContent = useSiteContent();
  const banner = normalizeBanner(siteContent?.announcement || {});
  if (!banner.enabled || !banner.message) {
    return null;
  }
  const styles = SEVERITY_STYLES[banner.severity] || SEVERITY_STYLES.info;
  const hasLink = banner.link_url && banner.link_text;

  return (
    <section className={className} aria-live="polite">
      <div className={`border-b ${styles.container}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {banner.label && (
              <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded ${styles.label}`}>
                {banner.label}
              </span>
            )}
            <p className="text-sm font-medium">{banner.message}</p>
          </div>
          {hasLink && (
            <a href={banner.link_url} className={`text-sm font-semibold ${styles.link}`}>
              {banner.link_text}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
