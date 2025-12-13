# Frontend - Midway Music Hall

React application with two modes: single-page landing and full application.

## Build & Run

**Single-Page Landing (Production):**
```bash
REACT_APP_SINGLE_PAGE=true npm run build
# Deploy build/ contents to web server
```

**Full Application (Development):**
```bash
npm install
npm start  # Opens http://localhost:3000
```

## Structure

- **`src/SinglePageLanding.js`** - Single-page public landing
- **`src/components/`** - Public components (seating, schedule, navigation)
- **`src/admin/`** - Admin panel modules (events, seating, requests, suggestions)
- **`src/pages/`** - Page components (HomePage, LoginPage)
- **`public/`** - Static assets (logo, favicons, manifest.json)

## Deployment Package

**File:** `midway-music-hall-deploy.zip` (2.9 MB)

Contains production build with:
- Optimized JS/CSS bundles
- Logo and comprehensive favicon suite
- PWA manifest
- robots.txt, 404.html
- Ready for cPanel upload

Copy `.htaccess-deployment` to `.htaccess` on server.

## Key Components

- **SeatingChart.js** - Interactive seating with seat selection/requests
- **Table6.js** - 6-seat table visual layout
- **EventsModule.js** - Admin event CRUD
- **RequestsModule.js** - Admin seat request approval/denial with conflict detection

## Configuration

- **API Base:** Configured in `App.js` via `API_BASE` constant
- **Environment Variable:** `REACT_APP_SINGLE_PAGE=true` switches to landing mode
- **Styling:** Tailwind CSS (see `tailwind.config.js`)

See `../DEVELOPER_GUIDE.md` for detailed component architecture.

