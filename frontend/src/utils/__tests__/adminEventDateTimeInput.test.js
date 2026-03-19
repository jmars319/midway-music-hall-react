import {
  formatEventDateForInput,
  formatEventTimeForInput,
  parseFriendlyEventDate,
  parseFriendlyEventTime,
} from '../adminEventDateTimeInput';

describe('admin event date input parser', () => {
  test('accepts MM/DD/YYYY and M/D/YYYY', () => {
    expect(parseFriendlyEventDate('03/19/2026')).toBe('2026-03-19');
    expect(parseFriendlyEventDate('3/19/2026')).toBe('2026-03-19');
  });

  test('accepts two-digit year shorthand and normalizes it to the current century', () => {
    expect(parseFriendlyEventDate('03/25/26')).toBe('2026-03-25');
    expect(parseFriendlyEventDate('3/5/26')).toBe('2026-03-05');
  });

  test('accepts compact numeric date input', () => {
    expect(parseFriendlyEventDate('03192026')).toBe('2026-03-19');
    expect(parseFriendlyEventDate('3192026')).toBe('2026-03-19');
    expect(parseFriendlyEventDate('392026')).toBe('2026-03-09');
    expect(parseFriendlyEventDate('032526')).toBe('2026-03-25');
    expect(parseFriendlyEventDate('32526')).toBe('2026-03-25');
    expect(parseFriendlyEventDate('3926')).toBe('2026-03-09');
  });

  test('rejects invalid calendar dates', () => {
    expect(parseFriendlyEventDate('13/40/2026')).toBeNull();
    expect(parseFriendlyEventDate('02/30/2026')).toBeNull();
    expect(parseFriendlyEventDate('1392026')).toBeNull();
  });

  test('formats canonical date values for the form input', () => {
    expect(formatEventDateForInput('2026-03-19')).toBe('03/19/2026');
    expect(formatEventDateForInput('2026-03-19 18:00:00')).toBe('03/19/2026');
    expect(formatEventDateForInput('03/25/26')).toBe('03/25/2026');
    expect(formatEventDateForInput('032526')).toBe('03/25/2026');
  });
});

describe('admin event time input parser', () => {
  test('accepts h:mm AM/PM with flexible spacing/casing', () => {
    expect(parseFriendlyEventTime('07:00 PM')).toBe('19:00:00');
    expect(parseFriendlyEventTime('7:00 PM')).toBe('19:00:00');
    expect(parseFriendlyEventTime('7:00pm')).toBe('19:00:00');
    expect(parseFriendlyEventTime('7:00 pm')).toBe('19:00:00');
    expect(parseFriendlyEventTime('7p')).toBe('19:00:00');
    expect(parseFriendlyEventTime('7 p')).toBe('19:00:00');
  });

  test('accepts compact time shorthand', () => {
    expect(parseFriendlyEventTime('730pm')).toBe('19:30:00');
    expect(parseFriendlyEventTime('730p')).toBe('19:30:00');
    expect(parseFriendlyEventTime('0730 PM')).toBe('19:30:00');
    expect(parseFriendlyEventTime('7.30pm')).toBe('19:30:00');
    expect(parseFriendlyEventTime('1930')).toBe('19:30:00');
    expect(parseFriendlyEventTime('1730')).toBe('17:30:00');
    expect(parseFriendlyEventTime('730')).toBe('07:30:00');
  });

  test('rejects invalid 12-hour times', () => {
    expect(parseFriendlyEventTime('7:61 PM')).toBeNull();
    expect(parseFriendlyEventTime('13:00 PM')).toBeNull();
    expect(parseFriendlyEventTime('00:30 AM')).toBeNull();
  });

  test('formats canonical values for the form input', () => {
    expect(formatEventTimeForInput('19:00:00')).toBe('7:00 PM');
    expect(formatEventTimeForInput('2026-03-19 19:00:00')).toBe('7:00 PM');
    expect(formatEventTimeForInput('7:00pm')).toBe('7:00 PM');
    expect(formatEventTimeForInput('7p')).toBe('7:00 PM');
    expect(formatEventTimeForInput('730pm')).toBe('7:30 PM');
    expect(formatEventTimeForInput('1730')).toBe('5:30 PM');
    expect(formatEventTimeForInput('1930')).toBe('7:30 PM');
  });
});
