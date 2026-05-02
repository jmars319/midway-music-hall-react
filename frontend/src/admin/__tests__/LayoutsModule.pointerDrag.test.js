/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import LayoutsModule from '../LayoutsModule';

const mockLayout = {
  id: 7,
  name: 'Pointer Drag Layout',
  description: 'Regression fixture',
  is_default: 1,
  layout_data: [
    {
      id: 'marker-1',
      element_type: 'marker',
      label: 'Concessions',
      section_name: 'Concessions',
      row_label: '',
      pos_x: 50,
      pos_y: 50,
      width: 120,
      height: 80,
      color: '#fbbf24',
      rotation: 0,
    },
  ],
  stage_position: { x: 50, y: 10 },
  stage_size: { width: 200, height: 80 },
  canvas_settings: { preset: 'standard', width: 1000, height: 500 },
};

describe('LayoutsModule pointer dragging', () => {
  let container;
  let root;
  let originalFetch;

  beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve({
      json: () => Promise.resolve({ success: true, layouts: [mockLayout] }),
    }));
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    global.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  test('moves a placed layout object with pointer events', async () => {
    await act(async () => {
      root.render(<LayoutsModule />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const editButton = container.querySelector('button[title="Edit"]');
    expect(editButton).not.toBeNull();
    await act(async () => {
      editButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const canvas = container.querySelector('[data-layout-canvas="true"]');
    expect(canvas).not.toBeNull();
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const marker = container.querySelector('[data-layout-row="true"]');
    expect(marker).not.toBeNull();
    expect(marker.style.left).toBe('50%');
    expect(marker.style.top).toBe('50%');

    await act(async () => {
      marker.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 500,
        clientY: 250,
      }));
      window.dispatchEvent(new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 700,
        clientY: 350,
      }));
      window.dispatchEvent(new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 700,
        clientY: 350,
      }));
    });

    expect(marker.style.left).toBe('70%');
    expect(marker.style.top).toBe('70%');
  });
});
