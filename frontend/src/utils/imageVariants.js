import { SERVER_BASE } from '../apiConfig';

const isAbsoluteUrl = (value = '') => /^https?:\/\//i.test(value) || value.startsWith('//') || value.startsWith('data:');

export const prefixAssetUrl = (value) => {
  if (!value) return null;
  if (isAbsoluteUrl(value)) {
    return value;
  }
  if (value.startsWith('/')) {
    return `${SERVER_BASE}${value}`;
  }
  return value;
};

const guessMimeTypeFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const normalized = url.split('?')[0] || '';
  const ext = normalized.split('.').pop();
  if (!ext) return null;
  const lower = ext.toLowerCase();
  if (['jpg', 'jpeg', 'jpe'].includes(lower)) return 'image/jpeg';
  if (lower === 'png') return 'image/png';
  if (lower === 'gif') return 'image/gif';
  if (lower === 'webp') return 'image/webp';
  if (lower === 'avif') return 'image/avif';
  return null;
};

const prefixSrcSet = (value) => {
  if (!value) return null;
  const entries = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const segments = part.split(/\s+/);
      const url = segments.shift();
      if (!url) {
        return null;
      }
      const descriptor = segments.join(' ');
      const prefixed = prefixAssetUrl(url);
      return descriptor ? `${prefixed} ${descriptor}` : prefixed;
    })
    .filter(Boolean);
  return entries.length ? entries.join(', ') : null;
};

const normalizeEntryObject = (entry) => {
  if (!entry) return {};
  if (typeof entry === 'string') {
    return { original: entry };
  }
  return entry;
};

export const buildImageVariant = (entry, fallbackUrl = null) => {
  const normalized = normalizeEntryObject(entry);
  const original = prefixAssetUrl(normalized.original || normalized.file_url || normalized.url || null);
  const fallback = prefixAssetUrl(normalized.fallback_original || fallbackUrl || original);
  const optimized = prefixAssetUrl(normalized.optimized || normalized.optimized_path || null);
  const webp = prefixAssetUrl(normalized.webp || normalized.webp_path || null);
  const optimizedSrcSet = prefixSrcSet(normalized.optimized_srcset || null);
  const webpSrcSet = prefixSrcSet(normalized.webp_srcset || null);
  const width = normalized.intrinsic_width || normalized.width || null;
  const height = normalized.intrinsic_height || normalized.height || null;
  const aspectRatio = width && height ? width / height : null;

  const sources = [];
  if (webpSrcSet || webp) {
    sources.push({
      type: 'image/webp',
      srcSet: webpSrcSet || webp,
    });
  }
  const optimizedType = guessMimeTypeFromUrl(optimized || original || fallback);
  if (optimizedSrcSet || optimized) {
    sources.push({
      type: optimizedType || undefined,
      srcSet: optimizedSrcSet || optimized,
    });
  } else if (original && !sources.length) {
    sources.push({
      type: optimizedType || undefined,
      srcSet: original,
    });
  }

  const src = optimized || original || fallback;

  return {
    original,
    fallback,
    optimized,
    webp,
    optimizedSrcSet,
    webpSrcSet,
    width,
    height,
    aspectRatio,
    src,
    sources,
  };
};

export const resolveEventImageConfig = (event, fallback) => {
  if (!event) {
    return buildImageVariant(null, fallback);
  }
  const variant = buildImageVariant(event.image_variants || null, fallback || event.resolved_image_url || event.image_url || null);
  const width = variant.width || event.image_intrinsic_width || null;
  const height = variant.height || event.image_intrinsic_height || null;
  const aspectRatio = variant.aspectRatio || (width && height ? width / height : null);
  const resolvedSrc = variant.src
    || prefixAssetUrl(event.resolved_image_url)
    || prefixAssetUrl(event.image_url)
    || variant.fallback;
  return {
    ...variant,
    width,
    height,
    aspectRatio,
    src: resolvedSrc,
  };
};

export const resolveEventImageUrl = (event, fallback) => {
  const config = resolveEventImageConfig(event, fallback);
  return config.src || config.fallback || fallback || null;
};
