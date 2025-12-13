export const seatingStatusClasses = {
  selected: 'bg-purple-600 ring-2 ring-purple-300 text-white',
  pending: 'bg-amber-500/80 border-2 border-amber-200 text-amber-950',
  reserved: 'bg-red-600 ring-2 ring-red-400 text-white',
};

export const seatingLegendSwatches = {
  available: 'bg-gray-500 text-white',
  selected: seatingStatusClasses.selected,
  pending: seatingStatusClasses.pending,
  reserved: seatingStatusClasses.reserved,
};

export const seatingStatusLabels = {
  available: 'Available',
  selected: 'Selected',
  pending: 'On Hold (24h)',
  reserved: 'Reserved',
};
