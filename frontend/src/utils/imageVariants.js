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

const inferWidthDescriptorFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const filename = url.split('/').pop() || '';
  const match = filename.match(/-w(\d+)/);
  if (match && match[1]) {
    return `${match[1]}w`;
  }
  return null;
};

const normalizeSrcSetEntries = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          if (!trimmed) return null;
          const segments = trimmed.split(/\s+/);
          const url = segments.shift();
          if (!url) return null;
          let descriptor = segments.join(' ') || null;
          if (!descriptor) {
            descriptor = inferWidthDescriptorFromUrl(url);
          }
          return {
            url,
            descriptor: descriptor || null,
          };
        }
        const url = entry.url || entry.src || entry.path || entry.file_url;
        if (!url) return null;
        let descriptor = entry.descriptor || entry.density || entry.pixelDensity || null;
        if (!descriptor && entry.width) {
          descriptor = `${entry.width}w`;
        } else if (!descriptor && entry.pixel_density) {
          descriptor = `${entry.pixel_density}x`;
        }
        if (!descriptor) {
          descriptor = inferWidthDescriptorFromUrl(url);
        }
        return {
          url,
          descriptor: descriptor || null,
        };
      })
      .filter(Boolean);

    // Deduplicate entries by url+descriptor
    const seen = new Set();
    const deduped = [];
    for (const e of entries) {
      const key = `${e.url} ${e.descriptor || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(e);
      }
    }

    // Sort entries with numeric width descriptors ascending by width
    const withWidth = deduped.filter(e => e.descriptor && e.descriptor.endsWith('w') && /^\d+w$/.test(e.descriptor));
    if (withWidth.length > 1) {
      const withoutWidth = deduped.filter(e => !(e.descriptor && e.descriptor.endsWith('w') && /^\d+w$/.test(e.descriptor)));
      withWidth.sort((a, b) => {
        const aVal = parseInt(a.descriptor, 10);
        const bVal = parseInt(b.descriptor, 10);
        return aVal - bVal;
      });
      return [...withWidth, ...withoutWidth];
    }

    return deduped;
  }
  const parts = String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const segments = part.split(/\s+/);
      const url = segments.shift();
      if (!url) {
        return null;
      }
      let descriptor = segments.join(' ') || null;
      if (!descriptor) {
        descriptor = inferWidthDescriptorFromUrl(url);
      }
      return {
        url,
        descriptor: descriptor || null,
      };
    })
    .filter(Boolean);

  // Deduplicate entries by url+descriptor
  const seen = new Set();
  const deduped = [];
  for (const e of parts) {
    const key = `${e.url} ${e.descriptor || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(e);
    }
  }

  // Sort entries with numeric width descriptors ascending by width
  const withWidth = deduped.filter(e => e.descriptor && e.descriptor.endsWith('w') && /^\d+w$/.test(e.descriptor));
  if (withWidth.length > 1) {
    const withoutWidth = deduped.filter(e => !(e.descriptor && e.descriptor.endsWith('w') && /^\d+w$/.test(e.descriptor)));
    withWidth.sort((a, b) => {
      const aVal = parseInt(a.descriptor, 10);
      const bVal = parseInt(b.descriptor, 10);
      return aVal - bVal;
    });
    return [...withWidth, ...withoutWidth];
  }

  return deduped;
};

const prefixSrcSet = (value) => {
  const entries = normalizeSrcSetEntries(value);
  if (!entries.length) {
    return null;
  }
  const normalized = entries
    .map(({ url, descriptor }) => {
      const prefixed = prefixAssetUrl(url);
      if (!prefixed) {
        return null;
      }
      return descriptor ? `${prefixed} ${descriptor}` : prefixed;
    })
    .filter(Boolean);
  return normalized.length ? normalized.join(', ') : null;
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
  const optimizedSrcSet = prefixSrcSet(normalized.optimized_srcset || normalized.optimized_variants || null);
  const webpSrcSet = prefixSrcSet(normalized.webp_srcset || normalized.webp_variants || null);
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
