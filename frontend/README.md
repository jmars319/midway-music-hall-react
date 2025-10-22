Frontend — Midway Music Hall (React)

What's here
- `src/` — main React source files (components, admin modules, pages)
- `public/` — static public assets
- `package.json` — dependencies and scripts

Running locally
1. cd frontend
2. npm install
3. npm start

Developer notes
- The seating UI lives in `src/components/SeatingChart.js` and `src/components/Table6.js`.
- Admin UIs are under `src/admin/` (SeatingModule, RequestsModule, etc.).
- API base URL is configured in `src/App.js` via `API_BASE`.
- Visual styles use Tailwind CSS — see `tailwind.config.js` and `postcss.config.js`.

Testing interactions
- The frontend fetches pending seat-requests and marks seats as pending.
- Selecting seats and submitting creates a seat-request which an admin can later approve.

