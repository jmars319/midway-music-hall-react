# AI Assistance Instructions Consolidation (Legacy -> Current)

This doc consolidates the historical guidance from `copilot-instructions/` and reconciles it with the current codebase. The original AI-assistance drafts describe an early Node/Express architecture and old schema; they remain in `copilot-instructions/` for history but should not be treated as current implementation guidance.

## What changed since the Copilot drafts
- **Backend:** The site no longer uses Node/Express on port 5001. It now uses a PHP router in `backend/index.php` with Apache rewrites on shared hosting.
- **Database:** The schema evolved beyond the initial six-table draft. The current model includes recurrence, seating layout versions, media metadata, audit logging, and payment settings.
- **Frontend:** The public and admin components are still React, but the routing, data sources, and feature set expanded well beyond the early skeleton.

## Still useful from the Copilot docs (mapped to current files)
- **Component taxonomy:** The list of public/admin components is still a good map for AI-assisted navigation. Current sources live under:
  - Public: `frontend/src/components/*`
  - Admin: `frontend/src/admin/*`
  - Pages: `frontend/src/pages/*`
- **Design system ideas:** Dark UI with purple accents, soft borders, and large hero typography still define the visual language. These are implemented via Tailwind utilities in the current codebase.
- **Feature intent:** The original list (events, seating, suggestions, admin CRUD) is still core to the project, but the implementation now uses PHP APIs, recurrence-aware events, and a richer data model.

## Current equivalents for legacy items
- **API Base:** No longer `http://localhost:5001/api`. See `frontend/src/apiConfig.js` for API base resolution and environment handling.
- **Auth:** Not a demo-only login. Sessions are handled by `/api/login` and `/api/session` with secure cookies.
- **Seating:** Moved from a simple `seating_config` table to `seating_layouts` and `seating_layout_versions` for stable, versioned layouts.
- **Suggestions:** Contact fields are normalized in the backend; the admin UI expects flattened fields with fallback to JSON contact blobs.

## Design guidance retained (current usage)
- **Colors:** Purple is the primary brand accent; dark UI surfaces are the default for public and admin screens.
- **Layout:** Mobile-first grid layouts with bold headers and clear CTA hierarchy.
- **Interactive elements:** Cards, badges, and hover states are used heavily across event listings and admin tables.

## What to ignore from legacy docs
- Any Node/Express instructions, port references, or MySQL schema examples in `copilot-instructions/`.
- Any API paths that refer to the old Express routes; the PHP router in `backend/index.php` is canonical.

## Why keep this consolidation
- It preserves the original design intent and component naming without mixing legacy backend instructions into current work.
- It gives new contributors a single document to understand the evolution and avoid applying outdated port, schema, or backend assumptions.

For current, authoritative implementation details, use `docs/DEVELOPER_GUIDE.md` and `docs/SYSTEM_OVERVIEW.md`.
