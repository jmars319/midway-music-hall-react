Backend - Midway Music Hall

What's here
- `server.js` - Express server with API endpoints for events, seating, seat requests, layout history, suggestions, and settings.
- `package.json` - Node dependencies and scripts.
- `.env` - Environment variables (not checked into git).

Running locally
1. Copy `.env.example` to `.env` and update the DB connection settings.
2. Install packages: `npm install`
3. Start server: `npm run dev` (or `node server.js`)

Important notes
- The backend uses a MySQL database. Schema is in `database/schema.sql`.
- `backend/.env` is ignored and must be created locally.
- Sensitive files (logs, node_modules) are ignored via `.gitignore`.

API highlights
- `GET /api/health` - simple health check
- `GET/POST/PATCH /api/seating` - manage seating rows and per-seat reservations
- `POST /api/seat-requests` - submit a seat request
- `POST /api/seat-requests/:id/approve` - admin approve; server checks for conflicts and marks seats reserved
- `GET /api/layout-history` - list layout snapshots

