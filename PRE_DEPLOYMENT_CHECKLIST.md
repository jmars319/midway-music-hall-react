# Pre-Deployment Checklist

## Files to Upload to GoDaddy cPanel

### ✅ Required Files (in midway-music-hall-deploy.zip)
- [ ] index.html
- [ ] asset-manifest.json
- [ ] static/css/ folder with CSS files
- [ ] static/js/ folder with JS files
- [ ] robots.txt (for SEO)
- [ ] favicon.svg or favicon.ico
- [ ] 404.html (optional error page)

### ✅ .htaccess Configuration
- [ ] Upload `.htaccess-deployment` file
- [ ] Rename to `.htaccess` in cPanel
- [ ] Verify file permissions: 644

### ✅ Cloudflare SSL Setup
- [ ] Domain added to Cloudflare
- [ ] Nameservers updated at GoDaddy
- [ ] DNS records configured (A records for @ and www)
- [ ] SSL/TLS mode set to "Full" (NOT Flexible)
- [ ] "Always Use HTTPS" enabled
- [ ] Auto Minify enabled (CSS, JS, HTML)

### ✅ GoDaddy cPanel Configuration
- [ ] Files uploaded to `public_html/` directory
- [ ] Old files removed/backed up
- [ ] Folder permissions: 755
- [ ] File permissions: 644
- [ ] .htaccess is active and readable

### ✅ Testing Checklist
- [ ] Site loads with HTTPS (green padlock)
- [ ] HTTP redirects to HTTPS
- [ ] All sections visible:
  - [ ] Upcoming Events (Dec 2025)
  - [ ] Ongoing/Classes
  - [ ] Beach Bands 2026
  - [ ] About with contacts
  - [ ] Location map
- [ ] Phone links work (tel:)
- [ ] Email links work (mailto:)
- [ ] Skip navigation works (Tab key)
- [ ] Mobile responsive
- [ ] Page loads under 3 seconds
- [ ] No console errors

### ✅ Performance Verification
- [ ] Run Google PageSpeed Insights
- [ ] Check SSL Labs (should be A or A+)
- [ ] Verify Cloudflare caching active
- [ ] Test from mobile device

### ✅ DNS Propagation
- [ ] Check whatsmydns.net for nameserver propagation
- [ ] Wait 2-24 hours if needed (usually 15-30 minutes)
- [ ] Clear browser cache and test

## Missing Something?

If the site doesn't load properly:

1. **Check .htaccess**: Ensure it's named correctly (not .htaccess.txt)
2. **Check Cloudflare SSL**: Must be "Full" not "Flexible"
3. **Check file permissions**: 755 for folders, 644 for files
4. **Check DNS**: Verify A records point to correct IP
5. **Clear cache**: Cloudflare cache + browser cache

## Quick Deploy Command

To rebuild and create fresh deployment package:

```bash
cd frontend
REACT_APP_SINGLE_PAGE=true npm run build
cd build
zip -r ../midway-music-hall-deploy.zip .
cd ..
```

## Support

- Cloudflare: https://community.cloudflare.com/
- GoDaddy: 480-505-8877
- GitHub Repo: https://github.com/jmars319/midway-music-hall-react
