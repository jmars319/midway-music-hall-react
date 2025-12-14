# Deployment Guide - Quick Reference

> **Legacy note:** These steps describe the earlier static-only deployment. The live project now uses the `/api` backend plus the root `.htaccess`. Always consult `DEPLOYMENT_GUIDE.md` for the authoritative process; this file remains for historical reference.

Single-page landing deployment to GoDaddy cPanel with Cloudflare SSL.

## Prerequisites

- GoDaddy hosting account with cPanel access
- Cloudflare account (Free plan)
- Domain name

## Quick Deploy (3 Steps)

### 1. Cloudflare Setup (DNS & SSL)

**Add Domain:**
- Login to [Cloudflare](https://dash.cloudflare.com/) → Add Site
- Select Free plan
- Copy Cloudflare nameservers (e.g., `alex.ns.cloudflare.com`)

**Update GoDaddy DNS:**
- GoDaddy → Domains → Manage DNS → Nameservers → Change
- Enter Cloudflare nameservers → Save
- Wait 15-30 minutes for propagation

**Configure SSL:**
- Cloudflare → SSL/TLS → Set to **Full** (not Flexible)
- Enable **Always Use HTTPS**
- Add DNS records (A records for @ and www pointing to GoDaddy server IP)
- Ensure proxy status: **Proxied** (orange cloud)

### 2. Build & Package

```bash
cd frontend
REACT_APP_SINGLE_PAGE=true npm run build
# Creates: frontend/midway-music-hall-deploy.zip (2.9 MB)
```

### 3. cPanel Upload

**Via File Manager:**
1. cPanel → File Manager → Navigate to `public_html/`
2. Delete default files (backup existing `.htaccess` if present)
3. Upload `midway-music-hall-deploy.zip`
4. Right-click → Extract → Delete ZIP
5. Upload `frontend/.htaccess-deployment` and rename to `.htaccess`
6. Set permissions: Folders 755, Files 644 (recursive)

**Verify:**
- Visit `https://yourdomain.com`
- Check SSL padlock appears
- Test HTTP redirects to HTTPS
- Verify all sections load

## File Structure on Server

```
public_html/
├── .htaccess (from .htaccess-deployment)
├── index.html
├── favicon.ico
├── favicon-16x16.png
├── favicon-32x32.png
├── apple-touch-icon.png
├── android-chrome-192x192.png
├── android-chrome-512x512.png
├── logo.png
├── og-image.png
├── manifest.json
├── robots.txt
├── 404.html
└── static/
    ├── css/
    │   └── main.[hash].css
    └── js/
        └── main.[hash].js
```

## Troubleshooting

**Too Many Redirects:**
- Cloudflare SSL mode → Change to "Full" (not "Flexible")

**CSS/JS Not Loading:**
- Check file permissions (755 folders, 644 files)
- Verify `.htaccess` exists in `public_html/`

**DNS Not Resolving:**
- Wait up to 24 hours for propagation
- Check: https://www.whatsmydns.net/

**Site Shows Directory Listing:**
- Ensure `index.html` is in root of `public_html/` (not subfolder)

## Update Workflow

```bash
# 1. Edit content
code frontend/src/data/events.json

# 2. Rebuild
cd frontend && REACT_APP_SINGLE_PAGE=true npm run build

# 3. Package
cd build && zip -r ../deploy-$(date +%Y%m%d).zip .

# 4. Upload to cPanel and extract
# 5. Clear Cloudflare cache: Dashboard → Caching → Purge Everything
```

## Performance Expectations

- **Load Time:** < 3 seconds
- **PageSpeed:** 90+ (mobile), 95+ (desktop)
- **SSL Grade:** A or A+
- **Bundle Size:** 51.8 kB JS + 6.3 kB CSS (gzipped)

## Key Features Included

✅ December 2025 events  
✅ Beach Bands 2026 (7 shows)  
✅ Ongoing activities (3 recurring events)  
✅ Professional logo & comprehensive favicons  
✅ PWA support (installable)  
✅ WCAG accessibility compliant  
✅ SEO optimized  
✅ Clickable phone/email links  
✅ Responsive design  

---

**Full Documentation:** See `DEPLOYMENT_GUIDE.md` for detailed step-by-step instructions.  
**Package Location:** `frontend/midway-music-hall-deploy.zip`  
**Build Command:** `REACT_APP_SINGLE_PAGE=true npm run build`
