const CATEGORY_META = {
  'beach-bands': {
    label: 'Beach Bands',
    classes: 'bg-cyan-500/15 text-cyan-100 border border-cyan-400/40',
  },
  recurring: {
    label: 'Recurring Series',
    classes: 'bg-blue-500/15 text-blue-100 border border-blue-400/40',
  },
  lessons: {
    label: 'Lessons',
    classes: 'bg-amber-500/15 text-amber-100 border border-amber-400/40',
  },
};

export const shouldShowCategoryBadge = (event = {}) => {
  const slug = (event.category_slug || '').toLowerCase();
  const name = (event.category_name || '').toLowerCase();
  if (!slug && !name) {
    return false;
  }
  if (slug === 'normal' || name === 'normal') {
    return false;
  }
  return true;
};

export const getCategoryBadge = (event = {}) => {
  if (!shouldShowCategoryBadge(event)) {
    return null;
  }
  const slug = (event.category_slug || '').toLowerCase();
  const categoryName = event.category_name || '';
  const meta = CATEGORY_META[slug];
  if (meta) {
    return meta;
  }
  if (categoryName) {
    return {
      label: categoryName,
      classes: 'bg-gray-700/60 text-gray-100 border border-gray-500/40',
    };
  }
  return null;
};
