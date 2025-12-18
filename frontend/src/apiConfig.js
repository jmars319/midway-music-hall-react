const resolveDefaultApiBase = () => {
  if (process.env.REACT_APP_API_BASE) {
    return process.env.REACT_APP_API_BASE;
  }
  if (typeof window !== 'undefined' && window.location) {
    const { origin } = window.location;
    if (origin && origin !== 'null') {
      return `${origin.replace(/\/$/, '')}/api`;
    }
  }
  return '/api';
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
  logo: '/iconslogos/mmh-logo@1x.png',
  mark: '/iconslogos/mmh-logo@1x.png',
  defaultEvent: '/iconslogos/mmh-default-event@1x.png',
};

const isAbsoluteUrl = (value = '') => /^https?:\/\//i.test(value) || value.startsWith('//') || value.startsWith('data:');

export const prefixUploadsUrl = (value) => {
  if (!value) return null;
  if (isAbsoluteUrl(value)) return value;
  if (value.startsWith('/')) return `${SERVER_BASE}${value}`;
  return value;
};

export const primeBrandingCache = () => {};
export const invalidateBrandingCache = () => {};

const resolveDefaultEventImage = async () => BRAND_FALLBACKS.defaultEvent;

const resolveDefaultEventImageSync = () => BRAND_FALLBACKS.defaultEvent;

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
