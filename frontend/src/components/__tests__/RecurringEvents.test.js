/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RecurringEvents from '../RecurringEvents';

describe('RecurringEvents pricing display', () => {
  let container;
  let root;

  beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
  });

  const renderSeries = async (series) => {
    await act(async () => {
      root.render(<RecurringEvents series={series} />);
      await Promise.resolve();
    });
  };

  test('shows flat recurring pricing on the public card', async () => {
    await renderSeries([
      {
        key: 'flat-recurring',
        master: {
          id: 1,
          artist_name: 'Tuesday Dance',
          ticket_price: 15,
          door_price: 20,
          min_ticket_price: 15,
          max_ticket_price: 20,
        },
        scheduleLabel: '2nd & 4th Tuesday · 6:00 PM',
        summary: 'Dance party',
        nextOccurrence: {
          event_date: '2026-04-14',
          event_time: '18:00:00',
        },
        upcomingOccurrences: [],
      },
    ]);

    expect(container.textContent).toContain('Pricing');
    expect(container.textContent).toContain('Advance $15');
    expect(container.textContent).toContain('Door $20');
  });

  test('shows tiered recurring pricing summary on the public card', async () => {
    await renderSeries([
      {
        key: 'tiered-recurring',
        master: {
          id: 2,
          artist_name: 'Beach Night',
          pricing_config: {
            mode: 'tiered',
            tiers: [
              { id: 'vip', label: 'VIP', price: 30 },
              { id: 'floor', label: 'Floor', price: 20 },
            ],
            assignments: {},
          },
        },
        scheduleLabel: 'Fridays · 7:00 PM',
        summary: 'Beach music',
        nextOccurrence: {
          event_date: '2026-04-10',
          event_time: '19:00:00',
        },
        upcomingOccurrences: [],
      },
    ]);

    expect(container.textContent).toContain('Pricing');
    expect(container.textContent).toContain('VIP $30');
    expect(container.textContent).toContain('Floor $20');
  });
});
