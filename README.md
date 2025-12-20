# Midway Music Hall

React-based website for Midway Music Hall featuring a public landing page and full admin system for event management, seating charts, and artist suggestions.

## Quick Start

### Full Application (Development)
```bash
# Backend (Terminal 1)
cp backend/.env.example backend/.env    # update DB credentials
php -S localhost:8080 -t backend

# Frontend (Terminal 2)
cd frontend
npm install
npm start
```

## Project Structure

- **`frontend/`** - React application with Tailwind CSS
  - Full application with admin panel
  - Production build: `frontend/build/`
  - Deployment package: `frontend/midway-music-hall-deploy.zip`
  - Legacy single-page landing preserved in `frontend/archive/SinglePageLanding.js` for reference only

- **`backend/`** - PHP API server
  - Event management endpoints
  - Seating chart system
  - Artist suggestion handling
  - MySQL database integration

- **`database/`** - SQL schema and migration scripts

- **`copilot-instructions/`** - Development documentation

## Deployment

See **`DEPLOYMENT_GUIDE.md`** for the authoritative GoDaddy/Cloudflare steps (includes `/api` backend layout, DB import, and smoke tests).

**Quick Deploy (summary – still read the guide):**
1. `cd frontend && npm run build`
2. Upload the **contents** of `frontend/build/` into `public_html/midwaymusichall.net/`
3. Copy the repo `backend/` folder to `public_html/midwaymusichall.net/api/`
4. Upload the root `.htaccess` into `public_html/midwaymusichall.net/.htaccess`
5. Create/update `api/.env` (keep `SEND_EMAILS=false` until production testing)
6. Create/import the database using `database/20250320_full_seed_nodb.sql`
7. Configure Cloudflare DNS + SSL (Full mode) and run `DEPLOY_SMOKE_TEST.md`

## Features

**Public Landing Page:**
- Upcoming events calendar
- Ongoing activities (Friday dances, car cruise-ins)
- Beach Bands 2026 schedule
- Venue information and contact details
- Embedded Google Maps
- Professional logo and comprehensive favicon suite
- PWA support (installable on mobile devices)

**Admin Panel:**
- Event CRUD operations
- Interactive seating chart editor
- Seat request management
- Artist suggestion review
- Dashboard analytics

## Technology Stack

- **Frontend:** React 18.2.0, Tailwind CSS 3.4.7
- **Backend:** PHP 8.1+, custom router + GD-powered media pipeline
- **Database:** MySQL
- **Build:** Create React App
- **Server:** Apache with .htaccess configuration
- **SSL:** Cloudflare (Free plan)

## Security

- 0 npm vulnerabilities (using package overrides)
- WCAG accessibility compliant
- Security headers configured
- Gzip compression enabled
- Browser caching optimized

- Do not commit secrets. Use `backend/.env` for local environment values.
- `node_modules/` and logs are ignored by `.gitignore`.
- After major changes, run `git gc` at a convenient time to keep the local repo tidy.

If you want me to add CI (GitHub Actions) or deployment scripts, say so and I will scaffold them.
