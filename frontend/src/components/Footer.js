import React from 'react';
// Footer: small presentational component rendered at bottom of site
import { MapPin, Phone, Mail, Facebook, Instagram, Twitter } from 'lucide-react';
import useSiteContent from '../hooks/useSiteContent';
import { formatPhoneHref, CONTACT_LINK_CLASSES } from '../utils/contactLinks';

const scrollToSection = (id) => {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export default function Footer({ onAdminClick, onNavigate }){
  const siteContent = useSiteContent();
  const business = siteContent.business || {};
  const primaryContact = (siteContent.contacts || [])[0];
  const boxOfficeNote = siteContent.box_office_note || 'Seat reservations are request-only with a 24-hour hold window.';
  const social = siteContent.social || {};
  const reviewLink = (siteContent.review && siteContent.review.google_review_url) || '';

  const businessPhoneHref = formatPhoneHref(business.phone || '336-793-4218');
  const primaryPhoneHref = formatPhoneHref(primaryContact?.phone);
  const quickLinkButtonClasses = 'text-sm text-gray-200 underline decoration-purple-400/60 decoration-2 underline-offset-4 text-left inline-flex items-center justify-start rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300 px-2 py-2 min-h-[40px] hover:text-white transition w-full';

  return (
    <footer className="bg-gray-900 border-t border-purple-500/15 text-gray-200 mt-12" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">Site footer</h2>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-white font-bold mb-3">{business.name || 'Midway Music Hall'}</h3>
            <div className="text-sm text-gray-200 space-y-3">
              <div className="flex items-center gap-2 text-left text-gray-200">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                <span>{business.address || '11141 Old US Hwy 52, Winston-Salem, NC 27107'}</span>
              </div>
              <div>
                {businessPhoneHref ? (
                  <a
                    href={businessPhoneHref}
                    className={CONTACT_LINK_CLASSES}
                    aria-label={`Call ${business.name || 'Midway Music Hall'} at ${business.phone || '336-793-4218'}`}
                  >
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    {business.phone || '336-793-4218'}
                  </a>
                ) : (
                  <div className="flex items-center gap-2 text-gray-300">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    <span>{business.phone || '336-793-4218'}</span>
                  </div>
                )}
              </div>
              <a
                href={`mailto:${business.email || 'midwayeventcenter@gmail.com'}`}
                className={CONTACT_LINK_CLASSES}
                aria-label={`Email ${business.name || 'Midway Music Hall'} at ${business.email || 'midwayeventcenter@gmail.com'}`}
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                {business.email || 'midwayeventcenter@gmail.com'}
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-white font-bold mb-3">Quick Links</h3>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-1 lg:grid-cols-2">
              <button type="button" onClick={() => scrollToSection('schedule')} className={quickLinkButtonClasses}>Schedule</button>
              <button type="button" onClick={() => scrollToSection('recurring-events')} className={quickLinkButtonClasses}>Recurring</button>
              <button type="button" onClick={() => scrollToSection('lessons')} className={quickLinkButtonClasses}>Lessons</button>
              <button type="button" onClick={() => scrollToSection('beach-series')} className={quickLinkButtonClasses}>Beach Series</button>
              <a href="/thegatheringplace" className={quickLinkButtonClasses}>The Gathering Place</a>
              <button type="button" onClick={() => onNavigate && onNavigate('archive')} className={quickLinkButtonClasses}>Past Events Archive</button>
              <button type="button" onClick={() => onNavigate && onNavigate('privacy')} className={quickLinkButtonClasses}>Privacy Policy</button>
              <button type="button" onClick={() => onNavigate && onNavigate('terms')} className={quickLinkButtonClasses}>Terms of Service</button>
            </div>
          </div>

          <div>
            <h3 className="text-white font-bold mb-3">Box Office & Reservations</h3>
            <div className="text-sm text-gray-200 space-y-3">
              <p>{boxOfficeNote}</p>
              {primaryContact && (
                <div className="flex flex-col gap-3">
                  <span className="text-gray-100 font-semibold">{primaryContact.name}{primaryContact.title ? ` · ${primaryContact.title}` : ''}</span>
                  {primaryContact.phone && primaryPhoneHref && (
                    <a
                      href={primaryPhoneHref}
                      className={CONTACT_LINK_CLASSES}
                      aria-label={`Call ${primaryContact.name || 'box office'} at ${primaryContact.phone}`}
                    >
                      {primaryContact.phone}
                    </a>
                  )}
                  {primaryContact.email && (
                    <a
                      href={`mailto:${primaryContact.email}`}
                      className={CONTACT_LINK_CLASSES}
                      aria-label={`Email ${primaryContact.name || 'box office'} at ${primaryContact.email}`}
                    >
                      {primaryContact.email}
                    </a>
                  )}
                </div>
              )}
              <p className="text-sm text-gray-200">
                Voicemail is monitored daily. Leave your name, party size, and event date for the quickest callback.
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-white font-bold mb-3">Follow Us</h3>
            <div className="flex items-center gap-3">
              <a
                href={social.facebook || 'https://www.facebook.com/midwaymusichall'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center bg-gray-800 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400"
                aria-label="Midway Music Hall on Facebook (opens in new tab)"
              >
                <Facebook className="h-5 w-5" aria-hidden="true" />
              </a>
              <a
                href={social.instagram || 'https://www.instagram.com/midwaymusichall'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center bg-gray-800 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400"
                aria-label="Midway Music Hall on Instagram (opens in new tab)"
              >
                <Instagram className="h-5 w-5" aria-hidden="true" />
              </a>
              <a
                href={social.twitter || 'https://twitter.com/midwaymusichall'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 w-11 items-center justify-center bg-gray-800 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400"
                aria-label="Midway Music Hall on Twitter (opens in new tab)"
              >
                <Twitter className="h-5 w-5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-gray-700 pt-6 text-center text-sm text-gray-200 flex flex-col md:flex-row items-center justify-between gap-4">
          <span>© {new Date().getFullYear()} Midway Music Hall - All rights reserved.</span>
          <div className="flex items-center gap-4 text-sm text-gray-200 flex-wrap justify-center">
            {reviewLink && (
              <a href={reviewLink} target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 underline decoration-purple-400/50 transition">
                Leave a Google review
              </a>
            )}
            {onAdminClick && (
              <button type="button" onClick={onAdminClick} className="hover:text-purple-300 underline decoration-purple-400/50 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300 rounded">
                Admin Login
              </button>
            )}
            <a href="https://www.jamarq.digital" target="_blank" rel="noopener noreferrer" className="hover:text-purple-300 underline decoration-purple-400/50 transition">
              Powered by JAMARQ
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
