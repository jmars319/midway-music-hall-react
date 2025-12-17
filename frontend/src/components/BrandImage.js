import React from 'react';

const BRAND_IMAGE_CONFIG = {
  logo: {
    width: 80,
    height: 80,
    webp: [
      '/iconslogos/mmh-logo@1x.webp 1x',
      '/iconslogos/mmh-logo@2x.webp 2x',
      '/iconslogos/mmh-logo@3x.webp 3x',
    ],
    png: [
      '/iconslogos/mmh-logo@1x.png 1x',
      '/iconslogos/mmh-logo@2x.png 2x',
      '/iconslogos/mmh-logo@3x.png 3x',
    ],
    fallback: '/iconslogos/mmh-logo@1x.png',
  },
  defaultEvent: {
    width: 160,
    height: 160,
    webp: [
      '/iconslogos/mmh-default-event@1x.webp 1x',
      '/iconslogos/mmh-default-event@2x.webp 2x',
      '/iconslogos/mmh-default-event@3x.webp 3x',
    ],
    png: [
      '/iconslogos/mmh-default-event@1x.png 1x',
      '/iconslogos/mmh-default-event@2x.png 2x',
      '/iconslogos/mmh-default-event@3x.png 3x',
    ],
    fallback: '/iconslogos/mmh-default-event@1x.png',
  },
};

export const DEFAULT_EVENT_ICON_SRC = '/iconslogos/mmh-default-event@1x.png';

/**
 * Hardcoded brand artwork. These assets intentionally bypass the CMS
 * and responsive-image pipeline so Lighthouse can rely on predictable
 * x-descriptor srcset pairs.
 */
export default function BrandImage({
  variant = 'logo',
  className = '',
  pictureClassName = '',
  alt = '',
  width,
  height,
  ...rest
}) {
  const config = BRAND_IMAGE_CONFIG[variant] || BRAND_IMAGE_CONFIG.logo;
  const resolvedWidth = width || config.width;
  const resolvedHeight = height || config.height;

  return (
    <picture className={pictureClassName || undefined}>
      <source type="image/webp" srcSet={config.webp.join(', ')} />
      <source type="image/png" srcSet={config.png.join(', ')} />
      <img
        src={config.fallback}
        width={resolvedWidth}
        height={resolvedHeight}
        className={className || undefined}
        alt={alt}
        {...rest}
      />
    </picture>
  );
}
