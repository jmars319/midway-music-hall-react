export const DEFAULT_LAYOUT_CANVAS_LONG_EDGE = 1600;
export const DEFAULT_LAYOUT_CANVAS_SHORT_EDGE = 1000;
export const LEGACY_LAYOUT_CANVAS = {
  preset: 'standard',
  width: 1200,
  height: 800,
};

export const DEFAULT_LAYOUT_CANVAS = {
  preset: 'square',
  width: DEFAULT_LAYOUT_CANVAS_LONG_EDGE,
  height: DEFAULT_LAYOUT_CANVAS_LONG_EDGE,
};

export const LAYOUT_CANVAS_PRESETS = [
  {
    key: 'standard',
    label: `Legacy Standard (${LEGACY_LAYOUT_CANVAS.width}\u2032 \u00d7 ${LEGACY_LAYOUT_CANVAS.height}\u2032)`,
    width: LEGACY_LAYOUT_CANVAS.width,
    height: LEGACY_LAYOUT_CANVAS.height,
  },
  {
    key: 'square',
    label: `Square Room (${DEFAULT_LAYOUT_CANVAS_LONG_EDGE}\u2032 \u00d7 ${DEFAULT_LAYOUT_CANVAS_LONG_EDGE}\u2032)`,
    width: DEFAULT_LAYOUT_CANVAS_LONG_EDGE,
    height: DEFAULT_LAYOUT_CANVAS_LONG_EDGE,
  },
  {
    key: 'wide',
    label: `Wide Room (${DEFAULT_LAYOUT_CANVAS_LONG_EDGE}\u2032 \u00d7 ${DEFAULT_LAYOUT_CANVAS_SHORT_EDGE}\u2032)`,
    width: DEFAULT_LAYOUT_CANVAS_LONG_EDGE,
    height: DEFAULT_LAYOUT_CANVAS_SHORT_EDGE,
  },
  {
    key: 'deep',
    label: `Deep Room (${DEFAULT_LAYOUT_CANVAS_SHORT_EDGE}\u2032 \u00d7 ${DEFAULT_LAYOUT_CANVAS_LONG_EDGE}\u2032)`,
    width: DEFAULT_LAYOUT_CANVAS_SHORT_EDGE,
    height: DEFAULT_LAYOUT_CANVAS_LONG_EDGE,
  },
];
