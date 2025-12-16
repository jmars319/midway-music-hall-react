import React from 'react';
import './index.css';
import ResponsiveImage from './components/ResponsiveImage';
import useSiteContent from './hooks/useSiteContent';
import { getBrandImages } from './utils/brandAssets';
import eventsData from './data/events.json';
import contactsData from './data/contacts.json';
import policiesData from './data/policies.json';

function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatShortDate(d) {
  if (!d) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SinglePageLanding() {
  const siteContent = useSiteContent();
  const { logoUrl } = getBrandImages(siteContent);

  // derive map query from policies (Venue Address) or environment
  const venueAddress = (
    policiesData.find((p) => p.category && p.category.toLowerCase().includes('venue address')) ||
    policiesData.find((p) => p.category && p.category.toLowerCase().includes('location details'))
  )?.details;
  const mapQuery = process.env.REACT_APP_MAP_QUERY || venueAddress || 'Midway Music Hall';

  // events: split into upcoming (with parsable future dates) and ongoing/classes
  const today = new Date();
  const parsed = eventsData.map((e) => ({
    ...e,
    _parsedDate: parseDateSafe(e.date),
  }));

  const upcoming = parsed
    .filter((e) => e._parsedDate && e._parsedDate >= today) // Only show current and future events
    .filter((e) => !(e.event_type && String(e.event_type).toLowerCase().includes('closure')))
    .sort((a, b) => a._parsedDate - b._parsedDate)
    .slice(0, 12);

  const ongoing = parsed.filter((e) => !e._parsedDate || /ongoing|daily/i.test(String(e.date)) || /related business/i.test(String(e.event_type)));

  // Separate instructors from other contacts
  const instructors = contactsData.filter(c => c.contact_type === 'Instructor');
  const otherContacts = contactsData.filter(c => c.contact_type !== 'Instructor');

  // policies map for quick lookup
  const policiesMap = policiesData.reduce((acc, p) => {
    acc[p.category] = p.details;
    return acc;
  }, {});

  // Dynamic copyright year
  const currentYear = new Date().getFullYear();

  // Helper to format phone numbers as tel: links
  const formatPhoneLink = (phone) => {
    if (!phone || phone === 'N/A') return phone;
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.length >= 10 ? `tel:+1${cleaned}` : null;
  };

  // Helper to format email links
  const formatEmailLink = (email) => {
    if (!email || email === 'N/A' || email.toLowerCase().includes('facebook')) return null;
    return `mailto:${email}`;
  };

  // Beach Bands 2026 events
  const beachBands2026 = [
    { name: 'THE EMBERS', date: '2026-01-25' },
    { name: 'SPECIAL OCCASION BAND', date: '2026-02-15' },
    { name: 'GARY LOWDER AND SMOKIN HOT', date: '2026-03-15' },
    { name: 'THE ENTERTAINERS', date: '2026-04-19' },
    { name: 'THE CATALINAS', date: '2026-05-03' },
    { name: 'JIM QUICK AND COASTLINE', date: '2026-09-20' },
    { name: 'TOO MUCH SYLVIA', date: '2026-10-18' },
    { name: 'BAND OF OZ', date: '2026-11-15' },
  ].map((e) => ({
    ...e,
    _parsedDate: parseDateSafe(e.date),
  })).sort((a, b) => a._parsedDate - b._parsedDate);

  // Helper to format full date (Month Day, Year)
  const formatFullDate = (d) => {
    if (!d) return '';
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="single-page-root">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="bg-gradient-to-br from-purple-900 via-gray-900 to-blue-900 text-white relative overflow-hidden py-16" role="banner">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <ResponsiveImage 
            src={logoUrl} 
            alt="Midway Music Hall Logo" 
            width={320}
            height={192}
            priority
            className="mx-auto h-40 md:h-48 w-auto mb-4 object-contain"
            sizes="(max-width: 640px) 240px, 320px"
          />
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            Midway Music Hall
          </h1>
          <p className="mt-4 text-lg text-gray-200">Live music · good times.</p>
        </div>
      </header>

      <div className="temp-notice bg-yellow-100 text-yellow-900 text-center py-3">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <strong>Temporary Landing Page:</strong> This is a temporary single-page placeholder while we prepare the full site. Information below is abbreviated and intended for quick public display only.
        </div>
      </div>

      <main id="main-content" className="sp-main" role="main" aria-label="Venue information and events">
        <section className="sp-section sp-schedule bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/20" aria-labelledby="events-heading">
          <h2 id="events-heading">Upcoming Events</h2>
          {upcoming.length === 0 ? (
            <p>No upcoming dated events found.</p>
          ) : (
            <ul className="sp-schedule-list">
              {upcoming.map((item, idx) => (
                <li key={idx} className="sp-schedule-item">
                  <time className="sp-schedule-date" dateTime={item.date}>{formatShortDate(item._parsedDate)}</time>
                  <div className="sp-schedule-info">
                    <strong className="sp-schedule-name">{item.name}</strong>
                    {item.time ? <span className="sp-schedule-time">{` (${item.time})`}</span> : null}
                    {item.location && item.location !== 'Main Hall' ? <span className="sp-schedule-location">{` - ${item.location}`}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {ongoing.length > 0 && (
            <>
              <h3 id="ongoing-heading">Ongoing / Classes</h3>
              <ul className="sp-ongoing-list">
                {ongoing.map((o, i) => (
                  <li key={i} className="sp-ongoing-item">
                      <div><strong>{o.name}</strong></div>
                      <div className="sp-ongoing-meta">
                        {o.day_of_week ? <span>{o.day_of_week} · </span> : null}
                        {o.time}
                        {o.location && o.location !== 'Main Hall' ? <span> · {o.location}</span> : null}
                      </div>
                    </li>
                ))}
              </ul>
            </>
          )}

          {beachBands2026.length > 0 && (
            <>
              <h3 id="beach-bands-2026-heading" className="text-2xl font-bold text-purple-400 mt-8 mb-4 border-b-2 border-purple-400/30 pb-2">Beach Bands 2026</h3>
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-300">
                  <strong>Important:</strong> Thunder Road Bar & Grill is closed on Sundays, except for the small bar which is open for beer and wine only. No outside beverages are allowed.
                </p>
                <p className="text-sm text-gray-300 mt-2">
                  <strong>Beach Show Amenities:</strong> Concession stand with hot dogs and BBQ available at beach shows and winter cruise-ins. Adult beverages also available.
                </p>
              </div>
              <ul className="sp-schedule-list sp-beach-bands-list">
                {beachBands2026.map((band, idx) => (
                  <li key={idx} className="sp-schedule-item">
                    <time className="sp-schedule-date" dateTime={band.date}>{formatShortDate(band._parsedDate)}</time>
                    <div className="sp-schedule-info">
                      <strong className="sp-schedule-name">{band.name}</strong>
                      <span className="sp-schedule-time">{` (${formatFullDate(band._parsedDate)})`}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="sp-section sp-about bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/20">
          <h2>About</h2>
          <p>{policiesMap['Location Details'] || 'Community-focused venue presenting local and touring artists.'}</p>

          <dl className="sp-about-details">
            {policiesMap['Venue Address'] && (
              <>
                <dt>Address</dt>
                <dd>{policiesMap['Venue Address']}</dd>
              </>
            )}
            {policiesMap['Family Policy'] && (
              <>
                <dt>Family Policy</dt>
                <dd>{policiesMap['Family Policy']}</dd>
              </>
            )}
            {policiesMap['Refund Policy'] && (
              <>
                <dt>Refunds</dt>
                <dd>{policiesMap['Refund Policy']}</dd>
              </>
            )}
          </dl>

          <h3>Contacts</h3>
          <ul className="sp-contacts">
            {otherContacts.map((c, i) => {
              const phoneLink = formatPhoneLink(c.phone);
              const emailLink = formatEmailLink(c.email);
              return (
                <li key={i} className="sp-contact-item">
                  <div className="sp-contact-top"><strong>{c.name}</strong>{c.role ? <span className="sp-contact-role"> · {c.role}</span> : null}</div>
                  <div className="sp-contact-meta">
                    {phoneLink ? <a href={phoneLink} className="sp-contact-link">{c.phone}</a> : c.phone}
                    {c.email && (
                      <span>
                        {' · '}
                        {emailLink ? <a href={emailLink} className="sp-contact-link">{c.email}</a> : c.email}
                      </span>
                    )}
                  </div>
                  {c.notes ? <div className="sp-contact-notes">{c.notes}</div> : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="sp-section sp-classes bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/20" aria-labelledby="classes-heading">
          <h2 id="classes-heading">Weekly Classes & Lessons</h2>
          <ul className="sp-classes-list">
            {instructors.map((instructor, i) => {
              const phoneLink = formatPhoneLink(instructor.phone);
              return (
                <li key={i} className="sp-class-item">
                  <div className="sp-class-header">
                    <strong className="sp-class-name">{instructor.class_name || instructor.role}</strong>
                  </div>
                  <div className="sp-class-details">
                    {instructor.class_time && <div className="sp-class-time">📅 {instructor.class_time}</div>}
                    {instructor.class_price && <div className="sp-class-price">💵 {instructor.class_price}</div>}
                    <div className="sp-class-instructor">
                      <strong>Instructor:</strong> {instructor.name}
                      {phoneLink && (
                        <span> · <a href={phoneLink} className="sp-contact-link">{instructor.phone}</a></span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="sp-section sp-location bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-purple-500/20" aria-labelledby="location-heading">
          <h2 id="location-heading">Location</h2>
          <div className="sp-map-wrapper">
            <iframe
              title="Google Maps showing Midway Music Hall location"
              width="100%"
              height="300"
              loading="lazy"
              style={{ border: 0 }}
              sandbox="allow-scripts allow-same-origin"
              allow="geolocation"
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
            />
          </div>
          <address className="sp-address" style={{ fontStyle: 'normal' }}>{policiesMap['Venue Address'] || process.env.REACT_APP_LOCATION_TEXT || mapQuery}</address>
        </section>
      </main>

      <footer className="sp-footer" role="contentinfo">
        <small>© {currentYear} Midway Music Hall. All rights reserved.</small>
      </footer>
    </div>
  );
}

export default SinglePageLanding;
