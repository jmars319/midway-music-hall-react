import React, { useState } from 'react';

/**
 * Shared image component that enforces fixed dimensions, lazy loading,
 * async decoding, and graceful fallbacks for both public and admin views.
 */
export default function ResponsiveImage({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  fallback = '/android-chrome-192x192.png',
  ...rest
}) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const loading = priority ? 'eager' : 'lazy';
  const fetchPriority = priority ? 'high' : undefined;

  return (
    <img
      src={currentSrc}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      {...(fetchPriority ? { fetchpriority: fetchPriority } : {})}
      className={className}
      onError={() => {
        if (fallback && currentSrc !== fallback) {
          setCurrentSrc(fallback);
        }
      }}
      {...rest}
    />
  );
}
