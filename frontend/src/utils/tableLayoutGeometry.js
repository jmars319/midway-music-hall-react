const DEFAULT_TABLE_SIZE = 60;

export const TABLE_SHAPE_ALIASES = {
  'table-8-rect': 'table-8',
  'table-7-rect': 'table-7',
  table6: 'table-6',
  table7: 'table-7',
};

export const TABLE_SHAPE_OPTIONS = [
  { value: 'table-2', label: '2-Top Table', seats: 2 },
  { value: 'high-top-2', label: '2-Seat High-Top', seats: 2 },
  { value: 'table-4', label: '4-Top Table', seats: 4 },
  { value: 'table-6', label: '6-Top Table', seats: 6 },
  { value: 'table-7', label: '7-Top Table', seats: 7 },
  { value: 'table-8', label: '8-Top Table', seats: 8 },
  { value: 'table-14', label: '14-Top Table', seats: 14 },
  { value: 'table-22', label: '22-Top Table', seats: 22 },
  { value: 'table-30', label: '30-Top Table', seats: 30 },
  { value: 'round-6', label: 'Round Table (6)', seats: 6 },
  { value: 'round-8', label: 'Round Table (8)', seats: 8 },
  { value: 'bar-6', label: 'Bar Seating (6)', seats: 6 },
  { value: 'booth-4', label: 'Booth (4)', seats: 4 },
  { value: 'standing-10', label: 'Standing (10)', seats: 10 },
  { value: 'standing-20', label: 'Standing (20)', seats: 20 },
];

const TABLE_SHAPE_SEAT_COUNTS = TABLE_SHAPE_OPTIONS.reduce((acc, shape) => {
  acc[shape.value] = shape.seats;
  return acc;
}, {});

const roundValue = (value) => Math.round(value * 1000) / 1000;

const scaleValue = (value, scale) => roundValue(value * scale);

const scaleMetrics = (metrics, scale) => ({
  ...metrics,
  width: scaleValue(metrics.width, scale),
  height: scaleValue(metrics.height, scale),
  paddingX: scaleValue(metrics.paddingX || 0, scale),
  paddingY: scaleValue(metrics.paddingY || 0, scale),
  seats: (metrics.seats || []).map((seat) => ({
    ...seat,
    x: scaleValue(seat.x, scale),
    y: scaleValue(seat.y, scale),
    size: scaleValue(seat.size, scale),
  })),
  surface: metrics.surface
    ? {
        ...metrics.surface,
        width: scaleValue(metrics.surface.width, scale),
        height: scaleValue(metrics.surface.height, scale),
      }
    : null,
});

const buildLongTableMetrics = ({
  seatsPerSide,
  seatSize,
  seatGap,
  edgePadding,
  topInset,
  bottomInset,
  surfaceHeight,
  surfaceInsetX,
  paddingX = 20,
  paddingY = 26,
}) => {
  const width = (edgePadding * 2) + (seatsPerSide * seatSize) + ((seatsPerSide - 1) * seatGap);
  const height = topInset + seatSize + surfaceHeight + seatSize + bottomInset;
  const topY = topInset + (seatSize / 2);
  const bottomY = height - bottomInset - (seatSize / 2);
  const startX = edgePadding + (seatSize / 2);
  const seats = [];

  for (let index = 0; index < seatsPerSide; index += 1) {
    const x = startX + (index * (seatSize + seatGap));
    seats.push({ number: index + 1, x, y: topY, size: seatSize });
  }
  for (let index = 0; index < seatsPerSide; index += 1) {
    const x = startX + (index * (seatSize + seatGap));
    seats.push({ number: seatsPerSide + index + 1, x, y: bottomY, size: seatSize });
  }

  return {
    width,
    height,
    paddingX,
    paddingY,
    seats,
    surface: {
      width: Math.max(60, width - (surfaceInsetX * 2)),
      height: surfaceHeight,
      round: false,
    },
  };
};

const buildRoundTableMetrics = ({
  width,
  height = width,
  seatSize,
  radius,
  angles,
  surfaceSize,
  paddingX = 18,
  paddingY = 22,
}) => {
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    width,
    height,
    paddingX,
    paddingY,
    seats: angles.map((angle, index) => {
      const radians = (angle * Math.PI) / 180;
      return {
        number: index + 1,
        x: centerX + (Math.cos(radians) * radius),
        y: centerY + (Math.sin(radians) * radius),
        size: seatSize,
      };
    }),
    surface: {
      width: surfaceSize,
      height: surfaceSize,
      round: true,
    },
  };
};

const TABLE_LAYOUT_BUILDERS = {
  'table-2': () => ({
    width: 68,
    height: 80,
    paddingX: 16,
    paddingY: 18,
    seats: [
      { number: 1, x: 34, y: 18, size: 18 },
      { number: 2, x: 34, y: 62, size: 18 },
    ],
    surface: { width: 36, height: 26, round: false },
  }),
  'high-top-2': () => ({
    width: 108,
    height: 86,
    paddingX: 18,
    paddingY: 18,
    seats: [
      { number: 1, x: 40, y: 62, size: 18 },
      { number: 2, x: 68, y: 62, size: 18 },
    ],
    surface: { width: 62, height: 18, round: false },
  }),
  'table-4': () => ({
    width: 92,
    height: 92,
    paddingX: 18,
    paddingY: 22,
    seats: [
      { number: 1, x: 22, y: 46, size: 18 },
      { number: 2, x: 46, y: 20, size: 18 },
      { number: 3, x: 70, y: 46, size: 18 },
      { number: 4, x: 46, y: 72, size: 18 },
    ],
    surface: { width: 44, height: 34, round: false },
  }),
  'table-6': () => buildLongTableMetrics({
    seatsPerSide: 3,
    seatSize: 18,
    seatGap: 8,
    edgePadding: 14,
    topInset: 14,
    bottomInset: 14,
    surfaceHeight: 34,
    surfaceInsetX: 18,
    paddingX: 20,
    paddingY: 24,
  }),
  'table-7': () => ({
    width: 126,
    height: 98,
    paddingX: 22,
    paddingY: 24,
    seats: [
      { number: 1, x: 28, y: 18, size: 17 },
      { number: 2, x: 53, y: 18, size: 17 },
      { number: 3, x: 78, y: 18, size: 17 },
      { number: 4, x: 28, y: 80, size: 17 },
      { number: 5, x: 53, y: 80, size: 17 },
      { number: 6, x: 78, y: 80, size: 17 },
      { number: 7, x: 108, y: 49, size: 17 },
    ],
    surface: { width: 58, height: 34, round: false },
  }),
  'table-8': () => buildLongTableMetrics({
    seatsPerSide: 4,
    seatSize: 17,
    seatGap: 7,
    edgePadding: 14,
    topInset: 14,
    bottomInset: 14,
    surfaceHeight: 34,
    surfaceInsetX: 18,
    paddingX: 20,
    paddingY: 24,
  }),
  'table-14': () => buildLongTableMetrics({
    seatsPerSide: 7,
    seatSize: 15,
    seatGap: 6,
    edgePadding: 18,
    topInset: 16,
    bottomInset: 16,
    surfaceHeight: 34,
    surfaceInsetX: 24,
    paddingX: 24,
    paddingY: 26,
  }),
  'table-22': () => buildLongTableMetrics({
    seatsPerSide: 11,
    seatSize: 14,
    seatGap: 5,
    edgePadding: 20,
    topInset: 16,
    bottomInset: 16,
    surfaceHeight: 36,
    surfaceInsetX: 28,
    paddingX: 26,
    paddingY: 28,
  }),
  'table-30': () => buildLongTableMetrics({
    seatsPerSide: 15,
    seatSize: 13,
    seatGap: 5,
    edgePadding: 22,
    topInset: 18,
    bottomInset: 18,
    surfaceHeight: 36,
    surfaceInsetX: 34,
    paddingX: 28,
    paddingY: 30,
  }),
  chair: () => ({
    width: 56,
    height: 56,
    paddingX: 14,
    paddingY: 14,
    seats: [{ number: 1, x: 28, y: 28, size: 30 }],
    surface: null,
  }),
  'round-6': () => buildRoundTableMetrics({
    width: 88,
    seatSize: 18,
    radius: 31,
    angles: [270, 330, 30, 90, 150, 210],
    surfaceSize: 42,
    paddingX: 20,
    paddingY: 24,
  }),
  'round-8': () => buildRoundTableMetrics({
    width: 96,
    seatSize: 16,
    radius: 37,
    angles: [0, 45, 90, 135, 180, 225, 270, 315],
    surfaceSize: 46,
    paddingX: 22,
    paddingY: 26,
  }),
  'bar-6': () => ({
    width: 156,
    height: 64,
    paddingX: 18,
    paddingY: 18,
    seats: Array.from({ length: 6 }, (_, index) => ({
      number: index + 1,
      x: 22 + (index * 22),
      y: 32,
      size: 16,
    })),
    surface: { width: 124, height: 16, round: false },
  }),
  'booth-4': () => ({
    width: 92,
    height: 88,
    paddingX: 18,
    paddingY: 22,
    seats: [
      { number: 1, x: 24, y: 22, size: 17 },
      { number: 2, x: 68, y: 22, size: 17 },
      { number: 3, x: 24, y: 66, size: 17 },
      { number: 4, x: 68, y: 66, size: 17 },
    ],
    surface: { width: 34, height: 40, round: false },
  }),
  standing: (shape) => {
    const count = parseInt(String(shape).split('-')[1], 10) || 10;
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const width = Math.max(80, (columns * 16) + ((columns + 1) * 8));
    const height = Math.max(80, (rows * 16) + ((rows + 1) * 8));
    return {
      width,
      height,
      paddingX: 16,
      paddingY: 18,
      seats: Array.from({ length: count }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
          number: index + 1,
          x: 16 + (column * 24),
          y: 16 + (row * 24),
          size: 16,
        };
      }),
      surface: null,
    };
  },
  fallback: () => ({
    width: 72,
    height: 72,
    paddingX: 18,
    paddingY: 18,
    seats: [],
    surface: { width: 40, height: 40, round: true },
  }),
};

export const normalizeTableShapeValue = (shape) => {
  if (!shape) return shape;
  return TABLE_SHAPE_ALIASES[shape] || shape;
};

export const getTableShapeSeatCount = (shape) => {
  const normalized = normalizeTableShapeValue(shape);
  if (normalized && TABLE_SHAPE_SEAT_COUNTS[normalized]) {
    return TABLE_SHAPE_SEAT_COUNTS[normalized];
  }
  if (String(normalized || '').startsWith('standing-')) {
    return parseInt(String(normalized).split('-')[1], 10) || 0;
  }
  return 0;
};

export const getTableLayoutMetrics = (shape, options = {}) => {
  const normalizedShape = normalizeTableShapeValue(shape) || 'table-6';
  const size = Number(options.size) > 0 ? Number(options.size) : DEFAULT_TABLE_SIZE;
  const scale = size / DEFAULT_TABLE_SIZE;
  const builderKey = String(normalizedShape).startsWith('standing-') ? 'standing' : normalizedShape;
  const builder = TABLE_LAYOUT_BUILDERS[builderKey] || TABLE_LAYOUT_BUILDERS.fallback;
  const baseMetrics = builder(normalizedShape);
  return scale === 1 ? baseMetrics : scaleMetrics(baseMetrics, scale);
};

export const getTableFootprint = (shape, options = {}) => {
  const metrics = getTableLayoutMetrics(shape, options);
  return {
    width: roundValue(metrics.width + ((metrics.paddingX || 0) * 2)),
    height: roundValue(metrics.height + ((metrics.paddingY || 0) * 2)),
    visualWidth: metrics.width,
    visualHeight: metrics.height,
    paddingX: metrics.paddingX || 0,
    paddingY: metrics.paddingY || 0,
  };
};

export const DEFAULT_TABLE_SHAPE = 'table-6';

export const resolveTableShapeForRow = (row = {}) => {
  const type = String(row?.element_type || '').trim().toLowerCase();
  if (type === 'chair') {
    return 'chair';
  }
  return normalizeTableShapeValue(row?.table_shape || row?.seat_type || DEFAULT_TABLE_SHAPE) || DEFAULT_TABLE_SHAPE;
};

export const getSeatRowFrame = (row = {}, options = {}) => {
  const shape = resolveTableShapeForRow(row);
  const footprint = getTableFootprint(shape, options);
  const widthOverride = Number(row?.width);
  const heightOverride = Number(row?.height);
  return {
    ...footprint,
    shape,
    width: Number.isFinite(widthOverride) && widthOverride > 0
      ? Math.max(widthOverride, footprint.width)
      : footprint.width,
    height: Number.isFinite(heightOverride) && heightOverride > 0
      ? Math.max(heightOverride, footprint.height)
      : footprint.height,
  };
};
