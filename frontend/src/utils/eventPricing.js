import { isSeatRow, resolveRowHeaderLabels, seatIdsForRow } from './seatLabelUtils';

const DEFAULT_TIER_COLORS = [
  '#F59E0B',
  '#06B6D4',
  '#10B981',
  '#8B5CF6',
  '#EF4444',
  '#3B82F6',
  '#F97316',
  '#22C55E',
];

const normalizePriceNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Number(parsed.toFixed(2));
};

const formatPrice = (value) => {
  const parsed = normalizePriceNumber(value);
  if (parsed === null) return null;
  return `$${parsed.toFixed(2).replace(/\.00$/, '')}`;
};

const normalizeTierId = (value, fallback) => {
  const source = String(value || fallback || '').trim().toLowerCase();
  const normalized = source.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || `tier-${fallback || 1}`;
};

const normalizeAssignments = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized = {};
  Object.entries(value).forEach(([rowKey, tierId]) => {
    const nextRowKey = String(rowKey || '').trim();
    const nextTierId = String(tierId || '').trim();
    if (nextRowKey && nextTierId) {
      normalized[nextRowKey] = nextTierId;
    }
  });
  return normalized;
};

const normalizePricingConfig = (value) => {
  if (!value) return null;
  let config = value;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (err) {
      return null;
    }
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const mode = String(config.mode || 'tiered').trim().toLowerCase();
  if (!mode || mode === 'flat' || mode === 'disabled') return null;

  const rawTiers = Array.isArray(config.tiers) ? config.tiers : [];
  const seenIds = new Set();
  const tiers = rawTiers.reduce((acc, tier, index) => {
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return acc;
    const label = String(tier.label || '').trim();
    const price = normalizePriceNumber(tier.price);
    if (!label || price === null) return acc;
    const id = normalizeTierId(tier.id || label, index + 1);
    if (seenIds.has(id)) return acc;
    seenIds.add(id);
    acc.push({
      id,
      label,
      price,
      note: String(tier.note || tier.description || '').trim(),
      color: /^#[0-9A-F]{6}$/i.test(String(tier.color || '').trim())
        ? String(tier.color).trim().toUpperCase()
        : DEFAULT_TIER_COLORS[acc.length % DEFAULT_TIER_COLORS.length],
    });
    return acc;
  }, []);

  if (!tiers.length) return null;

  return {
    mode: 'tiered',
    tiers,
    assignments: normalizeAssignments(config.assignments),
  };
};

const buildPricingRowKey = (row = {}) => {
  const rowId = String(row.id || '').trim();
  if (rowId) return `id:${rowId}`;
  const section = String(row.section_name || row.section || '').trim();
  const rowLabel = String(row.row_label || row.row || '').trim();
  if (!section && !rowLabel) return '';
  return `seatrow:${section}::${rowLabel}`;
};

const describePricingRow = (row = {}) => {
  const { sectionLabel, rowLabel } = resolveRowHeaderLabels(row);
  const parts = [sectionLabel, rowLabel].filter(Boolean);
  if (parts.length) return parts.join(' - ');
  return String(row.label || row.section_name || row.row_label || row.id || 'Seat group').trim();
};

const buildTierLocations = (rows = [], assignments = {}) => {
  const locations = new Map();
  rows.filter(isSeatRow).forEach((row) => {
    const rowKey = buildPricingRowKey(row);
    const tierId = rowKey ? assignments[rowKey] : '';
    if (!tierId) return;
    const list = locations.get(tierId) || [];
    list.push(describePricingRow(row));
    locations.set(tierId, list);
  });
  return locations;
};

const summarizeLocations = (labels = []) => {
  if (!labels.length) return '';
  if (labels.length <= 3) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`;
};

const getEventPricingConfig = (event = {}) => normalizePricingConfig(event?.pricing_config);

const getEventPricingTiers = (event = {}) => getEventPricingConfig(event)?.tiers || [];

const eventHasTieredPricing = (event = {}) => getEventPricingTiers(event).length > 0;

const getTieredPriceSummary = (event = {}) => {
  const tiers = getEventPricingTiers(event);
  if (!tiers.length) return null;
  if (tiers.length <= 3) {
    return tiers.map((tier) => `${tier.label} ${formatPrice(tier.price)}`).join(' • ');
  }
  const prices = tiers.map((tier) => tier.price).filter((price) => price !== null);
  if (!prices.length) return null;
  return `${formatPrice(Math.min(...prices))} – ${formatPrice(Math.max(...prices))} • ${tiers.length} tiers`;
};

const getTieredPriceRange = (event = {}) => {
  const tiers = getEventPricingTiers(event);
  if (!tiers.length) return { min: null, max: null };
  const prices = tiers.map((tier) => tier.price).filter((price) => price !== null);
  if (!prices.length) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
};

const getEventMinimumPrice = (event = {}) => {
  const { min } = getTieredPriceRange(event);
  if (min !== null) return min;
  const fallbackPrices = [
    normalizePriceNumber(event?.ticket_price),
    normalizePriceNumber(event?.door_price),
    normalizePriceNumber(event?.min_ticket_price),
    normalizePriceNumber(event?.max_ticket_price),
  ].filter((price) => price !== null);
  return fallbackPrices.length ? Math.min(...fallbackPrices) : null;
};

const buildEventPricingLegend = (event = {}, rows = []) => {
  const config = getEventPricingConfig(event);
  if (!config) return [];
  const locationsByTier = buildTierLocations(rows, config.assignments || {});
  return config.tiers.map((tier) => {
    const locationLabels = locationsByTier.get(tier.id) || [];
    return {
      ...tier,
      priceLabel: formatPrice(tier.price),
      locationLabels,
      locationSummary: summarizeLocations(locationLabels),
    };
  });
};

const resolveSeatPricingTier = (event = {}, rows = [], seatId = '') => {
  const config = getEventPricingConfig(event);
  if (!config || !seatId) return null;
  const tierMap = new Map(config.tiers.map((tier) => [tier.id, tier]));
  const assignments = config.assignments || {};
  for (const row of rows) {
    if (!isSeatRow(row)) continue;
    const rowKey = buildPricingRowKey(row);
    const tierId = assignments[rowKey];
    if (!tierId || !tierMap.has(tierId)) continue;
    if (seatIdsForRow(row).includes(seatId)) {
      return tierMap.get(tierId) || null;
    }
  }
  return null;
};

export {
  buildEventPricingLegend,
  buildPricingRowKey,
  eventHasTieredPricing,
  formatPrice as formatEventPricingValue,
  getEventMinimumPrice,
  getEventPricingConfig,
  getEventPricingTiers,
  getTieredPriceRange,
  getTieredPriceSummary,
  normalizePricingConfig,
  resolveSeatPricingTier,
};
