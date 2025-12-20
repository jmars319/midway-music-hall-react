const RASTER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

// Known local assets that have shipped WebP companions.
const WEBP_COMPANIONS = {
  '/iconslogos/mmh-logo@1x.png': '/iconslogos/mmh-logo@1x.webp',
  '/iconslogos/mmh-logo@2x.png': '/iconslogos/mmh-logo@2x.webp',
  '/iconslogos/mmh-logo@3x.png': '/iconslogos/mmh-logo@3x.webp',
  '/iconslogos/mmh-default-event@1x.png': '/iconslogos/mmh-default-event@1x.webp',
  '/iconslogos/mmh-default-event@2x.png': '/iconslogos/mmh-default-event@2x.webp',
  '/iconslogos/mmh-default-event@3x.png': '/iconslogos/mmh-default-event@3x.webp',
};

const splitUrlAndSuffix = (input) => {
  if (!input || typeof input !== 'string') {
    return { base: '', suffix: '' };
  }
  const firstSuffixIndex = ['?', '#']
    .map((char) => input.indexOf(char))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];
  if (typeof firstSuffixIndex === 'number') {
    return {
      base: input.slice(0, firstSuffixIndex),
      suffix: input.slice(firstSuffixIndex),
    };
  }
  return { base: input, suffix: '' };
};

const parseOriginAndPath = (value) => {
  if (!value) {
    return { origin: '', path: '' };
  }
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return { origin: parsed.origin, path: parsed.pathname || '' };
    } catch (err) {
      return { origin: '', path: value };
    }
  }
  if (value.startsWith('//')) {
    try {
      const parsed = new URL(`https:${value}`);
      return { origin: parsed.origin, path: parsed.pathname || '' };
    } catch (err) {
      return { origin: '', path: value };
    }
  }
  return { origin: '', path: value };
};

const normalizeDescriptorEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    const segments = trimmed.split(/\s+/);
    const src = segments.shift();
    if (!src) return null;
    return {
      src,
      descriptor: segments.join(' ') || null,
    };
  }
  if (typeof entry === 'object' && entry.src) {
    return {
      src: entry.src,
      descriptor: entry.descriptor || entry.density || null,
    };
  }
  return null;
};

export const getPreferredRasterSources = (input) => {
  if (!input || typeof input !== 'string') {
    return { webp: null, fallback: null, fallbackType: null };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { webp: null, fallback: null, fallbackType: null };
  }
  const { base, suffix } = splitUrlAndSuffix(trimmed);
  const extensionMatch = base.match(/\.([a-z0-9]+)$/i);
  if (!extensionMatch) {
    return { webp: null, fallback: trimmed, fallbackType: null };
  }
  const extension = extensionMatch[1].toLowerCase();
  if (!RASTER_EXTENSIONS.has(extension)) {
    return { webp: null, fallback: trimmed, fallbackType: null };
  }

  const { origin, path } = parseOriginAndPath(base);
  const companionPath = WEBP_COMPANIONS[path];
  const fallbackType = MIME_BY_EXTENSION[extension] || null;

  let webp = null;
  if (companionPath) {
    if (companionPath.startsWith('/') && origin) {
      webp = `${origin}${companionPath}${suffix}`;
    } else {
      webp = `${companionPath}${suffix}`;
    }
  }

  return {
    webp,
    fallback: trimmed,
    fallbackType,
  };
};

export const buildVariantFromUrl = (input) => {
  const { fallback, webp } = getPreferredRasterSources(input);
  if (!fallback) {
    return null;
  }
  const variant = {
    original: fallback,
    fallback_original: fallback,
  };
  if (webp) {
    variant.webp = webp;
  }
  return variant;
};

export const buildImageSetFromUrl = (input) => {
  const { fallback, webp, fallbackType } = getPreferredRasterSources(input);
  if (!fallback) {
    return null;
  }
  if (!webp) {
    return `url("${fallback}")`;
  }
  const resolvedFallbackType = fallbackType || 'image/png';
  return `image-set(url("${webp}") type("image/webp") 1x, url("${fallback}") type("${resolvedFallbackType}") 1x)`;
};

export const buildSrcSetPairs = (entries = []) => {
  const fallbackEntries = [];
  const webpEntries = [];
  let fallbackSrc = null;
  let fallbackType = null;

  entries
    .map(normalizeDescriptorEntry)
    .filter(Boolean)
    .forEach(({ src, descriptor }) => {
      const { fallback, webp, fallbackType: entryType } = getPreferredRasterSources(src);
      if (!fallback) {
        return;
      }
      if (!fallbackSrc) {
        fallbackSrc = fallback;
      }
      if (!fallbackType && entryType) {
        fallbackType = entryType;
      }
      const descriptorSuffix = descriptor ? ` ${descriptor}` : '';
      fallbackEntries.push(`${fallback}${descriptorSuffix}`.trim());
      if (webp) {
        webpEntries.push(`${webp}${descriptorSuffix}`.trim());
      }
    });

  return {
    fallbackSrc,
    fallbackSrcSet: fallbackEntries.length ? fallbackEntries.join(', ') : null,
    webpSrcSet: webpEntries.length ? webpEntries.join(', ') : null,
    fallbackType: fallbackType || undefined,
  };
};

export const hasWebpCompanion = (input) => {
  const { webp } = getPreferredRasterSources(input);
  return Boolean(webp);
};

export const DEFAULT_EVENT_ICON_PATH = '/iconslogos/mmh-default-event@1x.png';

