# Midway Music Hall PHP Backend

This directory contains the canonical PHP implementation of the Midway Music Hall API.

## Requirements
- PHP 8.1+
- MySQL 5.7+/MariaDB 10+
- Extensions: `pdo_mysql`, `fileinfo`

## Environment
Copy `.env.example` to `.env` and provide your MySQL credentials:

```
APP_ENV=development
APP_DEBUG=true
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=midway_music_hall
DB_USER=root
DB_PASSWORD=
UPLOAD_DIR=uploads
LAYOUT_HISTORY_MAX=200
LAYOUT_HISTORY_RETENTION_DAYS=90
```

Values fall back to sensible defaults when omitted. `UPLOAD_DIR` is relative to this directory and defaults to `uploads/`.

## Local development
1. Start the PHP built-in web server:
   ```bash
   php -S localhost:8080 -t backend
   ```
2. Visit `http://localhost:8080/index.php/api/health` (or configure your web server to rewrite all `/api/*` paths to `index.php`).

For Apache/nginx deployments, set the document root to this folder and forward all API requests to `index.php`. Static uploads are served from `backend/uploads/` and can be exposed directly via web server configuration.

## Notes
- Every public/admin endpoint is served from `index.php`.
- Responses, validation, and error codes track the React app contract.
- The backend operates against the MySQL schema under `database/`.

## Data migration helper
Use `php scripts/migrate_events.php` to replace placeholder events with the authoritative single-page data. Run once per environment (pass `--force` only when you intend to re-import). The script backs up the existing `events` table and generates recurring series + override metadata automatically.
