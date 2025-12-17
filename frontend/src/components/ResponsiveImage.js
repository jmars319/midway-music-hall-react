import React, { useEffect, useMemo, useState } from 'react';
import useSiteContent from '../hooks/useSiteContent';
import { getBrandImages } from '../utils/brandAssets';
import { buildImageVariant } from '../utils/imageVariants';

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
  const siteContent = useSiteContent();
  const brandImages = useMemo(() => getBrandImages(siteContent), [siteContent]);
  const defaultFallback = fallback || brandImages.defaultEventVariant?.fallback || brandImages.defaultEventUrl;

  const variant = useMemo(() => {
    if (image) {
      return buildImageVariant(image, defaultFallback);
    }
    if (src) {
      return buildImageVariant({ original: src }, defaultFallback);
    }
    return buildImageVariant(null, defaultFallback);
  }, [image, src, defaultFallback]);

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

  const [currentSrc, setCurrentSrc] = useState(variant.src || variant.fallback || defaultFallback);
  useEffect(() => {
    setCurrentSrc(variant.src || variant.fallback || defaultFallback);
  }, [variant.src, variant.fallback, defaultFallback]);

  const loading = priority ? 'eager' : 'lazy';
  const fetchPriority = priority ? 'high' : undefined;
  const pictureStyle = activeAspectRatio
    ? { aspectRatio: typeof activeAspectRatio === 'number' ? activeAspectRatio : activeAspectRatio }
    : undefined;

  const handleError = (event) => {
    const fallbackSrc = variant.fallback || defaultFallback;
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
        src={currentSrc || variant.fallback || defaultFallback}
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
