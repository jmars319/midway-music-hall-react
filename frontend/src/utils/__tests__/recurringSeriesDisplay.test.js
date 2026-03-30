import {
  deriveRecurringSeriesScheduleLabel,
  deriveRecurringSeriesSummary,
  formatRecurringOccurrenceDateLabel,
  formatRecurringOccurrenceTimeLabel,
  getLegacyRecurringSeriesOverride,
  resolveRecurringSeriesDisplayOccurrences,
} from '../recurringSeriesDisplay';

describe('recurringSeriesDisplay', () => {
  test('derives weekly schedule labels from recurrence metadata', () => {
    const label = deriveRecurringSeriesScheduleLabel({
      recurrence_frequency: 'weekly',
      recurrence_byweekday: 'TU',
    }, [
      {
        event_date: '2026-04-07',
        event_time: '18:00:00',
      },
    ]);

    expect(label).toBe('Tuesdays · 6:00 PM');
  });

  test('derives legacy monthly nth-weekday labels from rule payload', () => {
    const label = deriveRecurringSeriesScheduleLabel({
      recurrence_frequency: 'monthly',
      recurrence_byweekday: 'SU',
      recurrence_rule_payload: JSON.stringify({ setpos: ['2'] }),
    }, [
      {
        start_datetime: '2026-04-12 14:00:00',
      },
    ]);

    expect(label).toBe('Second Sunday each month · 2:00 PM');
  });

  test('uses neutral recurring summary overrides instead of stale day-specific copy', () => {
    const summary = deriveRecurringSeriesSummary({
      title: "Friday Night Dance with DJ Dancin' Dan",
    });

    expect(summary).toBe('Dance party with Dancin’ Dan.');
    expect(summary.toLowerCase()).not.toContain('friday');
  });

  test('exposes legacy recurring defaults so admin can override them', () => {
    expect(getLegacyRecurringSeriesOverride({
      title: "Friday Night Dance with DJ Dancin' Dan",
    })).toEqual(expect.objectContaining({
      key: 'dj-dan',
      schedule: 'Recurring dance party · 6:00 – 10:00 PM',
      summary: 'Dance party with Dancin’ Dan.',
    }));
  });

  test('formats date-only occurrences without shifting the weekday backward', () => {
    expect(formatRecurringOccurrenceDateLabel({
      event_date: '2026-04-07',
      event_time: '18:00:00',
    })).toBe('Tue, Apr 7');
    expect(formatRecurringOccurrenceTimeLabel({
      event_date: '2026-04-07',
      event_time: '18:00:00',
    })).toBe('6:00 PM');
  });

  test('prefers rule-derived public recurrence occurrences over stale attached child rows', () => {
    expect(resolveRecurringSeriesDisplayOccurrences({
      public_recurrence_occurrences: [
        { event_date: '2026-04-14', event_time: '18:00:00' },
        { event_date: '2026-04-28', event_time: '18:00:00' },
      ],
    }, [
      { event_date: '2026-04-14', event_time: '18:00:00' },
      { event_date: '2026-04-27', event_time: '18:00:00' },
    ])).toEqual([
      { event_date: '2026-04-14', event_time: '18:00:00' },
      { event_date: '2026-04-28', event_time: '18:00:00' },
    ]);
  });
});
