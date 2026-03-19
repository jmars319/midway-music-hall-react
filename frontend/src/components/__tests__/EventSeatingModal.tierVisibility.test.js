/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EventSeatingModal from '../EventSeatingModal';

jest.mock('../ReservationBanner', () => () => null);
jest.mock('../../utils/useFocusTrap', () => jest.fn());
jest.mock('../../utils/paypalHostedButtons', () => ({
  loadPayPalHostedButtonsSdk: jest.fn(),
}));
jest.mock('../../hooks/useSeatDebug', () => ({
  useSeatDebugLogger: () => ({ log: jest.fn(), enabled: false }),
  useSeatDebugProbe: jest.fn(),
}));

const buildTieredEvent = () => ({
  id: 42,
  title: 'Tiered Seating Event',
  artist_name: 'Tiered Seating Event',
  seating_enabled: 1,
  start_datetime: '2026-04-01 19:00:00',
  pricing_config: {
    mode: 'tiered',
    tiers: [
      { id: 'vip', label: 'VIP', price: 30, color: '#F59E0B', note: 'Closest tables' },
      { id: 'standard', label: 'Standard', price: 20, color: '#06B6D4', note: 'Center floor' },
      { id: 'value', label: 'Value', price: 10, color: '#10B981', note: 'Rear tables' },
    ],
    assignments: {
      'id:vip-row': 'vip',
      'id:standard-row': 'standard',
      'id:value-row': 'value',
    },
  },
});

const buildFlatEvent = () => ({
  id: 77,
  title: 'Flat Seating Event',
  artist_name: 'Flat Seating Event',
  seating_enabled: 1,
  start_datetime: '2026-04-02 19:00:00',
  ticket_price: 18,
  door_price: 20,
  min_ticket_price: 18,
  max_ticket_price: 20,
  pricing_config: null,
});

const buildTieredSeatingResponse = () => ({
  success: true,
  seatingEnabled: true,
  stagePosition: { x: 50, y: 10 },
  stageSize: { width: 180, height: 70 },
  canvasSettings: { width: 960, height: 640 },
  reservedSeats: ['Main Floor-Table 2-1'],
  pendingSeats: [],
  holdSeats: [],
  seating: [
    {
      id: 'vip-row',
      element_type: 'table',
      section_name: 'Main Floor',
      row_label: 'Table 1',
      total_seats: 2,
      table_shape: 'table-2',
      pos_x: 22,
      pos_y: 40,
      rotation: 0,
    },
    {
      id: 'standard-row',
      element_type: 'table',
      section_name: 'Main Floor',
      row_label: 'Table 2',
      total_seats: 6,
      table_shape: 'table-6',
      pos_x: 50,
      pos_y: 40,
      rotation: 0,
    },
    {
      id: 'value-row',
      element_type: 'table',
      section_name: 'Main Floor',
      row_label: 'Table 3',
      total_seats: 8,
      table_shape: 'table-8',
      pos_x: 78,
      pos_y: 40,
      rotation: 0,
    },
    {
      id: 'door-marker',
      element_type: 'marker',
      label: 'Door',
      width: 90,
      height: 32,
      pos_x: 10,
      pos_y: 52,
      color: '#60A5FA',
    },
    {
      id: 'dance-floor',
      element_type: 'area',
      label: 'Dance Floor',
      width: 260,
      height: 150,
      pos_x: 50,
      pos_y: 76,
      color: '#F97316',
    },
  ],
});

const buildFlatSeatingResponse = () => ({
  success: true,
  seatingEnabled: true,
  stagePosition: { x: 50, y: 10 },
  stageSize: { width: 180, height: 70 },
  canvasSettings: { width: 960, height: 640 },
  reservedSeats: [],
  pendingSeats: [],
  holdSeats: [],
  seating: [
    {
      id: 'flat-row',
      element_type: 'table',
      section_name: 'Main Floor',
      row_label: 'Table 1',
      total_seats: 2,
      table_shape: 'table-2',
      pos_x: 35,
      pos_y: 42,
      rotation: 0,
    },
    {
      id: 'concessions',
      element_type: 'marker',
      label: 'Concessions',
      width: 140,
      height: 50,
      pos_x: 78,
      pos_y: 56,
      color: '#FBBF24',
    },
  ],
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('EventSeatingModal tier visibility', () => {
  let container;
  let root;

  beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 0;
    };
    window.cancelAnimationFrame = () => {};
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  const renderModal = async ({ event, response }) => {
    global.fetch.mockResolvedValue({
      json: async () => response,
    });

    await act(async () => {
      root.render(<EventSeatingModal event={event} onClose={jest.fn()} />);
      await flush();
    });
  };

  const click = async (element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
  };

  test('shows landmarks and tier styling while preserving seat-state cues and live pricing', async () => {
    await renderModal({
      event: buildTieredEvent(),
      response: buildTieredSeatingResponse(),
    });

    const openChartButton = document.querySelector('button[aria-label="Open full seating chart"]');
    expect(openChartButton).not.toBeNull();

    await click(openChartButton);

    expect(document.body.textContent).toContain('Pricing');
    expect(document.body.textContent).toContain('VIP');
    expect(document.body.textContent).toContain('Diagonal stripe');

    const doorLandmark = document.querySelector('[data-landmark-id="door-marker"]');
    const danceFloorLandmark = document.querySelector('[data-landmark-id="dance-floor"]');
    expect(doorLandmark).not.toBeNull();
    expect(danceFloorLandmark).not.toBeNull();
    expect(doorLandmark.closest('button')).toBeNull();

	    const vipRowSurface = document.querySelector('[data-tier-row="vip-row"]');
	    const vipTableBody = document.querySelector('[data-tier-surface="vip"]');
	    const standardRowSurface = document.querySelector('[data-tier-row="standard-row"]');
	    const standardTableBody = document.querySelector('[data-tier-surface="standard"]');
	    expect(vipRowSurface).not.toBeNull();
	    expect(vipRowSurface.style.border).not.toBe('');
	    expect(vipRowSurface.style.backgroundColor).not.toBe('');
	    expect(vipRowSurface.style.width).toBe('60px');
	    expect(vipRowSurface.style.height).toBe('60px');
	    expect(vipTableBody).not.toBeNull();
	    expect(vipTableBody.style.border).not.toBe('');
	    expect(vipTableBody.style.backgroundColor).not.toBe('');
	    expect(standardRowSurface).toBeNull();
	    expect(standardTableBody).not.toBeNull();
	    expect(standardTableBody.style.border).not.toBe('');
	    expect(standardTableBody.style.backgroundColor).not.toBe('');

    const reservedSeat = document.querySelector('button[data-seat-id="Main Floor-Table 2-1"]');
    expect(reservedSeat).not.toBeNull();
    expect(reservedSeat.dataset.seatState).toBe('reserved');
    expect(reservedSeat.className).toContain('bg-red-600');

    const vipSeat = document.querySelector('button[data-seat-id="Main Floor-Table 1-1"]');
    const standardSeat = document.querySelector('button[data-seat-id="Main Floor-Table 2-2"]');
    expect(vipSeat).not.toBeNull();
    expect(standardSeat).not.toBeNull();

    await click(vipSeat);
    await click(standardSeat);

    const selectedVipSeat = document.querySelector('button[data-seat-id="Main Floor-Table 1-1"]');
    expect(selectedVipSeat.dataset.seatState).toBe('selected');
    expect(selectedVipSeat.className).toContain('bg-purple-600');
    expect(document.body.textContent).toContain('Selected pricing');
    expect(document.body.textContent).toContain('1A');
    expect(document.body.textContent).toContain('2B');
    expect(document.body.textContent).toContain('VIP');
    expect(document.body.textContent).toContain('Standard');
    expect(document.body.textContent).toContain('$30.00');
    expect(document.body.textContent).toContain('$20.00');
    expect(document.body.textContent).toContain('Running total');
    expect(document.body.textContent).toContain('$50.00');
  });

  test('keeps flat-priced events free of tier surfaces and tier pricing panels', async () => {
    await renderModal({
      event: buildFlatEvent(),
      response: buildFlatSeatingResponse(),
    });

    const openChartButton = document.querySelector('button[aria-label="Open full seating chart"]');
    expect(openChartButton).not.toBeNull();

    await click(openChartButton);

    expect(document.querySelector('[data-landmark-id="concessions"]')).not.toBeNull();
    expect(document.querySelector('[data-tier-row]')).toBeNull();
    expect(document.querySelector('[data-tier-surface]')).toBeNull();
    expect(document.body.textContent).not.toContain('Selected pricing');
    expect(document.body.textContent).not.toContain('Running total');

    const flatSeat = document.querySelector('button[data-seat-id="Main Floor-Table 1-1"]');
    expect(flatSeat).not.toBeNull();

    await click(flatSeat);

    const selectedFlatSeat = document.querySelector('button[data-seat-id="Main Floor-Table 1-1"]');
    expect(selectedFlatSeat.dataset.seatState).toBe('selected');
    expect(document.body.textContent).toContain('1A');
    expect(document.body.textContent).not.toContain('Selected pricing');
  });
});
