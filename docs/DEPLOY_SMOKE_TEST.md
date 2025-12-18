# Midway Music Hall – Pre-Deployment Smoke Test

Run this checklist immediately after uploading the build and wiring the database. Steps are written for non-developers; only proceed to announcing the release when every box passes. Leave `SEND_EMAILS=false` during these checks—watch for `[email:skip]` entries instead of real sends.

---

1. **Homepage sanity**
   - Browse to `https://midwaymusichall.net`
   - Confirm hero, Upcoming Shows, Beach Series, Recurring, Lessons, Site Content, and footer render with no console errors.

2. **Deep links**
   - Load `https://midwaymusichall.net/thegatheringplace`, `/lessons`, `/recurring`, `/archive`, and verify routing works (thanks to `.htaccess` SPA fallback).

3. **Category badges + seating buttons**
   - On Upcoming cards, confirm Beach Bands / Lessons badges appear while Normal events do not show a badge.
   - Confirm recurring events do **not** display “Request Seats / RSVP” buttons; one-off events with seating still do.

4. **Seat request modal**
   - Open a non-recurring event with seating enabled.
   - Submit a test request using an obviously fake name (e.g., “Test – please ignore”) and your email.
   - Wait for the confirmation toast; make sure no real email is received.

5. **The Gathering Place venue**
   - Verify cards show the correct venue label and no RSVP button when the event is recurring-only.

6. **Admin login**
   - Visit `/admin`, log in, and verify the sidebar shows Events, Recurring Series (if enabled), Seat Requests, Site Content, Media, Categories, Audit Log, Settings, plus Back to Site / Change Password / Logout.

7. **Events module**
   - Filters default to “Upcoming / All Categories”.
   - Beach Bands and recurring series entries are visible.
   - Each row shows “Seat requests notify: …” with the correct inbox (based on event override → category override → default).

8. **Recurring series**
   - Expand a series, mark one date as “Skip this date”.
   - Confirm it disappears from the public Recurring page (refresh the site).
   - Re-enable the same date and confirm it returns.

9. **Seat Requests admin**
   - Locate the test request from step 4.
   - Confirm it shows the event/category information and notification inbox.
   - Approve or deny it; confirm `[email:skip]` is logged (no real email fires).
   - Delete the request afterwards.

10. **Categories admin**
    - Rename a non-system category (e.g., add “(test)” suffix), save, confirm Events dropdown updates, then rename back.
    - Optionally set a `seat_request_email_to` value and confirm the routing label updates.

11. **Site Content + footer**
    - Change one contact phone number or footer link, save, refresh the public site to see the update, then revert.

12. **Media uploads**
    - Upload a small image, confirm it appears in the grid, then delete it. (Verifies `api/uploads/` permissions.)

13. **Audit Log**
    - Open Audit Log, filter by today’s date, and confirm actions from steps 8–12 are captured with your user name.

14. **Password change + logout**
    - Use “Change Password” with a temporary value, confirm success, then change it back (or have IT reset).
    - Click “Logout”, refresh `/admin`, and confirm the login form returns.

15. **Robots / manifest / sitemap**
    - Visit `/robots.txt`, `/manifest.json`, and `/sitemap.xml` to ensure they load via HTTPS without redirects.

Document any failures, take screenshots if needed, and only flip `SEND_EMAILS=true` after staff explicitly wants to test real emails.
