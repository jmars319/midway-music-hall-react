## Admin Authentication

Notes and operational guidance for admin authentication and session management.

- Default admin user credentials (local dev) and reset process
- Session expiration and renewal endpoints
- Troubleshooting SSO or cookie issues
# Admin Authentication Notes

## Overview
- Admin auth is cookie-backed. Successful `POST /api/login` requests set the `mmh_admin` PHP session (HttpOnly, `SameSite=Lax`).
- Each session enforces two timers:
  - **Hard expiration** (`ADMIN_SESSION_LIFETIME`, default 7 days).
  - **Idle timeout** (`ADMIN_SESSION_IDLE_TIMEOUT`, default 4 hours). Any keyboard/mouse/touch activity in the admin panel pings `POST /api/session/refresh` to keep the session warm.
- Frontend state mirrors the backend timers so users see a warning/logout when either limit is reached.

## Relevant endpoints
| Endpoint | Purpose |
| --- | --- |
| `POST /api/login` | Validates credentials and starts a session. Returns `{ user, session: { expires_at, idle_timeout_seconds } }`. |
| `GET /api/session` | Returns `{ authenticated, user?, session? }`. Used on app load to rehydrate a session. |
| `POST /api/session/refresh` | Resets the idle timer. Called automatically when the admin UI detects activity. |
| `POST /api/logout` | Destroys the server session and clears the cookie. |

> **Note:** All of the above expect `credentials: 'include'` on the frontend fetch call so the browser sends the session cookie.

## Configuration
Set the following in `backend/.env` (defaults shown):

```
ADMIN_SESSION_COOKIE=mmh_admin
ADMIN_SESSION_LIFETIME=604800          # seconds (7 days)
ADMIN_SESSION_IDLE_TIMEOUT=14400       # seconds (4 hours)
ADMIN_SESSION_COOKIE_SECURE=false      # set true in production HTTPS
CORS_ALLOW_ORIGIN=*                    # set an explicit origin when enabling credentials cross-origin
```

Adjusting these values updates both the server-side timers and the frontend (values are echoed back via `/api/login` + `/api/session`).

## Changing the display name
- The admin panel shows `user.display_name` when available.
- If the backend only has an email, it derives a friendly label (prefix before `@`). Addresses that start with `admin@` are automatically shown as “Admin”.

## Clearing/invalidating sessions
- Call `POST /api/logout` (triggered by the “Logout” button) to clear the cookie immediately.
- Sessions also invalidate server-side when the hard-expiration or idle windows pass—even if the browser tab stays open.
