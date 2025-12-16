import { buildImageVariant, prefixAssetUrl } from './imageVariants';

const resolveVariantEntry = (value, fallback) => buildImageVariant(value, fallback);

export const getBrandImages = (siteContent, fallbacks = {}) => {
  const fallbackLogo = fallbacks.logo || '/logo.png';
  const fallbackMark = fallbacks.mark || '/apple-touch-icon.png';
  const fallbackDefault = fallbacks.defaultEvent || '/android-chrome-192x192.png';
  const branding = siteContent?.branding || {};

  const logoVariant = resolveVariantEntry(branding.logo, fallbackLogo);
  const markVariant = resolveVariantEntry(branding.mark, fallbackMark);
  const defaultEventVariant = resolveVariantEntry(branding.default_event, fallbackDefault);

  return {
    logoUrl: logoVariant.src || prefixAssetUrl(fallbackLogo),
    markUrl: markVariant.src || prefixAssetUrl(fallbackMark),
    defaultEventUrl: defaultEventVariant.src || prefixAssetUrl(fallbackDefault),
    logoVariant,
    markVariant,
    defaultEventVariant,
  };
};

export const resolveBrandImageUrl = (entry, fallback) => resolveVariantEntry(entry, fallback).src || prefixAssetUrl(fallback);
