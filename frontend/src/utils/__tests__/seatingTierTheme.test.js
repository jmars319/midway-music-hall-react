import {
  buildTierBodyStyle,
  buildTierGroupStyle,
  buildTierSwatchStyle,
  resolveTierPatternMeta,
} from '../seatingTierTheme';

describe('seatingTierTheme', () => {
  test('falls back to indexed pattern metadata when a tier has no explicit pattern', () => {
    expect(resolveTierPatternMeta('', 0)).toMatchObject({ id: 'diagonal', label: 'Diagonal stripe' });
    expect(resolveTierPatternMeta('', 1)).toMatchObject({ id: 'dots', label: 'Dot grid' });
  });

  test('builds patterned swatch and surface styles from tier color', () => {
    const tier = { color: '#F59E0B', patternId: 'grid' };

    const swatchStyle = buildTierSwatchStyle(tier);
    const groupStyle = buildTierGroupStyle(tier);
    const bodyStyle = buildTierBodyStyle(tier);

    expect(swatchStyle.backgroundImage).toContain('linear-gradient');
    expect(groupStyle.border).toContain('rgba');
    expect(bodyStyle.backgroundColor).toContain('rgba');
    expect(bodyStyle.boxShadow).toContain('inset');
  });
});
