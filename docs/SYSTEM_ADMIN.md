# Admin Console Overview

This document covers admin-facing features, their implementation, and why they exist.

## Authentication + session handling
- **What:** Login and session enforcement with idle timeout.
- **How:** `/api/login`, `/api/session`, `/api/session/refresh`, `/api/logout` in `backend/index.php`; UI in `LoginPage.js` and `AdminPanel.js`.
- **Why:** Secure staff-only access with automatic session expiry.

## Dashboard + audit log
- **What:** Summary stats and recent activity.
- **How:** `DashboardModule.js` uses `/api/dashboard-stats` and `/api/audit-log`.
- **Why:** Operators need quick health signals and accountability.

## Events CRUD + series metadata
- **What:** Create/edit/publish events and recurring series masters.
- **How:** `EventsModule.js` uses `/api/events` and recurrence endpoints; series metadata stored in `event_series_meta`.
- **Why:** Core content management for public listings.

## Categories + seat request routing
- **What:** Configure event categories and email routing.
- **How:** `CategoriesModule.js` manages `event_categories`; backend uses category and event overrides to determine seat-request recipients.
- **Why:** Ensures seat requests go to the correct staff inbox.

## Seating layouts + versions
- **What:** Manage reusable seating templates and versions.
- **How:** `LayoutsModule.js` and `/api/seating-layouts*`; backend snapshots versions into `seating_layout_versions` when applied to events.
- **Why:** Events must have stable seating maps even if templates change later.

## Seating editor (legacy/editor)
- **What:** Direct row-by-row seating editor.
- **How:** `SeatingModule.js` and `/api/seating` endpoints.
- **Why:** Provides low-level control and quick fixes.

## Seat requests workflow
- **What:** Review, approve, deny, and restore reservations.
- **How:** `SeatRequestsModule.js` and `RequestsModule.js` use `/api/seat-requests` and approval/denial endpoints; backend enforces transactional conflict detection.
- **Why:** Prevents double-booking and provides staff control.

## Media library + responsive images
- **What:** Upload, categorize, and manage images with variant generation.
- **How:** `MediaManager.js` and `/api/media`; backend generates optimized/WebP variants via `backend/lib/ImageUtils.php`; frontend uses `ResponsiveImage.js` and `imageVariants.js`.
- **Why:** Ensures consistent, fast imagery while keeping staff in control.

## Site content + settings
- **What:** Update CMS-like content and contact details.
- **How:** `SiteContentModule.js` and `SettingsModule.js` write to `business_settings`.
- **Why:** Allows staff edits without deployments.

## Payment settings
- **What:** Manage payment URLs and seat limits per category.
- **How:** `PaymentSettingsModule.js` and `payment_settings` table; events reference active settings at render time.
- **Why:** Centralized, consistent payment handling for seat requests.

## Admin users
- **What:** Manage admin users and credentials.
- **How:** `AdminUsersModule.js` and `admins` table.
- **Why:** Central access control and accountability.
