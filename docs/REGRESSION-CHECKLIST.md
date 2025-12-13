## Regression Checklist

Steps to verify after deployments and code changes:

- Run automated test suite (if available)
- Smoke the public homepage, archive, and admin panels
- Verify seat request lifecycle (new → contacted → waiting → confirmed)
- Verify media uploads and image optimization
- Confirm timezone-sensitive displays (event times)
# Regression Smoke Test Checklist

Use this list before and after deployments to confirm the core MMH flows still work. Steps assume the PHP API and React bundle are running on the same origin (production or local).

## Quick scripts

1. `cd frontend && npm run build` – ensures the React bundle compiles without errors.
2. (Optional) `npm test` if you need to run the default CRA test runner.

## Public site checks

1. **Home (`/`)**
   - Load the page and confirm the hero, featured events, and the schedule grid render populated data.
   - Scroll to the “Schedule” section and confirm every card is a future show (anything that ended earlier today should already be hidden).
2. **Recurring section**
   - Scroll (or use the nav) to “Recurring Events”.
   - Confirm the cards render without console errors and that each card’s CTA link/jump target works.
3. **Gathering Place (`/thegatheringplace`)**
   - Load the page directly and via the navbar link.
   - Use every navbar button (Schedule, Recurring, Lessons, etc.) while on this route – they should either scroll to in-page sections or navigate back to `/#section-id`.
4. **Seat request CTA & archive**
   - Find an event with `seating_enabled` + a saved layout and open its detail modal. Confirm the “Seat Request” CTA renders.
   - Open a non-seating event and confirm the CTA does **not** appear.

## Public forms

1. **Seat request flow**
   - Pick a seating-enabled event, submit a seat request selecting explicit seats, and confirm the success state appears.
   - Attempt the same on a non-seating event – confirm the UI blocks submission or the API rejects it gracefully.
2. **Artist suggestion / contact forms**
   - Submit the artist suggestion form with valid data and confirm the thank-you state (or API success) appears.
   - Verify the general contact info links (`tel:`, `mailto:`) still open their respective apps.

## Admin panel

1. **Authentication**
   - Login with `admin` / `admin123`.
   - Confirm “Signed in as …” shows a clean display name (e.g., “Admin”).
   - Leave the panel idle for >4h (or adjust clock) and verify the idle timeout message logs you out. Also confirm logout clears the session and returns to the login screen.
2. **Events**
   - Create a draft event, publish it, and then archive it. Verify each state change is reflected in the Events module buckets.
   - Edit an existing recurrence rule and confirm exceptions still save.
3. **Seating**
   - Assign a seating layout to an event and ensure the seating chart selector persists the change.
   - Submit a seat request (see public step) and confirm it appears in the Seat Requests module. Update its status through Hold → Pending → Finalized and confirm timestamps update.
4. **Media manager**

5. **Archive page (`/archive`)**
   - Ensure past events load with month grouping and pagination.
   - Download an ICS file from any listing and open it in a calendar app.
   - Upload one JPG and one PNG, ensure thumbnails render (fallback kicks in if needed), and confirm the optimized/WebP metadata displays. Delete the uploads afterward if desired.

Document any failures (with screenshots/logs) before promoting a build.
