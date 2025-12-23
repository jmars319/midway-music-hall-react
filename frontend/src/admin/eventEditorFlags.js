const RECURRING_SLUGS = new Set(['recurring', 'series', 'series-master']);
const BEACH_BANDS_SLUG = 'beach-bands';

export function getEventEditorFlags({
  categorySlug = '',
  isSeriesMaster = false,
  seatingEnabled = false,
}) {
  const normalizedSlug = String(categorySlug || '').toLowerCase();
  const showRecurringPanel = Boolean(isSeriesMaster) || RECURRING_SLUGS.has(normalizedSlug);
  const showBeachBandsPanel = normalizedSlug === BEACH_BANDS_SLUG;
  const showSeatingPanel = Boolean(seatingEnabled);
  const requireScheduleFields = !showRecurringPanel;

  return {
    showRecurringPanel,
    showBeachBandsPanel,
    showSeatingPanel,
    requireScheduleFields,
  };
}

