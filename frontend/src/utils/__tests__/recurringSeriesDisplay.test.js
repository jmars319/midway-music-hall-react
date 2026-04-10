import {
  deriveRecurringSeriesScheduleLabel,
  deriveRecurringSeriesSummary,
  formatRecurringOccurrenceDateLabel,
  formatRecurringOccurrenceTimeLabel,
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

  test('uses saved recurring copy fields before falling back to generic content', () => {
    const summary = deriveRecurringSeriesSummary({
      series_summary: 'Open dance floor with rotating instructors.',
    });

    expect(summary).toBe('Open dance floor with rotating instructors.');
  });

  test('falls back to description when no custom recurring summary is saved', () => {
    expect(deriveRecurringSeriesSummary({
      description: 'Open community jam hosted by local musicians.',
    })).toBe('Open community jam hosted by local musicians.');
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
