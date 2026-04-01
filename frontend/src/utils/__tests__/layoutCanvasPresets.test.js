import {
  DEFAULT_LAYOUT_CANVAS,
  DEFAULT_LAYOUT_CANVAS_LONG_EDGE,
  DEFAULT_LAYOUT_CANVAS_SHORT_EDGE,
  LAYOUT_CANVAS_PRESETS,
  LEGACY_LAYOUT_CANVAS,
} from '../layoutCanvasPresets';

describe('layoutCanvasPresets', () => {
  test('defaults new layouts to the larger square room preset', () => {
    expect(DEFAULT_LAYOUT_CANVAS.preset).toBe('square');
    expect(DEFAULT_LAYOUT_CANVAS.width).toBe(DEFAULT_LAYOUT_CANVAS_LONG_EDGE);
    expect(DEFAULT_LAYOUT_CANVAS.height).toBe(DEFAULT_LAYOUT_CANVAS_LONG_EDGE);
  });

  test('keeps legacy standard available while wide, deep, and square share the long edge', () => {
    const legacy = LAYOUT_CANVAS_PRESETS.find((preset) => preset.key === 'standard');
    const square = LAYOUT_CANVAS_PRESETS.find((preset) => preset.key === 'square');
    const wide = LAYOUT_CANVAS_PRESETS.find((preset) => preset.key === 'wide');
    const deep = LAYOUT_CANVAS_PRESETS.find((preset) => preset.key === 'deep');

    expect(legacy).toEqual({
      key: 'standard',
      label: `Legacy Standard (${LEGACY_LAYOUT_CANVAS.width}\u2032 \u00d7 ${LEGACY_LAYOUT_CANVAS.height}\u2032)`,
      width: LEGACY_LAYOUT_CANVAS.width,
      height: LEGACY_LAYOUT_CANVAS.height,
    });

    expect(square.width).toBe(DEFAULT_LAYOUT_CANVAS_LONG_EDGE);
    expect(square.height).toBe(DEFAULT_LAYOUT_CANVAS_LONG_EDGE);
    expect(wide.width).toBe(DEFAULT_LAYOUT_CANVAS_LONG_EDGE);
    expect(wide.height).toBe(DEFAULT_LAYOUT_CANVAS_SHORT_EDGE);
    expect(deep.width).toBe(DEFAULT_LAYOUT_CANVAS_SHORT_EDGE);
    expect(deep.height).toBe(DEFAULT_LAYOUT_CANVAS_LONG_EDGE);
  });
});

