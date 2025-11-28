# Midway Music Hall - Single Page Deployment Guide
**GoDaddy cPanel + Cloudflare SSL**

## 📦 Pre-Deployment Checklist

✅ Production build created: `frontend/build/` (51.74 kB JS + 6.29 kB CSS gzipped)  
✅ Deployment package: `frontend/midway-music-hall-deploy.zip` (352 KB)  
✅ .htaccess file: `frontend/.htaccess-deployment`  
✅ Zero npm vulnerabilities confirmed  
✅ All features included:
   - December 2025 events
   - Beach Bands 2026 lineup (7 shows)
   - Ongoing/recurring events
   - Accessibility features (WCAG compliant)
   - SEO optimizations
   - Clickable phone/email links
✅ Ready for production deployment  

---

## 🌐 Part 1: Cloudflare Setup (DNS & SSL)

### Step 1.1: Add Your Domain to Cloudflare

1. **Sign up/Log in** to [Cloudflare](https://dash.cloudflare.com/)
2. Click **"Add a Site"**
3. Enter your domain (e.g., `midwaymusichosting.com`)
4. Select **Free Plan** → Click **Continue**
5. Cloudflare will scan your existing DNS records → Click **Continue**

### Step 1.2: Update Nameservers at GoDaddy

1. **Log in to GoDaddy** → Go to **My Products** → **Domains**
2. Click on your domain → **Manage DNS**
3. Scroll to **Nameservers** section → Click **Change**
4. Select **"I'll use my own nameservers"**
5. **Replace GoDaddy nameservers** with Cloudflare's (shown in Cloudflare dashboard):
   ```
   Example:
   alex.ns.cloudflare.com
   kate.ns.cloudflare.com
   ```
6. Click **Save**
7. **⏱️ Wait 2-24 hours** for nameserver propagation (usually 15-30 minutes)

### Step 1.3: Configure Cloudflare DNS

Back in **Cloudflare Dashboard** → **DNS** → **Records**:

#### Add/Verify These DNS Records:

| Type  | Name | Content                | Proxy Status | TTL  |
|-------|------|------------------------|--------------|------|
| A     | @    | Your GoDaddy Server IP | Proxied 🟠   | Auto |
| A     | www  | Your GoDaddy Server IP | Proxied 🟠   | Auto |

**To find your GoDaddy Server IP:**
- GoDaddy cPanel → Right sidebar → **Server Information** → note the **Shared IP Address**

**Important:** Ensure **Proxy status is ON (orange cloud icon)** for SSL to work!

### Step 1.4: Enable Cloudflare SSL

1. **Cloudflare Dashboard** → **SSL/TLS** tab
2. **Set SSL/TLS encryption mode** to: **Full** or **Full (Strict)**
   - ⚠️ NOT "Flexible" (causes redirect loops)
3. Scroll down → Enable **Always Use HTTPS** toggle
4. Go to **Edge Certificates** (left sidebar)
   - Enable: **Always Use HTTPS** ✅
   - Enable: **Automatic HTTPS Rewrites** ✅
   - Enable: **Opportunistic Encryption** ✅

### Step 1.5: Optimize Cloudflare Settings (Recommended)

**Speed Tab:**
- **Auto Minify**: Enable CSS, JavaScript, HTML ✅
- **Brotli**: Enable ✅
- **Rocket Loader**: OFF (can break React) ⚠️

**Caching Tab:**
- **Caching Level**: Standard
- **Browser Cache TTL**: Respect Existing Headers

**Security Tab:**
- **Security Level**: Medium
- **Bot Fight Mode**: ON (Free plan feature)

---

## 🖥️ Part 2: GoDaddy cPanel Deployment

### Step 2.1: Access cPanel

1. **Log in to GoDaddy** → **My Products** → **Web Hosting**
2. Click **Manage** next to your hosting account
3. Click **cPanel Admin** button

### Step 2.2: Upload Site Files

#### Option A: File Manager (Recommended for First Deploy)

1. In cPanel, click **File Manager**
2. Navigate to **`public_html`** directory
3. **Delete default files** (if this is a new site):
   - Select all files → Click **Delete** → Confirm
   - ⚠️ **Do NOT delete** `.htaccess` if one exists (back it up first)

4. **Upload the deployment package:**
   - Click **Upload** button (top right)
   - Drag `midway-music-hall-deploy.zip` to the upload area
   - Wait for upload to complete (green checkmark)
   - Close upload window

5. **Extract the ZIP file:**
   - Back in File Manager, right-click `midway-music-hall-deploy.zip`
   - Select **Extract**
   - Confirm extraction to current directory
   - Click **Close** when done
   - Delete the ZIP file (right-click → Delete)

6. **Upload .htaccess file:**
   - Click **Upload** button
   - Upload the `.htaccess-deployment` file
   - After upload, **rename** it to `.htaccess` (right-click → Rename)

#### Option B: FTP (Alternative Method)

1. In cPanel → **FTP Accounts** → Create FTP account
2. Use an FTP client (FileZilla, Cyberduck, etc.)
3. Connect to your server using FTP credentials
4. Upload all files from `build/` folder to `public_html/`
5. Upload `.htaccess-deployment` as `.htaccess`

### Step 2.3: Set File Permissions

1. In **File Manager** → Select **`public_html`** folder
2. Right-click → **Change Permissions**
3. Set permissions:
   - **Folders**: 755 (rwxr-xr-x)
   - **Files**: 644 (rw-r--r--)
4. Check **"Recurse into subdirectories"**
5. Click **Change Permissions**

### Step 2.4: Verify .htaccess is Active

1. In **File Manager**, verify `.htaccess` exists in `public_html/`
2. **If you don't see `.htaccess`:**
   - Top right → **Settings** → Check **"Show Hidden Files (dotfiles)"** ✅
   - Click **Save**

---

## 🔍 Part 3: Testing & Verification

### Step 3.1: Test Your Site

1. **Open your domain in a browser**: `https://yourdomain.com`
2. **Check for green padlock** 🔒 in address bar (SSL active)
2. **Verify all sections load:**
   - Upcoming Events (should be first)
     - December 2025 events visible
     - Closed - Holidays showing "Dec 21"
   - Ongoing / Classes section
     - Friday Night Dance
     - Zeno Marshall's Thunder Road Cruise In
     - TRBG Classic Car Cruise In
   - Beach Bands 2026 section
     - All 7 bands listed chronologically (Jan-Nov 2026)
   - About section with clickable contact links
   - Location map (Google Maps iframe)
   
### Step 3.2: Test Accessibility Features

1. **Press Tab key** on page load → Skip link should appear
2. **Click phone numbers** → Should prompt to call
3. **Click email addresses** → Should open email client
4. **Test mobile responsiveness** → Resize browser or use mobile device

### Step 3.3: Check SSL Certificate

1. Click the **padlock icon** in browser address bar
2. Verify certificate issued by **Cloudflare**
3. Ensure connection is **secure/encrypted**

### Step 3.4: Test HTTPS Redirect

1. Visit `http://yourdomain.com` (HTTP, not HTTPS)
2. Should **automatically redirect** to `https://yourdomain.com`
3. If not redirecting, check Cloudflare SSL settings (Step 1.4)

### Step 3.5: Performance Check (Optional)

Run these tools to verify optimization:
- **Google PageSpeed Insights**: https://pagespeed.web.dev/
- **GTmetrix**: https://gtmetrix.com/
- **SSL Labs**: https://www.ssllabs.com/ssltest/

**Expected Scores:**
- Performance: 90+ (mobile), 95+ (desktop)
- Accessibility: 100
- SEO: 95+
- SSL Grade: A or A+

---

## 🐛 Troubleshooting

### Issue: "Too Many Redirects" Error

**Cause:** SSL/TLS encryption mode is "Flexible" in Cloudflare  
**Fix:** Change to "Full" or "Full (Strict)" in Cloudflare → SSL/TLS tab

### Issue: Site Not Loading / DNS Not Resolving

**Cause:** Nameservers haven't propagated yet  
**Fix:** Wait up to 24 hours. Check status at: https://www.whatsmydns.net/

### Issue: CSS/JavaScript Not Loading

**Cause 1:** File permissions incorrect  
**Fix:** Set folders to 755, files to 644 (Step 2.3)

**Cause 2:** .htaccess file missing/incorrect  
**Fix:** Re-upload .htaccess file from deployment package

### Issue: Map Not Showing

**Cause:** Iframe blocked by security headers  
**Fix:** Verify .htaccess doesn't have overly strict CSP headers

### Issue: Contact Links Not Clickable

**Cause:** JavaScript didn't load properly  
**Fix:** Clear browser cache, verify `main.[hash].js` loaded in Network tab

### Issue: Site Shows "Index of /" Directory Listing

**Cause:** `index.html` not in correct location  
**Fix:** Ensure `index.html` is directly in `public_html/` (not in a subfolder)

---

## 🔄 Future Updates

### To Update Site Content:

1. **Edit JSON files locally:**
   - `frontend/src/data/events.json` (add/remove events)
   - `frontend/src/data/contacts.json` (update contacts)
   - `frontend/src/data/policies.json` (update policies)

2. **Rebuild production bundle:**
   ```bash
   cd frontend
   REACT_APP_SINGLE_PAGE=true npm run build
   ```

3. **Re-deploy:**
   - Create new ZIP from `build/` folder
   - Upload to cPanel File Manager
   - Extract and overwrite files
   - **Clear Cloudflare cache** (Dashboard → Caching → Purge Everything)

### Quick Event Update Workflow:

```bash
# 1. Edit events
code frontend/src/data/events.json

# 2. Rebuild
cd frontend && REACT_APP_SINGLE_PAGE=true npm run build

# 3. Create deployment package
cd build && zip -r ../midway-update-$(date +%Y%m%d).zip .

# 4. Upload via cPanel and extract
```

---

## 📊 Performance Optimization Tips

### Enable Cloudflare Features:

1. **APO (Automatic Platform Optimization)** - Paid feature ($5/month)
   - Caches HTML at edge
   - Significant speed boost

2. **Argo Smart Routing** - Paid feature
   - Optimizes network routing
   - Reduces latency

3. **Polish (Image Optimization)** - Pro plan
   - Compresses images
   - WebP conversion

### GoDaddy cPanel Optimizations:

1. **Enable OPcache** (if using PHP features in future)
   - cPanel → Software → Select PHP Version → Enable OPcache

2. **Check Server Resources**
   - cPanel → Metrics → CPU and Concurrent Connection Usage
   - Upgrade hosting if consistently hitting limits

---

## ✅ Post-Deployment Checklist

- [ ] Site loads at `https://yourdomain.com` with SSL padlock 🔒
- [ ] HTTP redirects to HTTPS automatically
- [ ] **Upcoming Events section** displays first (priority content)
  - [ ] December 2025 events showing correctly
  - [ ] Closed - Holidays displays with date "Dec 21"
- [ ] **Ongoing / Classes section** visible
  - [ ] Friday Night Dance (6pm-10pm)
  - [ ] Zeno Marshall's Thunder Road (2nd Sunday, 2pm-5pm)
  - [ ] TRBG Classic Car Cruise In (Thursday, 4pm-9pm)
- [ ] **Beach Bands 2026 section** showing all 7 bands
  - [ ] THE EMBERS (Jan 25, 2026) through BAND OF OZ (Nov 15, 2026)
  - [ ] Dates formatted correctly with full year
- [ ] **About section** with clickable contacts
  - [ ] Phone numbers clickable (tel: links)
  - [ ] Email addresses clickable (mailto: links)
- [ ] **Location section**
  - [ ] Google Maps iframe loads correctly
  - [ ] Address displays properly
- [ ] **Accessibility features work**
  - [ ] Skip navigation link appears on Tab key press
  - [ ] All interactive elements have focus indicators
- [ ] Mobile responsive layout verified (test on phone/tablet)
- [ ] Page loads in under 3 seconds
- [ ] No console errors in browser DevTools (F12)

---

## 📞 Support Contacts

**Cloudflare Support:**
- Free Plan: Community Forum - https://community.cloudflare.com/
- Paid Plans: 24/7 ticket support

**GoDaddy Support:**
- Phone: 480-505-8877
- Chat: Available in account dashboard
- Help: https://www.godaddy.com/help

**Developer (for this project):**
- GitHub: https://github.com/jmars319/midway-music-hall-react

---

## 🎉 Deployment Complete!

Your single-page landing site is now live with:
- ✅ Cloudflare SSL (HTTPS)
- ✅ Global CDN (fast worldwide)
- ✅ DDoS protection
- ✅ Optimized caching
- ✅ Accessibility features
- ✅ Mobile responsive
- ✅ SEO optimized

**Site Files:** `frontend/midway-music-hall-deploy.zip`  
**Build Command:** `REACT_APP_SINGLE_PAGE=true npm run build`  
**Deploy Time:** Approximately 15-30 minutes (including DNS propagation)
