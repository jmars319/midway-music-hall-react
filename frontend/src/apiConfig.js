const resolveDefaultApiBase = () => {
  if (process.env.REACT_APP_API_BASE) {
    return process.env.REACT_APP_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location) {
    const { origin, protocol, hostname } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (origin && origin !== 'null' && protocol !== 'file:' && !isLocalHost) {
      return `${origin.replace(/\/$/, '')}/api`;
    }
  }
  return 'http://localhost:5001/api';
};

const normalizeApiBase = (value) => {
  if (!value) return '/api';
  return value.replace(/\/+$/, '');
};

const defaultApiBase = normalizeApiBase(resolveDefaultApiBase());

export const API_BASE = defaultApiBase;

const resolvedServer = defaultApiBase.endsWith('/api')
  ? defaultApiBase.slice(0, -4) || ''
  : defaultApiBase;

export const SERVER_BASE = resolvedServer || (typeof window !== 'undefined' && window.location && window.location.origin !== 'null'
  ? window.location.origin
  : '');

const BRAND_FALLBACKS = {
  logo: '/logo.png',
  mark: '/apple-touch-icon.png',
  defaultEvent: '/android-chrome-192x192.png',
};

const isAbsoluteUrl = (value = '') => /^https?:\/\//i.test(value) || value.startsWith('//') || value.startsWith('data:');

export const prefixUploadsUrl = (value) => {
  if (!value) return null;
  if (isAbsoluteUrl(value)) return value;
  if (value.startsWith('/')) return `${SERVER_BASE}${value}`;
  return value;
};

const selectBrandingVariant = (entry) => entry?.webp || entry?.optimized || entry?.original || entry?.file_url || null;

let brandingCache = null;
let brandingFetchPromise = null;

export const primeBrandingCache = (branding) => {
  brandingCache = branding || null;
};

const fetchBrandingData = async () => {
  if (brandingCache) {
    return brandingCache;
  }
  if (!brandingFetchPromise) {
    brandingFetchPromise = fetch(`${API_BASE}/site-content`)
      .then((res) => res.json())
      .then((data) => data?.content?.branding || null)
      .catch(() => null)
      .then((branding) => {
        brandingCache = branding;
        return brandingCache;
      })
      .finally(() => {
        brandingFetchPromise = null;
      });
  }
  return brandingFetchPromise;
};

export const invalidateBrandingCache = () => {
  brandingCache = null;
  brandingFetchPromise = null;
};

const resolveDefaultEventImage = async () => {
  const branding = await fetchBrandingData();
  const preferred = selectBrandingVariant(branding?.default_event);
  return prefixUploadsUrl(preferred) || BRAND_FALLBACKS.defaultEvent;
};

const resolveDefaultEventImageSync = () => {
  if (!brandingCache) {
    return BRAND_FALLBACKS.defaultEvent;
  }
  const preferred = selectBrandingVariant(brandingCache?.default_event);
  return prefixUploadsUrl(preferred) || BRAND_FALLBACKS.defaultEvent;
};

export const getImageUrl = async (imageUrl) => {
  if (!imageUrl) {
    return resolveDefaultEventImage();
  }
  if (isAbsoluteUrl(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('/')) return `${SERVER_BASE}${imageUrl}`;
  return imageUrl;
};

export const getImageUrlSync = (imageUrl) => {
  if (!imageUrl) return resolveDefaultEventImageSync();
  if (isAbsoluteUrl(imageUrl)) return imageUrl;
  if (imageUrl.startsWith('/uploads/') || imageUrl.startsWith('/')) return `${SERVER_BASE}${imageUrl}`;
  return imageUrl;
};
