const FALLBACK_TIER_COLOR = '#64748B';

const TIER_PATTERN_DEFINITIONS = [
  { id: 'diagonal', label: 'Diagonal stripe' },
  { id: 'dots', label: 'Dot grid' },
  { id: 'grid', label: 'Grid' },
  { id: 'crosshatch', label: 'Crosshatch' },
  { id: 'vertical', label: 'Vertical stripe' },
  { id: 'horizontal', label: 'Horizontal stripe' },
];

const clampAlpha = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
};

const normalizeHexColor = (value) => {
  const candidate = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : FALLBACK_TIER_COLOR;
};

const hexToRgb = (value) => {
  const hex = normalizeHexColor(value).replace('#', '');
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
};

const withAlpha = (value, alpha) => {
  const { r, g, b } = hexToRgb(value);
  return `rgba(${r}, ${g}, ${b}, ${clampAlpha(alpha)})`;
};

const resolveTierPatternMeta = (patternId = '', index = 0) => {
  const matched = TIER_PATTERN_DEFINITIONS.find((pattern) => pattern.id === patternId);
  if (matched) return matched;
  return TIER_PATTERN_DEFINITIONS[index % TIER_PATTERN_DEFINITIONS.length];
};

const buildPatternStyles = (patternId, color, alpha = 0.28) => {
  const accent = withAlpha(color, alpha);
  switch (patternId) {
    case 'dots':
      return {
        backgroundImage: `radial-gradient(circle at 2px 2px, ${accent} 1.6px, transparent 1.8px)`,
        backgroundSize: '12px 12px',
      };
    case 'grid':
      return {
        backgroundImage: `linear-gradient(${accent} 1px, transparent 1px), linear-gradient(90deg, ${accent} 1px, transparent 1px)`,
        backgroundSize: '12px 12px',
      };
    case 'crosshatch':
      return {
        backgroundImage: `repeating-linear-gradient(45deg, ${accent} 0 3px, transparent 3px 10px), repeating-linear-gradient(-45deg, ${accent} 0 3px, transparent 3px 10px)`,
      };
    case 'vertical':
      return {
        backgroundImage: `repeating-linear-gradient(90deg, ${accent} 0 3px, transparent 3px 10px)`,
      };
    case 'horizontal':
      return {
        backgroundImage: `repeating-linear-gradient(0deg, ${accent} 0 3px, transparent 3px 10px)`,
      };
    case 'diagonal':
    default:
      return {
        backgroundImage: `repeating-linear-gradient(135deg, ${accent} 0 4px, transparent 4px 10px)`,
      };
  }
};

const buildTierSwatchStyle = (tier = {}, index = 0) => {
  const color = normalizeHexColor(tier.color);
  const patternMeta = resolveTierPatternMeta(tier.patternId, index);
  return {
    backgroundColor: withAlpha(color, 0.16),
    ...buildPatternStyles(patternMeta.id, color, 0.34),
    border: `1px solid ${withAlpha(color, 0.72)}`,
    boxShadow: `inset 0 0 0 1px ${withAlpha(color, 0.12)}`,
  };
};

const buildTierGroupStyle = (tier = {}, index = 0) => {
  const color = normalizeHexColor(tier.color);
  const patternMeta = resolveTierPatternMeta(tier.patternId, index);
  return {
    backgroundColor: withAlpha(color, 0.08),
    ...buildPatternStyles(patternMeta.id, color, 0.18),
    border: `1px solid ${withAlpha(color, 0.42)}`,
    boxShadow: `0 10px 24px ${withAlpha(color, 0.08)}, inset 0 0 0 1px ${withAlpha(color, 0.08)}`,
  };
};

const buildTierBodyStyle = (tier = {}, index = 0) => {
  const color = normalizeHexColor(tier.color);
  const patternMeta = resolveTierPatternMeta(tier.patternId, index);
  return {
    backgroundColor: withAlpha(color, 0.2),
    ...buildPatternStyles(patternMeta.id, color, 0.28),
    border: `1px solid ${withAlpha(color, 0.62)}`,
    boxShadow: `inset 0 0 0 1px ${withAlpha(color, 0.12)}`,
    color: '#FFFFFF',
  };
};

export {
  buildTierBodyStyle,
  buildTierGroupStyle,
  buildTierSwatchStyle,
  normalizeHexColor,
  resolveTierPatternMeta,
  withAlpha,
};
