import React from 'react';
import { buildSrcSetPairs, DEFAULT_EVENT_ICON_PATH } from '../utils/preferWebp';

const RAW_BRAND_CONFIG = {
  logo: {
    width: 80,
    height: 80,
    entries: [
      { src: '/iconslogos/mmh-logo@1x.png', descriptor: '1x' },
      { src: '/iconslogos/mmh-logo@2x.png', descriptor: '2x' },
      { src: '/iconslogos/mmh-logo@3x.png', descriptor: '3x' },
    ],
  },
  defaultEvent: {
    width: 160,
    height: 160,
    entries: [
      { src: DEFAULT_EVENT_ICON_PATH, descriptor: '1x' },
      { src: '/iconslogos/mmh-default-event@2x.png', descriptor: '2x' },
      { src: '/iconslogos/mmh-default-event@3x.png', descriptor: '3x' },
    ],
  },
};

const BRAND_IMAGE_CONFIG = Object.fromEntries(
  Object.entries(RAW_BRAND_CONFIG).map(([key, config]) => {
    const { fallbackSrc, fallbackSrcSet, webpSrcSet, fallbackType } = buildSrcSetPairs(config.entries);
    return [
      key,
      {
        width: config.width,
        height: config.height,
        fallbackSrc,
        fallbackSrcSet,
        webpSrcSet,
        fallbackType: fallbackType || 'image/png',
      },
    ];
  }),
);

export const DEFAULT_EVENT_ICON_SRC = BRAND_IMAGE_CONFIG.defaultEvent.fallbackSrc || DEFAULT_EVENT_ICON_PATH;

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
      {config.webpSrcSet && <source type="image/webp" srcSet={config.webpSrcSet} />}
      {config.fallbackSrcSet && (
        <source type={config.fallbackType || 'image/png'} srcSet={config.fallbackSrcSet} />
      )}
      <img
        src={config.fallbackSrc}
        width={resolvedWidth}
        height={resolvedHeight}
        className={className || undefined}
        alt={alt}
        {...rest}
      />
    </picture>
  );
}
