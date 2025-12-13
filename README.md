# Midway Music Hall

React-based website for Midway Music Hall featuring a public landing page and full admin system for event management, seating charts, and artist suggestions.

## Quick Start

### Single-Page Landing (Production)
```bash
cd frontend
REACT_APP_SINGLE_PAGE=true npm run build
# Deploy contents of build/ folder to web server
```

### Full Application (Development)
```bash
# Backend (Terminal 1)
cd backend
npm install
# Configure backend/.env with database credentials
npm run dev

# Frontend (Terminal 2)
cd frontend
npm install
npm start
```

## Project Structure

- **`frontend/`** - React application with Tailwind CSS
  - Single-page landing mode (env: `REACT_APP_SINGLE_PAGE=true`)
  - Full application with admin panel
  - Production build: `frontend/build/`
  - Deployment package: `frontend/midway-music-hall-deploy.zip`

- **`backend/`** - Node.js/Express API server
  - Event management endpoints
  - Seating chart system
  - Artist suggestion handling
  - MySQL database integration

- **`database/`** - SQL schema and migration scripts

- **`copilot-instructions/`** - Development documentation

## Deployment

See **`DEPLOYMENT_GUIDE.md`** for complete cPanel/Cloudflare deployment instructions.

**Quick Deploy:**
1. Build: `cd frontend && REACT_APP_SINGLE_PAGE=true npm run build`
2. Extract: `frontend/midway-music-hall-deploy.zip` (2.9 MB)
3. Upload to cPanel `public_html/` directory
4. Copy `frontend/.htaccess-deployment` to `public_html/.htaccess`
5. Configure Cloudflare SSL (Free plan)

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
- **Backend:** Node.js, Express
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
