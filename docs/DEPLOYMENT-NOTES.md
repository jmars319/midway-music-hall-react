## Deployment Notes

Key steps to deploy the frontend and php-backend:

- Build the frontend: `npm run build` in `frontend/`
- Copy `frontend/build` into the server's public directory (for local dev we use `php-backend/admin`)
- Run DB migrations and verify schema changes
- Restart backend and frontend dev servers
# Deployment & Rollback Notes (GoDaddy / cPanel)

## Folder map
| Repo path | Target |
| --- | --- |
| `frontend/build` | Upload contents to the public web root (e.g., `/public_html` or the relevant subdomain folder). |
| `php-backend` | Upload to the API directory (e.g., `/public_html/api` or `/home/.../api`). Only overwrite PHP source files, not `uploads/` or `.env`. |

## Do **not** overwrite
- `php-backend/uploads/` – contains user-uploaded media. Copy new files in but never delete the folder.
- `php-backend/.env` – keeps environment secrets and DB credentials.
- Any generated backups/zip files on the server (keep for rollback).

## Deploy flow (minimal downtime)
1. Build the React app: `cd frontend && npm run build`.
2. Upload `frontend/build/*` to the static host. Consider uploading to a staging folder, then swap symlinks or rename folders to avoid partial file states.
3. Upload changed PHP files (`php-backend/*.php`, `php-backend/lib/*`, etc.). Skip `uploads/` and `.env`.
4. Clear any PHP opcache if present (via cPanel or `touch php-backend/index.php`).
5. Run the regression checklist (see `docs/REGRESSION-CHECKLIST.md`).

## Rollback plan
1. Keep a timestamped backup zip of both `frontend/build` and `php-backend` before deploying (e.g., `midway-deploy-YYYYMMDD-HHMM.zip`).
2. If deployment fails, restore by:
   - Replacing the web root contents with the previous `build` backup.
   - Restoring the previous `php-backend` folder from the backup zip.
   - Confirm `.env` and `uploads/` remain untouched.
3. Verify via the regression checklist before reopening access.
