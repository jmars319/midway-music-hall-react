import {
  getTableFootprint,
  getTableLayoutMetrics,
  getTableShapeSeatCount,
  normalizeTableShapeValue,
} from '../tableLayoutGeometry';

const getMinimumSeatClearance = (metrics) => {
  let minimum = Infinity;
  for (let leftIndex = 0; leftIndex < metrics.seats.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < metrics.seats.length; rightIndex += 1) {
      const leftSeat = metrics.seats[leftIndex];
      const rightSeat = metrics.seats[rightIndex];
      const distance = Math.hypot(leftSeat.x - rightSeat.x, leftSeat.y - rightSeat.y);
      const clearance = distance - ((leftSeat.size + rightSeat.size) / 2);
      minimum = Math.min(minimum, clearance);
    }
  }
  return minimum;
};

describe('tableLayoutGeometry', () => {
  test('normalizes legacy aliases and seat counts', () => {
    expect(normalizeTableShapeValue('table6')).toBe('table-6');
    expect(normalizeTableShapeValue('table7')).toBe('table-7');
    expect(getTableShapeSeatCount('table-14')).toBe(14);
    expect(getTableShapeSeatCount('table-22')).toBe(22);
    expect(getTableShapeSeatCount('table-30')).toBe(30);
  });

  test('grows footprints as larger long tables are selected', () => {
    const table14 = getTableFootprint('table-14');
    const table22 = getTableFootprint('table-22');
    const table30 = getTableFootprint('table-30');

    expect(table22.width).toBeGreaterThan(table14.width);
    expect(table30.width).toBeGreaterThan(table22.width);
    expect(table22.height).toBeGreaterThanOrEqual(table14.height);
    expect(table30.height).toBeGreaterThanOrEqual(table22.height);
  });

  test('keeps new long-table seats evenly split and non-overlapping', () => {
    ['table-14', 'table-22', 'table-30'].forEach((shape) => {
      const metrics = getTableLayoutMetrics(shape);
      const totalSeats = getTableShapeSeatCount(shape);
      const topSide = metrics.seats.filter((seat) => seat.y < (metrics.height / 2));
      const bottomSide = metrics.seats.filter((seat) => seat.y > (metrics.height / 2));

      expect(metrics.seats).toHaveLength(totalSeats);
      expect(topSide).toHaveLength(totalSeats / 2);
      expect(bottomSide).toHaveLength(totalSeats / 2);
      expect(getMinimumSeatClearance(metrics)).toBeGreaterThanOrEqual(-0.001);
    });
  });
});
