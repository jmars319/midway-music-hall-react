import { formatDoorsLabel } from '../eventFormat';

describe('formatDoorsLabel', () => {
  test('returns a single shared door time for multi-day events when all occurrences match', () => {
    const event = {
      occurrences: [
        { occurrence_date: '2026-03-27', door_time: '2026-03-27 18:00:00' },
        { occurrence_date: '2026-03-28', door_time: '2026-03-28 18:00:00' },
      ],
    };

    expect(formatDoorsLabel(event)).toBe('6:00 PM');
  });

  test('returns "Varies" when multi-day occurrences have different door times', () => {
    const event = {
      occurrences: [
        { occurrence_date: '2026-03-27', door_time: '2026-03-27 17:30:00' },
        { occurrence_date: '2026-03-28', door_time: '2026-03-28 18:00:00' },
      ],
    };

    expect(formatDoorsLabel(event)).toBe('Varies');
  });
});
