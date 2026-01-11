# Public Site Overview

This document covers public-facing features, their implementation, and why they exist.

## Navigation + deep links
- **What:** Persistent navigation with anchor links and route-aware behavior.
- **How:** `frontend/src/components/Navigation.js` uses scroll targets and route-aware navigation to `/#section` anchors.
- **Why:** Guests need quick access to schedules, recurring content, and venue info.

## Hero + brand presentation
- **What:** High-impact hero with CTA and brand assets.
- **How:** `frontend/src/components/Hero.js`, `BrandImage.js`, and `useSiteContent.js` provide deterministic assets plus CMS copy fallback.
- **Why:** Establishes venue identity and drives primary actions.

## Featured + upcoming events
- **What:** Featured events and full upcoming schedule.
- **How:** `frontend/src/pages/HomePage.js` fetches `/api/public/events?timeframe=upcoming` and renders `Schedule.js`/`FeaturedEvents.js` with `ResponsiveImage.js`.
- **Why:** Core business function is promoting upcoming shows.

## Recurring events grid
- **What:** Recurring series cards with next occurrence and typical schedule.
- **How:** `HomePage.js` groups events with `series_master_id` and uses `event_series_meta` fields (`series_schedule_label`, `series_summary`, `series_footer_note`).
- **Why:** Reduces clutter and highlights recurring programming.

## Beach Bands series
- **What:** Dedicated section for the Beach Bands series.
- **How:** `HomePage.js` flags series by labels and category metadata for a distinct listing.
- **Why:** A strategic program with distinct marketing needs.

## Lessons / classes
- **What:** Classes/lessons section for non-show programming.
- **How:** `frontend/src/pages/HomePage.js` and data in `frontend/src/data/*` plus CMS settings.
- **Why:** Communicates offerings beyond live shows.

## The Gathering Place venue page
- **What:** Secondary venue page.
- **How:** `frontend/src/pages/GatheringPlacePage.js` uses shared components plus venue filtering.
- **Why:** The secondary venue has a distinct audience and brand.

## Archive page
- **What:** Past events listing.
- **How:** `frontend/src/pages/ArchivePage.js` requests `timeframe=past` and groups by month.
- **Why:** Marketing history and internal reference.

## Seating request modal
- **What:** Interactive seat selection for seating-enabled events.
- **How:** `EventSeatingModal.js` fetches `/api/seating/event/:eventId`, renders `SeatingChart.js`, and submits `POST /api/seat-requests`. Seat availability is enforced by `frontend/src/utils/seatAvailability.js` and backend conflict checks/transactions.
- **Why:** Paid reservations without double-booking.
### Mobile seat-selection mode
- **What:** A mobile-first layout that guarantees a usable seating map viewport and always-visible primary actions.
- **How:** `EventSeatingModal.js` enables mobile mode when seat selection is active and `(max-width: 640px)` or coarse pointer conditions match; it clamps the map viewport height and constrains the action bar with internal scroll. Event details are collapsed by default behind a toggle with `aria-expanded`.
- **Why:** Large accessibility font sizes on mobile must not obscure the map or action buttons.

## Payment links in seat requests
- **What:** Payment CTA and fine print for eligible events.
- **How:** `EventSeatingModal.js` renders payment details from `payment_option` and category-level payment settings.
- **Why:** Consistent payment flow without per-event manual setup.

## Artist suggestion form
- **What:** Artist/fan submission form.
- **How:** `frontend/src/components/ArtistSuggestion.js` posts to `/api/suggestions` with normalized contact fields.
- **Why:** Generates booking leads and community engagement.

## Site content + contact info
- **What:** Editable contact details, hero copy, and footer links.
- **How:** `useSiteContent.js` loads `/api/site-content` or `/api/settings`; data lives in `business_settings`.
- **Why:** Staff can update content without code changes.

## Legal pages (privacy/terms)
- **What:** Privacy policy and terms of service routes.
- **How:** `frontend/src/pages/PrivacyPolicy.js` and `frontend/src/pages/TermsOfService.js`.
- **Why:** Compliance and trust for public forms.

## Accessibility, SEO, and PWA
- **What:** Skip link, focus indicators, structured metadata, robots/sitemap, manifest.
- **How:** `frontend/src/index.css` for skip/focus; `frontend/public/robots.txt`, `sitemap.xml`, `manifest.json`, and JSON-LD in `index.html`.
- **Why:** Discoverability, accessibility compliance, and mobile UX.
