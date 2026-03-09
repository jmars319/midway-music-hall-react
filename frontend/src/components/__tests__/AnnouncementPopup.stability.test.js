/* eslint-disable testing-library/no-unnecessary-act */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AnnouncementPopup from '../AnnouncementPopup';
import useSiteContent from '../../hooks/useSiteContent';

jest.mock('../../hooks/useSiteContent', () => jest.fn());

const mockedUseSiteContent = useSiteContent;

const buildSiteContent = (overrides = {}) => ({
  announcement_popup: {
    enabled: true,
    message: 'Popup notice',
    severity: 'info',
    link_url: '',
    link_text: '',
    allow_during_seat_selection: false,
    ...overrides,
  },
});

const POPUP_SELECTOR = '[data-announcement-popup-dialog="true"]';
const BACKDROP_SELECTOR = '[data-announcement-popup-backdrop="true"]';

const appendDialog = ({ ariaLabelledBy = 'external-dialog-title', seatSelection = false } = {}) => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', ariaLabelledBy);
  if (seatSelection) {
    const seatContent = document.createElement('div');
    seatContent.className = 'seat-selection-content';
    dialog.appendChild(seatContent);
  }
  document.body.appendChild(dialog);
  return dialog;
};

describe('AnnouncementPopup stability', () => {
  let container;
  let root;

  beforeAll(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
  });

  const renderPopup = async () => {
    await act(async () => {
      root.render(<AnnouncementPopup />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockedUseSiteContent.mockReturnValue(buildSiteContent());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  test('eligible popup mounts once and remains stable during DOM/modal churn', async () => {
    await renderPopup();

    const firstDialogNode = document.querySelector(POPUP_SELECTOR);
    expect(firstDialogNode).not.toBeNull();

    for (let i = 0; i < 4; i += 1) {
      const marker = document.createElement('div');
      marker.setAttribute('data-popup-churn-marker', String(i));
      await act(async () => {
        document.body.appendChild(marker);
        await Promise.resolve();
        marker.remove();
        await Promise.resolve();
      });
      expect(document.querySelector(POPUP_SELECTOR)).toBe(firstDialogNode);
      expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(1);
    }

    const blockingModal = appendDialog();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector(POPUP_SELECTOR)).toBe(firstDialogNode);

    blockingModal.remove();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector(POPUP_SELECTOR)).toBe(firstDialogNode);
  });

  test('suppressed popup renders no backdrop and does not block page clicks', async () => {
    appendDialog();
    let clickCount = 0;
    const pageButton = document.createElement('button');
    pageButton.type = 'button';
    pageButton.addEventListener('click', () => {
      clickCount += 1;
    });
    document.body.appendChild(pageButton);

    await renderPopup();

    expect(document.querySelector(POPUP_SELECTOR)).toBeNull();
    expect(document.querySelector(BACKDROP_SELECTOR)).toBeNull();

    pageButton.click();
    expect(clickCount).toBe(1);
  });

  test('allow_during_seat_selection permits popup without thrash', async () => {
    mockedUseSiteContent.mockReturnValue(
      buildSiteContent({
        allow_during_seat_selection: true,
      })
    );
    appendDialog({ ariaLabelledBy: 'event-seating-title-42', seatSelection: true });

    await renderPopup();

    const popupNode = document.querySelector(POPUP_SELECTOR);
    expect(popupNode).not.toBeNull();
    expect(document.querySelectorAll(POPUP_SELECTOR)).toHaveLength(1);
  });

  test('dismissed popup stays hidden for current cooldown key', async () => {
    await renderPopup();

    const dismissButton = document.querySelector('button[aria-label="Dismiss announcement"]');
    expect(dismissButton).not.toBeNull();

    await act(async () => {
      dismissButton.click();
      await Promise.resolve();
    });

    expect(document.querySelector(POPUP_SELECTOR)).toBeNull();

    await renderPopup();
    expect(document.querySelector(POPUP_SELECTOR)).toBeNull();
  });
});
