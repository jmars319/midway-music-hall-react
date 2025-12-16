import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import useSiteContent from '../hooks/useSiteContent';

const ensureMapPreconnect = () => {
  if (typeof document === 'undefined') return;
  const targets = ['https://maps.google.com', 'https://maps.gstatic.com'];
  targets.forEach((href) => {
    if (document.querySelector(`link[data-map-preconnect="${href}"]`)) {
      return;
    }
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.setAttribute('data-map-preconnect', href);
    document.head.appendChild(link);
  });
};

export default function MapSection() {
  const siteContent = useSiteContent();
  const map = siteContent.map || {};
  const reviewUrl = (siteContent.review && siteContent.review.google_review_url) || '';
  const hasReviewLink = Boolean(reviewUrl && reviewUrl.trim());
  const [shouldLoadMap, setShouldLoadMap] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const containerRef = useRef(null);
  const mapUrl = useMemo(
    () =>
      map.embed_url ||
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3274.058364949036!2d-80.22422352346647!3d35.99506067241762!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8853e93a2da3c6f3%3A0x7fe2bff7e76bc3ab!2s11141%20Old%20U.S.%2052%2C%20Winston-Salem%2C%20NC%2027107!5e0!3m2!1sen!2sus!4v1734046800!5m2!1sen!2sus',
    [map.embed_url]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isDesktop || shouldLoadMap) return undefined;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldLoadMap(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoadMap(true);
        observer.disconnect();
      }
    }, { rootMargin: '0px 0px 200px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isDesktop, shouldLoadMap]);

  useEffect(() => {
    if (!shouldLoadMap) return;
    ensureMapPreconnect();
  }, [shouldLoadMap]);

  return (
    <section className="py-12 bg-gray-900 border-t border-b border-gray-800" id="map">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <p className="text-sm uppercase tracking-widest text-purple-300">Visit</p>
            <h2 className="text-3xl font-bold text-white mt-1">Find Midway Music Hall</h2>
            <p className="text-gray-200 mt-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-purple-300" aria-hidden="true" />
              {map.address_label || '11141 Old U.S. Hwy 52, Winston-Salem, NC 27107'}
            </p>
            {map.subtext && <p className="text-gray-300 mt-1 text-sm">{map.subtext}</p>}
          </div>
        </div>

        <div
          ref={containerRef}
          className="rounded-3xl overflow-hidden border border-purple-500/20 shadow-lg aspect-video"
        >
          {shouldLoadMap ? (
            <iframe
              title="Midway Music Hall map"
              src={mapUrl}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col items-center justify-center text-center px-6 gap-4">
              <p className="text-sm text-gray-200 max-w-md">
                Load the interactive map when you need it. This keeps the mobile experience fast and battery-friendly.
              </p>
              <button
                type="button"
                onClick={() => setShouldLoadMap(true)}
                className="inline-flex items-center justify-center rounded-full bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
                aria-label="Load interactive map"
              >
                Tap to load map
              </button>
              <p className="text-xs text-gray-400">
                {map.address_label || '11141 Old U.S. Hwy 52, Winston-Salem, NC 27107'}
              </p>
            </div>
          )}
        </div>

        {hasReviewLink && (
          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-gray-800/70 border border-purple-500/20 rounded-2xl p-5 shadow">
            <p className="text-sm text-gray-200">Have you visited us recently? Leave a Google review and let others know about your experience.</p>
            <a
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-5 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300"
            >
              Leave a Google Review
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
