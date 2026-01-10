# Accepted PageSpeed Tradeoffs (Intentional)

Midway Music Hall intentionally prioritizes correctness, accessibility, and real-world UX over chasing perfect PageSpeed Insights numbers. PSI is diagnostic guidance—not a success criterion. Each item below is locked-in policy and should only be revisited through a deliberate decision, not reactive optimization.

## Tradeoffs

1. **Image compression warnings**
   - Applies to every raster: event art, logos, admin previews, hero backgrounds, marketing graphics, UI chrome.
   - We ship high-fidelity assets, prefer WebP where available, and enforce responsive sizing, but we do **not** degrade imagery just to silence PSI nags.
   - *Why we accept this:* visual clarity + branding consistency directly drive bookings and accessibility; marginal byte savings are not worth blurry art.

2. **Cloudflare Email Address Obfuscation**
   - Cloudflare’s email-protection script remains **disabled** to avoid render-blocking injections that can break mobile rendering.
   - *Why we accept this:* stability and predictable rendering are more important than the minor spam reduction benefit.

3. **Social / crawler compatibility over bandwidth policing**
   - Hotlink protection remains OFF; OG/Twitter/Discord/Facebook bots must fetch our preview images without friction.
   - *Why we accept this:* reliable rich embeds boost discoverability and trust—breaking them to “save bandwidth” would harm the venue.

4. **Third-party scripts**
   - External JS is already minimal and deferred (e.g., Maps load after interaction). We will not cripple UX or admin tooling purely to raise PSI.
   - *Why we accept this:* staff productivity and guest clarity matter more than synthetic scores.

5. **CDN / edge behavior**
   - Cloudflare cache rules never override server-side correctness or content freshness.
   - *Why we accept this:* debugging always fixes reality first; PSI comes second.

## Do not chase these blindly

- PSI image compression nags once WebP + sane sizing are in place.
- Minor render-blocking messages tied to Cloudflare security/email features.
- Synthetic lab scores that fight accessibility guidelines, trusted branding, or UX clarity.

## Operational checklist

- When PSI regresses, inspect recent changes: third-party injections, legacy bundles reintroduced, oversized uploads, or Cloudflare setting drift.
- If a PSI recommendation conflicts with correctness, accessibility, UX clarity, or image fidelity, ignore it unless leadership explicitly reopens the decision.

These tradeoffs are intentional, documented, and stable for MMH. Revisiting any item requires a deliberate, planned discussion—not a knee-jerk reaction to a PSI score.
