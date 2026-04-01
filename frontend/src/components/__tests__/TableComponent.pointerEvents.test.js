/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TableComponent from '../TableComponent';

describe('TableComponent pointer event layering', () => {
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

  test('keeps the table shell non-interactive while seats remain clickable', async () => {
    const onToggleSeat = jest.fn();
    const row = {
      id: 'table-6-row',
      element_type: 'table',
      section_name: 'Main Floor',
      row_label: 'Table 9',
      table_shape: 'table-6',
      total_seats: 6,
      seat_type: 'general',
    };

    await act(async () => {
      root.render(
        <TableComponent
          row={row}
          interactive
          selectedSeats={[]}
          pendingSeats={[]}
          reservedSeats={[]}
          holdSeats={[]}
          onToggleSeat={onToggleSeat}
        />
      );
    });

    const shell = container.firstChild;
    expect(shell).not.toBeNull();
    expect(shell.style.pointerEvents).toBe('none');

    const seatButtons = Array.from(container.querySelectorAll('button[data-seat-id]'));
    expect(seatButtons).toHaveLength(6);
    seatButtons.forEach((button) => {
      expect(button.style.pointerEvents).toBe('auto');
      expect(Number(button.getAttribute('data-seat-hit-size'))).toBeGreaterThan(0);
    });

    await act(async () => {
      seatButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onToggleSeat).toHaveBeenCalledWith(
      'Main Floor-Table 9-1',
      expect.objectContaining({
        dataSeatState: 'available',
        seatStatus: 'available',
      })
    );
  });
});

