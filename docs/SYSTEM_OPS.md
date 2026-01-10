# Operations + Infrastructure Overview

This document covers deployment, hosting, data model rationale, and operational safeguards.

## Architecture (why this stack)
- **Frontend:** React SPA in `frontend/` (public + admin UI).
- **Backend:** PHP router in `backend/index.php`, compatible with GoDaddy shared hosting.
- **Database:** MySQL schema + seeds in `database/`.
- **Hosting:** GoDaddy + Cloudflare (SSL, DNS, caching).

## Data model highlights (why the schema looks this way)
- **events**: Source of public schedule, seating enablement, and recurrence links.
- **event_categories**: Categorization and seat-request routing.
- **event_series_meta**: Series-level display text for recurring cards.
- **event_recurrence_rules / event_recurrence_exceptions**: Recurrence engine and skips.
- **seating_layouts / seating_layout_versions**: Template + frozen versions per event.
- **seat_requests**: Reservation workflow and conflict enforcement.
- **media**: Upload metadata and responsive variants.
- **business_settings**: CMS-like content store.
- **audit_log**: Traceability for admin actions.

## Performance and reliability
- **Caching:** `.htaccess` sets long-lived cache headers for static assets and disables caching on manifest/robots/sitemap.
- **Image optimization:** WebP and optimized variants reduce load time and prevent 404s.
- **Seat reservation locking:** Backend transactions prevent double-booking; conflicts return 409.
- **Email safety:** `SEND_EMAILS=false` gates live emails during testing.

## Security and safeguards
- **Uploads hardening:** `backend/uploads/.htaccess` blocks execution and directory listing.
- **Session cookies:** HttpOnly + secure cookie flags in production.
- **Deployment guardrails:** Zips exclude `.env` and uploads; Cloudflare SSL in Full/Strict mode.

## Deployment workflows
- **Canonical guide:** `docs/DEPLOYMENT_GUIDE.md`.
- **Packages:** `scripts/make-deploy-zips.sh` and `scripts/check-deploy-zips.sh` enforce bundle correctness.
- **Database migrations:** Canonical SQL files in `database/` are applied manually via phpMyAdmin.

## Monitoring and troubleshooting
- **Audit log:** `/api/audit-log` for admin actions.
- **Health check:** `/api/health` for API reachability.
- **Image audit:** `backend/scripts/check_image_variants.php`.
