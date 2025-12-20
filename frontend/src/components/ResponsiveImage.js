import React, { useEffect, useMemo, useState } from 'react';
import { buildImageVariant } from '../utils/imageVariants';
import { buildVariantFromUrl, DEFAULT_EVENT_ICON_PATH } from '../utils/preferWebp';
import { DEFAULT_EVENT_ICON_SRC } from './BrandImage';

const DEFAULT_EVENT_FALLBACK_VARIANT = buildVariantFromUrl(DEFAULT_EVENT_ICON_SRC || DEFAULT_EVENT_ICON_PATH);

/**
 * Shared image component that renders a responsive <picture> block with
 * srcset-aware sources, optional fetch priorities, and graceful fallbacks.
 */
export default function ResponsiveImage({
  image = null,
  src = null,
  alt = '',
  width,
  height,
  className = '',
  pictureClassName = 'block',
  priority = false,
  fallback = null,
  sizes: sizesProp = null,
  fallbackAspectRatio = null,
  forceAspectRatio = null,
  disableAspectRatio = false,
  fill = false,
  ...rest
}) {
  const fallbackVariant = useMemo(() => {
    if (!fallback) {
      return DEFAULT_EVENT_FALLBACK_VARIANT;
    }
    return buildVariantFromUrl(fallback) || DEFAULT_EVENT_FALLBACK_VARIANT;
  }, [fallback]);

  const fallbackUrl = fallbackVariant?.original || fallbackVariant?.fallback || DEFAULT_EVENT_ICON_SRC || DEFAULT_EVENT_ICON_PATH;

  const variant = useMemo(() => {
    if (image) {
      return buildImageVariant(image, fallbackUrl);
    }
    if (src) {
      return buildImageVariant({ original: src }, fallbackUrl);
    }
    return buildImageVariant(fallbackVariant, fallbackUrl);
  }, [image, src, fallbackVariant, fallbackUrl]);

  const resolvedWidth = width || variant.width || undefined;
  const resolvedHeight = height || variant.height || undefined;
  const normalizeAspectRatio = (value) => {
    if (!value) return null;
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value.includes('/')) {
      if (value.includes(' ')) {
        return value;
      }
      return value.replace('/', ' / ');
    }
    return value;
  };

  const normalizedFallbackAspectRatio = normalizeAspectRatio(fallbackAspectRatio);
  const normalizedForceAspectRatio = normalizeAspectRatio(forceAspectRatio);

  const activeAspectRatio = disableAspectRatio
    ? null
    : normalizeAspectRatio(
        normalizedForceAspectRatio
        || variant.aspectRatio
        || (resolvedWidth && resolvedHeight ? resolvedWidth / resolvedHeight : null)
        || normalizedFallbackAspectRatio,
      );

  const [currentSrc, setCurrentSrc] = useState(variant.src || variant.fallback || fallbackUrl);
  useEffect(() => {
    setCurrentSrc(variant.src || variant.fallback || fallbackUrl);
  }, [variant.src, variant.fallback, fallbackUrl]);

  const loading = priority ? 'eager' : 'lazy';
  const fetchPriority = priority ? 'high' : undefined;
  const pictureStyle = activeAspectRatio
    ? { aspectRatio: typeof activeAspectRatio === 'number' ? activeAspectRatio : activeAspectRatio }
    : undefined;

  const handleError = (event) => {
    const fallbackSrc = variant.fallback || fallbackUrl;
    if (!fallbackSrc || event?.target?.dataset?.fallbackApplied) {
      return;
    }
    event.target.dataset.fallbackApplied = 'true';
    setCurrentSrc(fallbackSrc);
  };

  const basePictureClass = fill ? 'absolute inset-0 w-full h-full' : '';
  // In fill mode, ensure the internal sizing/positioning classes win.
  const mergedPictureClass = fill
    ? [pictureClassName, basePictureClass].filter(Boolean).join(' ')
    : [basePictureClass, pictureClassName].filter(Boolean).join(' ');

  const pictureProps = {
    className: mergedPictureClass || undefined,
    style: fill ? undefined : pictureStyle,
  };

  const appliedSizes = sizesProp || (resolvedWidth ? `${Math.round(resolvedWidth)}px` : '100vw');

  const baseImgClass = fill ? 'absolute inset-0 w-full h-full object-cover object-center' : '';
  // In fill mode, ensure the internal sizing/positioning classes win (caller may pass w-auto/h-auto).
  const mergedImgClass = fill
    ? [className, baseImgClass].filter(Boolean).join(' ') || undefined
    : (className || undefined);

  const imgSrcSet = variant.optimizedSrcSet || null;

  const imgWidth = fill ? undefined : resolvedWidth;
  const imgHeight = fill ? undefined : resolvedHeight;

  const pictureElement = (
    <picture {...pictureProps}>
      {variant.sources.map((source, index) => (
        <source
          key={`${source.type || 'default'}-${index}`}
          srcSet={source.srcSet}
          type={source.type}
          sizes={appliedSizes}
        />
      ))}
      <img
        src={currentSrc || variant.fallback || fallbackUrl}
        alt={alt}
        width={imgWidth}
        height={imgHeight}
        loading={loading}
        decoding="async"
        sizes={appliedSizes}
        className={mergedImgClass}
        srcSet={imgSrcSet || undefined}
        onError={handleError}
        {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
        {...rest}
      />
    </picture>
  );

// Only wrap when caller did NOT already provide a positioned container
if (fill && !rest['data-slot']) {
  return (
    <div className="relative w-full h-full">
      {pictureElement}
    </div>
  );
}

return pictureElement;
}
