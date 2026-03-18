import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, Send, AlertCircle, Phone, Mail } from 'lucide-react';
import TableComponent from './TableComponent';
import { API_BASE } from '../apiConfig';
import { buildSeatLegendItems, buildSeatStatusMap } from '../utils/seatingTheme';
import useFocusTrap from '../utils/useFocusTrap';
import { buildSeatLookupMap, describeSeatSelection, formatSeatLabel, isSeatRow } from '../utils/seatLabelUtils';
import { CONTACT_LINK_CLASSES, formatPhoneHref } from '../utils/contactLinks';
import { filterUnavailableSeats } from '../utils/seatAvailability';
import { useSeatDebugLogger, useSeatDebugProbe } from '../hooks/useSeatDebug';
import { loadPayPalHostedButtonsSdk } from '../utils/paypalHostedButtons';
import { formatEventDateTimeLabel, formatEventPriceDisplay, formatEventRunSummary, isMultiDayEvent } from '../utils/eventFormat';
import { buildEventPricingLegend, resolveRowPricingTier, resolveSeatPricingTier } from '../utils/eventPricing';
import { buildTierBodyStyle, buildTierGroupStyle, buildTierSwatchStyle, withAlpha } from '../utils/seatingTierTheme';
import ReservationBanner from './ReservationBanner';

const ALWAYS_USE_SEAT_CHART_OVERLAY = true;

const formatCurrencyAmount = (value, currency = 'USD') => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  const normalizedCurrency = /^[A-Z]{3}$/.test(currency || '') ? currency : 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
};

const getLandmarkLabel = (row = {}) => (
  row.label || row.marker_label || row.section_name || row.row_label || 'Landmark'
);

export default function EventSeatingModal({ event, onClose }) {
  const [seatingConfig, setSeatingConfig] = useState([]);
  const [reservedSeats, setReservedSeats] = useState([]);
  const [pendingSeats, setPendingSeats] = useState([]);
  const [holdSeats, setHoldSeats] = useState([]);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [showMobileEventDetails, setShowMobileEventDetails] = useState(false);
  const [showLargeMap, setShowLargeMap] = useState(false);
  const [showLargeMapLegend, setShowLargeMapLegend] = useState(false);
  const [overlayOnlySeatChart, setOverlayOnlySeatChart] = useState(false);
  const paymentOption = event?.payment_option || null;
  const [paymentPanelDismissed, setPaymentPanelDismissed] = useState(false);
  const [postSubmitPaymentReady, setPostSubmitPaymentReady] = useState(false); // Phase 3 scaffold: post-submit payment gate
  const [submittedSeatCount, setSubmittedSeatCount] = useState(0);
  const [submittedTotalAmount, setSubmittedTotalAmount] = useState(null);
  const [submittedCurrency, setSubmittedCurrency] = useState('USD');
  const [paypalRenderError, setPaypalRenderError] = useState('');
  const [stagePosition, setStagePosition] = useState({ x: 50, y: 10 });
  const [stageSize, setStageSize] = useState({ width: 200, height: 80 });
  const [canvasSettings, setCanvasSettings] = useState({ width: 1200, height: 800 });
  const [seatingEnabled, setSeatingEnabled] = useState(() => Number(event.seating_enabled) === 1);
  const [mapTransform, setMapTransform] = useState({ scale: 1, translateX: 0, translateY: 0 });
  const canvasContainerRef = useRef(null);
  const mapViewportRef = useRef(null);
  const seatSelectionContentRef = useRef(null);
  const mapFitRequestedRef = useRef(false);
  const resizeDebounceRef = useRef(null);
  const seatSizingDebounceRef = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const largeMapOverlayRef = useRef(null);
  const largeMapCloseButtonRef = useRef(null);
  const errorResetTimer = useRef(null);
  const seatDebug = useSeatDebugLogger('event-modal');
  const { log: seatDebugLog, enabled: seatDebugEnabled } = seatDebug;
  useSeatDebugProbe(canvasContainerRef, seatDebug);
  const titleId = `event-seating-title-${event.id}`;
  const nameInputId = `${titleId}-customer-name`;
  const emailInputId = `${titleId}-customer-email`;
  const phoneInputId = `${titleId}-customer-phone`;
  const selectedSeatsId = `${titleId}-selected-seats`;
  const specialRequestsId = `${titleId}-special-requests`;
  const phoneHelpTextId = `${titleId}-phone-help`;
  const eventDetailsPanelId = `${titleId}-event-details`;
  const largeMapTitleId = `${titleId}-large-map-title`;
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    specialRequests: ''
  });
  const contactName = (event.contact_name || '').trim();
  const contactPhone = (event.contact_phone_raw || event.contact_phone || event.contact_phone_normalized || '').trim();
  const contactEmail = (event.contact_email || '').trim();
  const contactNotes = (event.contact_notes || '').trim();
  const hasEventContact = Boolean(contactName || contactPhone || contactEmail || contactNotes);
  const contactPhoneHref = formatPhoneHref(contactPhone);
  const reservedSet = useMemo(() => new Set(reservedSeats || []), [reservedSeats]);
  const pendingSet = useMemo(() => new Set(pendingSeats || []), [pendingSeats]);
  const holdSet = useMemo(() => new Set(holdSeats || []), [holdSeats]);
  const seatStatusMap = useMemo(
    () => buildSeatStatusMap({ reserved: reservedSeats, pending: pendingSeats, hold: holdSeats }),
    [holdSeats, pendingSeats, reservedSeats]
  );
  const legendItems = useMemo(() => buildSeatLegendItems(), []);
  const priceSummaryLabel = useMemo(() => formatEventPriceDisplay(event), [event]);
  const eventDateLabel = useMemo(() => formatEventDateTimeLabel(event), [event]);
  const multiDay = useMemo(() => isMultiDayEvent(event), [event]);
  const multiDayRunSummary = useMemo(() => formatEventRunSummary(event, 6), [event]);
  const clearTransientErrorTimer = useCallback(() => {
    if (errorResetTimer.current) {
      clearTimeout(errorResetTimer.current);
      errorResetTimer.current = null;
    }
  }, []);

  const showTransientError = useCallback(
    (message, timeout = 3000) => {
      setErrorMessage(message);
      clearTransientErrorTimer();
      errorResetTimer.current = setTimeout(() => {
        setErrorMessage('');
        errorResetTimer.current = null;
      }, timeout);
    },
    [clearTransientErrorTimer]
  );

  useEffect(
    () => () => {
      clearTransientErrorTimer();
    },
    [clearTransientErrorTimer]
  );

  const handleModalClose = () => {
    // Close immediately when ESC is pressed; do not force confirmation
    onClose();
  };

  useFocusTrap(dialogRef, { onClose: handleModalClose, enabled: true, initialFocusRef: closeButtonRef });

  const activeRows = useMemo(
    () => seatingConfig.filter((row) => row.is_active !== false),
    [seatingConfig]
  );
  const seatRows = useMemo(() => activeRows.filter((row) => isSeatRow(row)), [activeRows]);
  const decorRows = useMemo(() => activeRows.filter((row) => !isSeatRow(row)), [activeRows]);
  const pricingLegendItems = useMemo(
    () => buildEventPricingLegend(event, seatRows),
    [event, seatRows]
  );
  const pricingTierDisplayMap = useMemo(
    () => new Map(
      pricingLegendItems.map((tier, index) => [
        tier.id,
        {
          ...tier,
          tierIndex: index,
          swatchStyle: buildTierSwatchStyle(tier, index),
          rowStyle: buildTierGroupStyle(tier, index),
          surfaceStyle: buildTierBodyStyle(tier, index),
        },
      ])
    ),
    [pricingLegendItems]
  );
  const seatLabelMap = useMemo(() => buildSeatLookupMap(seatRows), [seatRows]);
  const seatLabelFor = (seatId) => formatSeatLabel(seatLabelMap[seatId] || seatId, { mode: 'seat' });
  const selectedSeatPricing = useMemo(() => {
    if (!selectedSeats.length || !pricingLegendItems.length) {
      return { lineItems: [], total: null };
    }
    const lineItems = [];
    let total = 0;
    selectedSeats.forEach((seatId) => {
      const tier = resolveSeatPricingTier(event, seatRows, seatId);
      if (!tier) return;
      const price = normalizeFiniteNumber(tier.price);
      if (price === null) return;
      const tierDisplay = pricingTierDisplayMap.get(tier.id) || tier;
      total += price;
      lineItems.push({
        seatId,
        seatLabel: describeSeatSelection(seatId, formatSeatLabel(seatLabelMap[seatId] || seatId, { mode: 'seat' })),
        tierId: tier.id,
        tierLabel: tierDisplay.label,
        tierColor: tierDisplay.color,
        patternId: tierDisplay.patternId,
        patternLabel: tierDisplay.patternLabel,
        swatchStyle: tierDisplay.swatchStyle,
        price,
        priceLabel: formatCurrencyAmount(price),
      });
    });
    return {
      lineItems,
      total: lineItems.length ? Number(total.toFixed(2)) : null,
    };
  }, [event, pricingLegendItems.length, pricingTierDisplayMap, seatLabelMap, seatRows, selectedSeats]);
  const canvasWidth = canvasSettings?.width || 1200;
  const canvasHeight = canvasSettings?.height || 800;
  const hasPositions = useMemo(
    () =>
      seatRows.some(
        (r) =>
          r.pos_x !== null &&
          r.pos_y !== null &&
          r.pos_x !== undefined &&
          r.pos_y !== undefined
      ),
    [seatRows]
  );
  const isSeatSelectionView = !loading && !showContactForm && hasPositions;
  const isMobileSeatMode = isSeatSelectionView && isMobileViewport;
  const MIN_INLINE_MAP_HEIGHT = 240;

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    setSeatingEnabled(Number(event.seating_enabled) === 1);
    fetchEventSeating();
  }, [event.id, event.seating_enabled]);

  useEffect(() => {
    setSelectedSeats([]);
    setShowContactForm(false);
    setShowCancelConfirm(false);
    setPaymentPanelDismissed(false);
    setPostSubmitPaymentReady(false);
    setSubmittedSeatCount(0);
    setSubmittedTotalAmount(null);
    setSubmittedCurrency('USD');
    setSuccessMessage('');
    setErrorMessage('');
    setShowLargeMap(false);
    setShowLargeMapLegend(false);
    setOverlayOnlySeatChart(false);
    setMapTransform({ scale: 1, translateX: 0, translateY: 0 });
    mapFitRequestedRef.current = false;
  }, [event.id]);

  useEffect(() => {
    setSelectedSeats((prev) => {
      const filtered = filterUnavailableSeats(prev, reservedSet, pendingSet, holdSet);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [holdSet, pendingSet, reservedSet]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!showContactForm) {
      setPaymentPanelDismissed(false);
    }
  }, [showContactForm, event.id]);

  useEffect(() => {
    if (showContactForm && showLargeMap) {
      setShowLargeMap(false);
    }
  }, [showContactForm, showLargeMap]);

  useEffect(() => {
    if (!showLargeMap) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowLargeMap(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showLargeMap]);

  useEffect(() => {
    if (!showLargeMap) {
      setShowLargeMapLegend(false);
    }
  }, [showLargeMap]);

  useEffect(() => {
    if (!showLargeMap) return;
    requestAnimationFrame(() => {
      if (largeMapCloseButtonRef.current) {
        largeMapCloseButtonRef.current.focus();
      } else if (largeMapOverlayRef.current) {
        largeMapOverlayRef.current.focus();
      }
    });
  }, [showLargeMap]);

  const fitSeatsToViewport = useCallback((mode = 'fit') => {
    if (!hasPositions) return;
    const viewport = mapViewportRef.current;
    const scrollContainer = canvasContainerRef.current;
    if (!viewport || !scrollContainer) return;
    const viewportWidth = viewport.clientWidth || 0;
    const viewportHeight = viewport.clientHeight || 0;
    if (!viewportWidth || !viewportHeight) return;
    const positionedRows = activeRows.filter(
      (row) => row?.pos_x !== null && row?.pos_x !== undefined && row?.pos_y !== null && row?.pos_y !== undefined
    );
    let bounds = null;
    if (positionedRows.length) {
      bounds = positionedRows.reduce(
        (acc, row) => {
          const x = ((Number(row.pos_x) || 0) / 100) * canvasWidth;
          const y = ((Number(row.pos_y) || 0) / 100) * canvasHeight;
          return {
            minX: Math.min(acc.minX, x),
            maxX: Math.max(acc.maxX, x),
            minY: Math.min(acc.minY, y),
            maxY: Math.max(acc.maxY, y),
          };
        },
        { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
      );
    }
    if (stagePosition && stageSize) {
      const stageX = ((Number(stagePosition.x) || 0) / 100) * canvasWidth;
      const stageY = ((Number(stagePosition.y) || 0) / 100) * canvasHeight;
      const stageW = Number(stageSize.width);
      const stageH = Number(stageSize.height);
      if (Number.isFinite(stageX) && Number.isFinite(stageY) && Number.isFinite(stageW) && Number.isFinite(stageH)) {
        const stageLeft = stageX - stageW / 2;
        const stageRight = stageX + stageW / 2;
        const stageTop = stageY - stageH / 2;
        const stageBottom = stageY + stageH / 2;
        if (bounds) {
          bounds = {
            minX: Math.min(bounds.minX, stageLeft),
            maxX: Math.max(bounds.maxX, stageRight),
            minY: Math.min(bounds.minY, stageTop),
            maxY: Math.max(bounds.maxY, stageBottom),
          };
        } else {
          bounds = {
            minX: stageLeft,
            maxX: stageRight,
            minY: stageTop,
            maxY: stageBottom,
          };
        }
      }
    }
    const padding = mode === 'fit' ? 140 : 120;
    const targetWidth = bounds ? Math.max(260, bounds.maxX - bounds.minX + padding * 2) : canvasWidth;
    const targetHeight = bounds ? Math.max(220, bounds.maxY - bounds.minY + padding * 2) : canvasHeight;
    const fitScale = Math.min(viewportWidth / targetWidth, viewportHeight / targetHeight);
    const minScale = mode === 'default' ? 0.9 : 0.2;
    const scale = Math.min(Math.max(fitScale, minScale), 2.2);
    const focusX = bounds ? (bounds.minX + bounds.maxX) / 2 : canvasWidth / 2;
    const focusY = bounds ? (bounds.minY + bounds.maxY) / 2 : canvasHeight / 2;
    const translateX = viewportWidth / 2 - focusX * scale;
    const translateY = viewportHeight / 2 - focusY * scale;
    scrollContainer.scrollTop = 0;
    scrollContainer.scrollLeft = 0;
    setMapTransform({ scale, translateX, translateY });
  }, [activeRows, canvasHeight, canvasWidth, hasPositions, stagePosition, stageSize]);

  const scheduleFitToViewport = useCallback(() => {
    if (!mapFitRequestedRef.current) return;
    if (resizeDebounceRef.current) {
      clearTimeout(resizeDebounceRef.current);
    }
    resizeDebounceRef.current = setTimeout(() => {
      resizeDebounceRef.current = null;
      if (mapFitRequestedRef.current) {
        fitSeatsToViewport();
      }
    }, 150);
  }, [fitSeatsToViewport]);

  const handleFitSeatsClick = useCallback(() => {
    mapFitRequestedRef.current = true;
    fitSeatsToViewport('fit');
  }, [fitSeatsToViewport]);

  const handleZoomIn = useCallback(() => {
    setMapTransform((prev) => ({ ...prev, scale: Math.min(2.5, Number((prev.scale + 0.12).toFixed(2)) || 1) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setMapTransform((prev) => ({ ...prev, scale: Math.max(0.2, Number((prev.scale - 0.12).toFixed(2)) || 1) }));
  }, []);

  const openLargeMapOverlay = useCallback(() => {
    setShowLargeMap(true);
    setShowLargeMapLegend(!isMobileViewport);
    mapFitRequestedRef.current = true;
    requestAnimationFrame(() => {
      fitSeatsToViewport('default');
    });
  }, [fitSeatsToViewport, isMobileViewport]);

  useEffect(() => {
    const handleResize = () => {
      scheduleFitToViewport();
    };
    const handleOrientationChange = () => {
      scheduleFitToViewport();
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [scheduleFitToViewport]);

  useEffect(() => () => {
    if (resizeDebounceRef.current) {
      clearTimeout(resizeDebounceRef.current);
      resizeDebounceRef.current = null;
    }
    if (seatSizingDebounceRef.current) {
      clearTimeout(seatSizingDebounceRef.current);
      seatSizingDebounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const buildFallbackQuery = () => ({
      matches: false,
      addEventListener: null,
      removeEventListener: null,
      addListener: null,
      removeListener: null,
    });
    const widthQuery = window.matchMedia('(max-width: 640px)') || buildFallbackQuery();
    const coarseQuery = window.matchMedia('(pointer: coarse)') || buildFallbackQuery();
    const hoverNoneQuery = window.matchMedia('(hover: none)') || buildFallbackQuery();
    const finePointerQuery = window.matchMedia('(pointer: fine)') || buildFallbackQuery();
    const getMobileViewport = () => {
      const isNarrow = Boolean(widthQuery.matches);
      const isCoarsePointer = Boolean(coarseQuery.matches) || (Boolean(hoverNoneQuery.matches) && !Boolean(finePointerQuery.matches));
      const isNarrowTouch = isNarrow && !Boolean(finePointerQuery.matches);
      return isNarrowTouch || isCoarsePointer;
    };
    const handleChange = () => {
      setIsMobileViewport(getMobileViewport());
      scheduleFitToViewport();
    };
    setIsMobileViewport(getMobileViewport());
    if (typeof widthQuery.addEventListener === 'function') {
      widthQuery.addEventListener('change', handleChange);
      coarseQuery.addEventListener('change', handleChange);
      hoverNoneQuery.addEventListener('change', handleChange);
      finePointerQuery.addEventListener('change', handleChange);
      return () => {
        widthQuery.removeEventListener('change', handleChange);
        coarseQuery.removeEventListener('change', handleChange);
        hoverNoneQuery.removeEventListener('change', handleChange);
        finePointerQuery.removeEventListener('change', handleChange);
      };
    }
    if (
      typeof widthQuery.addListener === 'function' &&
      typeof coarseQuery.addListener === 'function' &&
      typeof hoverNoneQuery.addListener === 'function' &&
      typeof finePointerQuery.addListener === 'function'
    ) {
      widthQuery.addListener(handleChange);
      coarseQuery.addListener(handleChange);
      hoverNoneQuery.addListener(handleChange);
      finePointerQuery.addListener(handleChange);
      return () => {
        widthQuery.removeListener(handleChange);
        coarseQuery.removeListener(handleChange);
        hoverNoneQuery.removeListener(handleChange);
        finePointerQuery.removeListener(handleChange);
      };
    }
    return () => {
      // No-op when matchMedia does not support listeners in the current environment.
    };
  }, [scheduleFitToViewport]);

  useEffect(() => {
    if (isMobileSeatMode) {
      setShowMobileEventDetails(false);
      mapFitRequestedRef.current = true;
      scheduleFitToViewport();
      return;
    }
    mapFitRequestedRef.current = false;
  }, [isMobileSeatMode, scheduleFitToViewport]);

  useEffect(() => {
    if (!hasPositions || loading || showContactForm) {
      setOverlayOnlySeatChart(false);
      return undefined;
    }
    const evaluateSeatChartMode = () => {
      const container = seatSelectionContentRef.current;
      if (!container) return;
      const containerHeight = container.clientHeight || container.getBoundingClientRect().height || 0;
      const reservedUiHeight = isMobileSeatMode ? 225 : 185;
      const projectedMapHeight = containerHeight - reservedUiHeight;
      const mustUseOverlay =
        ALWAYS_USE_SEAT_CHART_OVERLAY ||
        (projectedMapHeight > 0 && projectedMapHeight < MIN_INLINE_MAP_HEIGHT);
      setOverlayOnlySeatChart((prev) => (prev === mustUseOverlay ? prev : mustUseOverlay));
      if (!mustUseOverlay && mapFitRequestedRef.current) {
        scheduleFitToViewport();
      }
    };
    const scheduleEvaluateSeatChartMode = () => {
      if (seatSizingDebounceRef.current) {
        clearTimeout(seatSizingDebounceRef.current);
      }
      seatSizingDebounceRef.current = setTimeout(() => {
        seatSizingDebounceRef.current = null;
        evaluateSeatChartMode();
      }, 120);
    };
    evaluateSeatChartMode();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && seatSelectionContentRef.current) {
      observer = new ResizeObserver(() => {
        scheduleEvaluateSeatChartMode();
      });
      observer.observe(seatSelectionContentRef.current);
    }
    window.addEventListener('resize', scheduleEvaluateSeatChartMode);
    window.addEventListener('orientationchange', scheduleEvaluateSeatChartMode);
    return () => {
      window.removeEventListener('resize', scheduleEvaluateSeatChartMode);
      window.removeEventListener('orientationchange', scheduleEvaluateSeatChartMode);
      if (observer) {
        observer.disconnect();
      }
      if (seatSizingDebounceRef.current) {
        clearTimeout(seatSizingDebounceRef.current);
        seatSizingDebounceRef.current = null;
      }
    };
  }, [MIN_INLINE_MAP_HEIGHT, hasPositions, isMobileSeatMode, loading, scheduleFitToViewport, showContactForm]);

  const fetchEventSeating = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/seating/event/${event.id}`);
      seatDebugLog('modal-layout-load-start', { eventId: event.id });
      const data = await res.json();
        if (data.success) {
          setSeatingConfig(data.seating || []);
          setReservedSeats(data.reservedSeats || []);
          setPendingSeats(data.pendingSeats || []);
          setHoldSeats(data.holdSeats || []);
          if (typeof data.seatingEnabled !== 'undefined') {
            setSeatingEnabled(Boolean(data.seatingEnabled));
          }
          seatDebugLog('modal-layout-load-success', {
            eventId: event.id,
            rows: Array.isArray(data.seating) ? data.seating.length : 0,
            reserved: Array.isArray(data.reservedSeats) ? data.reservedSeats.length : 0,
            pending: Array.isArray(data.pendingSeats) ? data.pendingSeats.length : 0,
            hold: Array.isArray(data.holdSeats) ? data.holdSeats.length : 0,
          });
        if (data.stagePosition) {
          setStagePosition(data.stagePosition);
        }
        if (data.stageSize) {
          setStageSize(data.stageSize);
        }
        if (data.canvasSettings) {
          setCanvasSettings({
            width: data.canvasSettings.width || 1200,
            height: data.canvasSettings.height || 800
          });
        }
      } else {
        clearTransientErrorTimer();
        setErrorMessage('Failed to load seating data');
        seatDebugLog('modal-layout-load-error', {
          eventId: event.id,
          message: data.message || 'unknown-error',
        });
      }
    } catch (err) {
      console.error('Failed to fetch event seating:', err);
      clearTransientErrorTimer();
      setErrorMessage('Network error loading seating');
      seatDebugLog('modal-layout-load-error', {
        eventId: event.id,
        message: err.message || 'network-error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSeatInteraction = useCallback(
    (seatId, meta = {}) => {
      if (!seatingEnabled) {
        showTransientError('Seat reservations are temporarily paused for this event.');
        return;
      }
      const seatStatus = seatStatusMap.get(seatId) || 'available';
      const isBlocked = seatStatus === 'reserved' || seatStatus === 'pending' || seatStatus === 'hold';
      seatDebugLog('seat-click', {
        eventId: event.id,
        seatId,
        tableId: meta.tableId || null,
        disabled: isBlocked,
        reason: seatStatus,
      });
      if (isBlocked) {
        if (
          seatDebugEnabled &&
          meta?.dataSeatState &&
          meta.dataSeatState !== seatStatus
        ) {
          seatDebugLog('status-mismatch', {
            seatId,
            renderedState: meta.dataSeatState,
            computedState: seatStatus,
            surface: 'event-modal',
          });
        }
        const message =
          seatStatus === 'reserved'
            ? 'Seat already reserved.'
            : seatStatus === 'hold'
              ? 'Seat currently on a temporary hold.'
              : 'Seat currently pending confirmation.';
        showTransientError(message);
        return;
      }
      setSelectedSeats((prev) => {
        const exists = prev.includes(seatId);
        const next = exists ? prev.filter((s) => s !== seatId) : [...prev, seatId];
        seatDebugLog('seat-selection-updated', {
          eventId: event.id,
          seatId,
          tableId: meta.tableId || null,
          selected: !exists,
          totalSelected: next.length,
        });
        return next;
      });
    },
    [event.id, seatDebugEnabled, seatDebugLog, seatStatusMap, seatingEnabled, showTransientError]
  );

  const handleCancel = () => {
    if (selectedSeats.length > 0 || showContactForm) {
      setShowCancelConfirm(true);
    } else {
      onClose();
    }
  };

  const confirmCancel = () => {
    setShowCancelConfirm(false);
    onClose();
  };

  const handleConfirmSeats = () => {
    if (selectedSeats.length === 0) {
      showTransientError('Please select at least one seat');
      return;
    }
    setShowContactForm(true);
    setErrorMessage('');
    setSuccessMessage('');
    setPostSubmitPaymentReady(false);
    setSubmittedSeatCount(0);
    setSubmittedTotalAmount(null);
    setSubmittedCurrency('USD');
  };

  const handleBackToSeats = () => {
    setShowContactForm(false);
    clearTransientErrorTimer();
    setPostSubmitPaymentReady(false);
    setSubmittedSeatCount(0);
    setSubmittedTotalAmount(null);
    setSubmittedCurrency('USD');
    setSuccessMessage('');
    setForm({
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      specialRequests: ''
    });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage('');
    seatDebugLog('reservation-submit-start', {
      eventId: event.id,
      seatIds: selectedSeats.slice(),
      seatCount: selectedSeats.length,
      requestType: 'event-modal',
      phase3_post_submit_payment_ready: postSubmitPaymentReady,
    });
    
    try {
      const payload = {
        event_id: event.id,
        customer_name: form.customerName,
        contact: { email: form.customerEmail, phone: form.customerPhone },
        selected_seats: selectedSeats,
        special_requests: form.specialRequests
      };
      if (process.env.NODE_ENV !== 'production') {
        console.debug('Seat request payload', payload);
        console.debug('Seat request JSON', JSON.stringify(payload));
      }

      const res = await fetch(`${API_BASE}/seat-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        const submittedCount = selectedSeats.length;
        const apiSeatRequest = data.seat_request || {};
        const apiSeatCount = Number(apiSeatRequest.total_seats);
        const apiTotalAmountRaw = normalizeFiniteNumber(apiSeatRequest.total_amount);
        const computedAmount = apiTotalAmountRaw !== null ? Number(apiTotalAmountRaw.toFixed(2)) : null;
        setPostSubmitPaymentReady(true);
        setSubmittedSeatCount(Number.isFinite(apiSeatCount) && apiSeatCount > 0 ? apiSeatCount : submittedCount);
        setSubmittedTotalAmount(computedAmount);
        setSubmittedCurrency(
          typeof apiSeatRequest.currency === 'string' && apiSeatRequest.currency.trim()
            ? apiSeatRequest.currency.trim().toUpperCase()
            : 'USD'
        );
        setSuccessMessage('Request submitted successfully! We will contact you soon.');
        setSelectedSeats([]);
        setShowContactForm(true);
        fetchEventSeating();
        seatDebugLog('reservation-submit-finish', {
          eventId: event.id,
          seatCount: selectedSeats.length,
          status: res.status,
          success: true,
          phase3_post_submit_payment_ready: true,
        });
      } else {
        clearTransientErrorTimer();
        setErrorMessage(data.message || 'Failed to submit request');
        seatDebugLog('reservation-submit-finish', {
          eventId: event.id,
          seatCount: selectedSeats.length,
          status: res.status,
          success: false,
          reason: data.message || 'server-rejection',
        });
      }
    } catch (err) {
      console.error(err);
      clearTransientErrorTimer();
      setErrorMessage('Network error - please try again');
      seatDebugLog('reservation-submit-error', {
        eventId: event.id,
        seatCount: selectedSeats.length,
        reason: err.message || 'network-error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const paymentSeatLimit = paymentOption?.limit_seats ?? 6;
  const paymentProviderType = paymentOption?.provider_type === 'paypal_hosted_button'
    ? 'paypal_hosted_button'
    : paymentOption?.provider_type === 'paypal_orders'
      ? 'paypal_orders'
      : 'external_link';
  const paymentSeatCount = postSubmitPaymentReady ? submittedSeatCount : selectedSeats.length;
  const showPaymentPanel = postSubmitPaymentReady && paymentOption && !paymentPanelDismissed;
  const paymentOverLimit = showPaymentPanel && paymentSeatCount > paymentSeatLimit;
  const paymentAvailableNotice = Boolean(paymentOption?.enabled ?? paymentOption);
  const paypalContainerId = `paypal-container-${event.id}`;
  const amountDueCurrency = /^[A-Z]{3}$/.test(submittedCurrency || '') ? submittedCurrency : 'USD';
  const amountDueLabel = submittedTotalAmount !== null
    ? new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: amountDueCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(submittedTotalAmount)
    : '';

  useEffect(() => {
    if (!showPaymentPanel) {
      setPaypalRenderError('');
    }
  }, [showPaymentPanel]);

  useEffect(() => {
    if (!showPaymentPanel || paymentOverLimit || paymentProviderType !== 'paypal_hosted_button') {
      return undefined;
    }
    const paypalConfig = paymentOption?.paypal || {};
    const hostedButtonId = String(paypalConfig.hosted_button_id || '').trim();
    const sdkClientId = String(paypalConfig.sdk_client_id || '').trim();
    if (!hostedButtonId || !sdkClientId) {
      setPaypalRenderError('PayPal is temporarily unavailable for this event.');
      return undefined;
    }
    let cancelled = false;
    const clearContainer = () => {
      const container = document.getElementById(paypalContainerId);
      if (container) {
        container.innerHTML = '';
      }
    };
    setPaypalRenderError('');
    clearContainer();
    loadPayPalHostedButtonsSdk({
      clientId: sdkClientId,
      currency: paypalConfig.currency || 'USD',
      enableVenmo: Boolean(paypalConfig.enable_venmo),
    })
      .then((paypal) => {
        if (cancelled) return;
        const container = document.getElementById(paypalContainerId);
        if (!container) return;
        container.innerHTML = '';
        return paypal.HostedButtons({
          hostedButtonId,
        }).render(`#${paypalContainerId}`);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('PayPal hosted button render failed', error);
        setPaypalRenderError('Unable to load PayPal right now. Please contact staff for help with payment.');
      });
    return () => {
      cancelled = true;
      clearContainer();
    };
  }, [paymentOption, paymentOverLimit, paymentProviderType, paypalContainerId, showPaymentPanel]);

  const renderLandmark = (row = {}) => {
    const landmarkKey = row.id || `${row.element_type || 'marker'}-${row.pos_x}-${row.pos_y}`;
    const landmarkType = (row.element_type || 'marker').toLowerCase();
    const isArea = landmarkType === 'area';
    const rotation = row.rotation || 0;
    const width = row.width || (isArea ? 260 : 140);
    const height = row.height || (isArea ? 160 : 70);
    const label = getLandmarkLabel(row);
    const tone = row.color || (isArea ? '#F97316' : '#60A5FA');

    return (
      <div
        key={landmarkKey}
        data-landmark-id={row.id || landmarkKey}
        data-landmark-type={landmarkType}
        className="absolute"
        style={{
          left: `${row.pos_x}%`,
          top: `${row.pos_y}%`,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          zIndex: isArea ? 2 : 3,
          pointerEvents: 'none',
        }}
      >
        <div
          className={`${isArea ? 'rounded-[28px]' : 'rounded-2xl'} flex items-center justify-center px-3 py-2 text-center shadow-lg`}
          style={{
            width,
            height,
            backgroundColor: withAlpha(tone, isArea ? 0.2 : 0.3),
            border: `1px dashed ${withAlpha(tone, 0.74)}`,
            boxShadow: `inset 0 0 0 1px ${withAlpha(tone, 0.14)}, 0 14px 24px rgba(15, 23, 42, 0.16)`,
          }}
        >
          <span
            className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90"
            style={rotation ? { transform: `rotate(${-rotation}deg)` } : undefined}
          >
            {label}
          </span>
        </div>
      </div>
    );
  };

  const legendList = (
    <div className="space-y-4">
      {pricingLegendItems.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Pricing</div>
          <div className="space-y-3">
            {pricingLegendItems.map((tier) => (
              <div key={tier.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 h-8 w-8 rounded-md shrink-0"
                    style={pricingTierDisplayMap.get(tier.id)?.swatchStyle || undefined}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold text-white break-words">
                        {tier.label}
                      </span>
                      <span className="text-sm font-semibold text-amber-100 whitespace-nowrap">
                        {tier.priceLabel}
                      </span>
                    </div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/80 mt-1">
                      {tier.patternLabel}
                    </p>
                  </div>
                </div>
                {tier.note && (
                  <p className="text-xs text-amber-100/90">{tier.note}</p>
                )}
                {tier.locationSummary && (
                  <p className="text-xs text-gray-300">{tier.locationSummary}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {selectedSeatPricing.lineItems.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200">Selected pricing</div>
          <div className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 overflow-hidden">
            <div className="max-h-48 overflow-y-auto divide-y divide-indigo-400/15">
              {selectedSeatPricing.lineItems.map((item) => (
                <div key={item.seatId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span aria-hidden="true" className="h-3.5 w-3.5 rounded-sm shrink-0" style={item.swatchStyle || undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-white truncate">{item.seatLabel}</div>
                    <div className="text-xs text-gray-300 truncate">{item.tierLabel}</div>
                  </div>
                  <span className="text-sm font-semibold text-amber-100 whitespace-nowrap">{item.priceLabel}</span>
                </div>
              ))}
            </div>
            {selectedSeatPricing.total !== null && (
              <div className="flex items-center justify-between gap-3 border-t border-indigo-400/15 px-3 py-2 text-sm font-semibold text-white bg-gray-950/40">
                <span>Running total</span>
                <span className="text-amber-100">{formatCurrencyAmount(selectedSeatPricing.total)}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-200">Seat status</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {legendItems.map((item) => (
            <div className="flex items-center gap-2 min-w-0" key={item.key}>
              <span className={`relative w-6 h-6 rounded ${item.className}`}>
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{item.cueText || ''}</span>
              </span>
              <span className="text-sm text-gray-100 break-words">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSeatWorkspace = ({ expanded = false } = {}) => {
    const mapCanvas = (
      <div
        className={`${expanded ? 'h-full' : 'seat-map-viewport seatingMapViewport'} seat-map-text-lock bg-gray-900 rounded-xl border border-purple-500/20`}
        ref={mapViewportRef}
      >
        <div
          className="seat-map-scroll seatingMapCanvasWrapper relative w-full h-full"
          ref={canvasContainerRef}
        >
          <div
            className="relative mx-auto"
              style={{
                width: canvasWidth,
                height: canvasHeight,
                minWidth: canvasWidth,
                minHeight: canvasHeight,
                transformOrigin: 'top left',
                transform: `translate(${mapTransform.translateX}px, ${mapTransform.translateY}px) scale(${mapTransform.scale})`
              }}
            >
            <div
              className="absolute bg-amber-900 text-amber-100 rounded-lg font-bold shadow-lg z-10 flex items-center justify-center"
              style={{
                left: `${stagePosition.x}%`,
                top: `${stagePosition.y}%`,
                transform: 'translate(-50%, -50%)',
                width: `${stageSize.width || 200}px`,
                height: `${stageSize.height || 80}px`,
                pointerEvents: 'none'
              }}
            >
              STAGE
            </div>

            {decorRows
              .filter((row) => row.pos_x !== null && row.pos_y !== null && row.pos_x !== undefined && row.pos_y !== undefined)
              .map((row) => renderLandmark(row))}

            {seatRows
              .filter((row) => row.pos_x !== null && row.pos_y !== null && row.pos_x !== undefined && row.pos_y !== undefined)
              .map((row) => {
                const rowKey = row.id || `${row.section_name}-${row.row_label}`;
                const tier = resolveRowPricingTier(event, row);
                const tierVisual = tier ? pricingTierDisplayMap.get(tier.id) || null : null;

                return (
                  <div
                    key={rowKey}
                    className="absolute"
                    style={{
                      left: `${row.pos_x}%`,
                      top: `${row.pos_y}%`,
                      transform: 'translate(-50%, -50%)',
                      padding: '20px',
                      minWidth: `${row.width || 120}px`,
                      minHeight: `${row.height || 120}px`,
                      pointerEvents: 'none',
                    }}
                  >
                    {tierVisual && (
                      <div
                        aria-hidden="true"
                        data-tier-row={rowKey}
                        data-tier-pattern={tierVisual.patternId}
                        data-tier-color={tierVisual.color}
                        className="absolute inset-[6px] rounded-[28px]"
                        style={tierVisual.rowStyle}
                      />
                    )}
                    <div className="relative flex items-center justify-center" style={{ minHeight: '60px', pointerEvents: 'auto' }}>
                      <div style={{ transform: `rotate(${row.rotation || 0}deg)` }}>
                        <TableComponent
                          row={row}
                          tableShape={row.table_shape || 'table-6'}
                          selectedSeats={selectedSeats}
                          pendingSeats={pendingSeats}
                          holdSeats={holdSeats}
                          reservedSeats={reservedSeats}
                          seatStatusMap={seatStatusMap}
                          tierVisual={tierVisual ? {
                            id: tierVisual.id,
                            color: tierVisual.color,
                            patternId: tierVisual.patternId,
                            surfaceStyle: tierVisual.surfaceStyle,
                          } : null}
                          onToggleSeat={(seatId, meta = {}) =>
                            handleSeatInteraction(seatId, {
                              ...meta,
                              tableId: rowKey,
                              rowLabel: row.row_label,
                              section: row.section_name || row.section,
                            })
                          }
                          interactive
                          labelFormatter={(rawLabel) => formatSeatLabel(rawLabel, { mode: 'seat' })}
                          textRotation={-(row.rotation || 0)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
        {!seatingEnabled && (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center p-4">
            <div className="mt-6 rounded-xl bg-black/70 text-white border border-amber-400/60 max-w-xl w-full shadow-xl p-4 text-center">
              <p className="text-base font-semibold">Seat reservations are temporarily paused.</p>
              <p className="text-sm text-amber-100 mt-2">
                You can review which seats are already held or reserved, but new requests are disabled while staff finalizes the lineup. Please check back soon or contact the venue for assistance.
              </p>
            </div>
          </div>
        )}
      </div>
    );

    if (expanded) {
      return (
        <div className="relative h-full min-h-0">
          {mapCanvas}
          <div className="pointer-events-none absolute inset-0">
            <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowLargeMap(false)}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-indigo-400/60 bg-gray-950/80 text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-300/70"
                aria-label="Close seating chart"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="pointer-events-auto absolute left-4 bottom-4">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowLargeMapLegend((prev) => !prev)}
                  className="inline-flex items-center justify-center rounded-lg border border-purple-500/60 bg-gray-950/85 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-300/70"
                >
                  Legend
                </button>
                {showLargeMapLegend && (
                  <div className="absolute bottom-12 left-0 w-[260px] max-w-[80vw] rounded-xl border border-purple-500/40 bg-gray-950/95 p-3 shadow-xl">
                    {legendList}
                  </div>
                )}
              </div>
            </div>

            <div className="pointer-events-auto absolute right-4 bottom-4 flex items-center gap-2">
              <span className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-100 border border-indigo-500/40 rounded-md bg-gray-950/85">
                Zoom
              </span>
              <button
                type="button"
                onClick={handleZoomOut}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/50 bg-gray-950/85 text-sm font-semibold text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                aria-label="Zoom out seating map"
              >
                -
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/50 bg-gray-950/85 text-sm font-semibold text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                aria-label="Zoom in seating map"
              >
                +
              </button>
              <button
                type="button"
                onClick={handleFitSeatsClick}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-purple-500/50 bg-gray-950/85 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
              >
                Fit seats to screen
              </button>
            </div>

            {selectedSeats.length > 0 && seatingEnabled && (
              <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-4">
                <div className="rounded-xl border border-indigo-400/60 bg-gray-950/90 px-3 py-2 flex items-center gap-3 shadow-xl">
                  <div className="hidden sm:flex flex-wrap gap-2 max-w-[50vw]">
                    {(selectedSeatPricing.lineItems.length ? selectedSeatPricing.lineItems : selectedSeats.map((seat) => ({
                      seatId: seat,
                      seatLabel: describeSeatSelection(seat, seatLabelFor(seat)),
                    }))).slice(0, 4).map((item) => (
                      <span key={item.seatId} className="inline-flex items-center gap-2 px-2 py-1 bg-purple-600/80 text-white rounded-full text-xs font-medium">
                        {item.swatchStyle && (
                          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm shrink-0" style={item.swatchStyle} />
                        )}
                        <span>{item.seatLabel}</span>
                        {item.tierLabel && (
                          <span className="text-indigo-100/85">{item.tierLabel}</span>
                        )}
                        {item.priceLabel && (
                          <span className="text-amber-100">{item.priceLabel}</span>
                        )}
                      </span>
                    ))}
                    {selectedSeats.length > 4 && (
                      <span className="px-2 py-1 bg-gray-700 text-white rounded-full text-xs font-medium">
                        +{selectedSeats.length - 4}
                      </span>
                    )}
                  </div>
                  {selectedSeatPricing.total !== null && (
                    <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100 whitespace-nowrap">
                      Total {formatCurrencyAmount(selectedSeatPricing.total)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleConfirmSeats}
                    className="inline-flex items-center justify-center rounded-lg border border-indigo-300/70 bg-indigo-600/30 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-300/70"
                  >
                    Confirm seats ({selectedSeats.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col xl:flex-row gap-4 h-full min-h-0 seat-selection-layout">
        <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-[360px] seat-map-column">
          {mapCanvas}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-400 flex-1 min-w-[200px]">
              Drag or pinch inside the map to explore available seats.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-100 border border-indigo-500/40 rounded-md">
                Zoom
              </span>
              <button
                type="button"
                onClick={handleZoomOut}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/50 bg-gray-800 text-sm font-semibold text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                aria-label="Zoom out seating map"
              >
                -
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/50 bg-gray-800 text-sm font-semibold text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                aria-label="Zoom in seating map"
              >
                +
              </button>
              <button
                type="button"
                onClick={openLargeMapOverlay}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-500/50 bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
              >
                Open seating chart
              </button>
              <button
                type="button"
                onClick={handleFitSeatsClick}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-purple-500/50 bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
              >
                Fit seats to screen
              </button>
            </div>
          </div>
          {isMobileSeatMode && (
            <details className="seat-legend-panel seat-legend-panel--mobile bg-gray-900/80 border border-purple-500/30 rounded-xl p-4 text-sm text-gray-200 w-full">
              <summary className="seat-legend-toggle list-none inline-flex w-full items-center justify-center rounded-lg border border-purple-500/50 bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300 cursor-pointer">
                Legend
              </summary>
              <div className="mt-3 seat-legend-content">{legendList}</div>
            </details>
          )}
        </div>
        {!isMobileSeatMode && (
          <aside className="bg-gray-900/80 border border-purple-500/30 rounded-xl p-4 text-sm text-gray-200 w-full xl:w-72 flex-shrink-0 max-h-[320px] xl:max-h-[calc(100vh-10rem)] overflow-y-auto seat-legend-panel">
            <div className="font-semibold mb-3 text-white">Legend</div>
            {legendList}
          </aside>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={!showLargeMap}
        aria-labelledby={showLargeMap ? largeMapTitleId : titleId}
        tabIndex={-1}
        className={`relative bg-gray-900 rounded-xl w-full max-w-7xl h-[90vh] flex flex-col border border-purple-500/30 shadow-2xl focus:outline-none${isMobileSeatMode ? ' seat-selection-mobile' : ''}`}
      >
        {!showLargeMap && (
          <>
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-purple-500/20">
              <div>
                <h2 id={titleId} className="text-3xl font-bold text-white">
                  {event.artist_name || event.title}
                </h2>
                <p className="text-gray-400 mt-1">
                  {eventDateLabel}
                </p>
                {multiDay && multiDayRunSummary && (
                  <p className="text-sm text-amber-200 mt-2">
                    Multi-day run: {multiDayRunSummary}
                  </p>
                )}
                {multiDay && (
                  <p className="text-xs text-gray-400 mt-1">
                    One seat selection covers the full run.
                  </p>
                )}
                {priceSummaryLabel && (
                  <p className="text-sm text-amber-200 mt-2">
                    {priceSummaryLabel}
                  </p>
                )}
              </div>
              <button
                ref={closeButtonRef}
                onClick={handleCancel}
                className="text-gray-400 hover:text-white transition rounded-full hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400 inline-flex h-12 w-12 items-center justify-center"
                aria-label="Close seating selection"
                type="button"
              >
                <X className="h-7 w-7" />
              </button>
            </div>
            <ReservationBanner />

            {hasEventContact && (
              <div className="px-6 py-4 border-b border-purple-500/20 bg-gray-950/40 space-y-3 seat-event-details">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.4em] text-purple-200">Event Contact</p>
                  {isMobileSeatMode && (
                    <button
                      type="button"
                      className="text-xs font-semibold text-purple-200 underline decoration-dotted hover:text-purple-100"
                      aria-expanded={showMobileEventDetails}
                      aria-controls={eventDetailsPanelId}
                      onClick={() => setShowMobileEventDetails((prev) => !prev)}
                    >
                      {showMobileEventDetails ? 'Hide event details' : 'Show event details'}
                    </button>
                  )}
                </div>
                <div
                  id={eventDetailsPanelId}
                  className={`space-y-2${isMobileSeatMode ? ' seat-event-details-panel' : ''}${isMobileSeatMode && !showMobileEventDetails ? ' is-collapsed' : ''}`}
                  aria-hidden={isMobileSeatMode && !showMobileEventDetails}
                >
                  {contactName && <p className="text-lg font-semibold text-white">{contactName}</p>}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    {contactPhone && (
                      <a
                        href={contactPhoneHref || undefined}
                        className={`${CONTACT_LINK_CLASSES} text-white bg-purple-600/20 border border-purple-500/40`}
                        aria-label={`Call ${contactName || 'event contact'} at ${contactPhone}`}
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />
                        <span>{contactPhone}</span>
                      </a>
                    )}
                    {contactEmail && (
                      <a
                        href={`mailto:${contactEmail}`}
                        className={`${CONTACT_LINK_CLASSES} text-white bg-purple-600/20 border border-purple-500/40`}
                        aria-label={`Email ${contactName || 'event contact'} at ${contactEmail}`}
                      >
                        <Mail className="h-4 w-4" aria-hidden="true" />
                        <span>{contactEmail}</span>
                      </a>
                    )}
                  </div>
                  {contactNotes && (
                    <p className="text-sm text-gray-300">{contactNotes}</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin h-16 w-16 border-4 border-purple-500 border-t-transparent rounded-full"></div>
          </div>
        ) : errorMessage && !showContactForm ? (
          <div className="flex-1 flex items-center justify-center p-6" role="alert" aria-live="assertive">
            <div className="text-center">
              <AlertCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
              <p className="text-xl text-red-400">{errorMessage}</p>
            </div>
          </div>
        ) : showContactForm ? (
          // Contact Form View
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto">
              <h3 className="text-2xl font-bold text-white mb-6">
                {postSubmitPaymentReady ? 'Request Submitted' : 'Enter Your Contact Information'}
              </h3>

              {errorMessage && (
                <div className="p-4 mb-6 bg-red-500/20 border border-red-500 text-red-300 rounded-lg" role="alert" aria-live="assertive">
                  {errorMessage}
                </div>
              )}

              {postSubmitPaymentReady ? (
                <div className="space-y-4">
                  {successMessage && (
                    <div className="p-4 bg-green-500/20 border border-green-500 text-green-300 rounded-lg" role="status" aria-live="polite">
                      {successMessage}
                    </div>
                  )}
                  {submittedTotalAmount !== null && (
                    <div className="rounded-lg border border-emerald-500/40 bg-emerald-900/20 px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200">Amount due</p>
                      <p className="text-xl font-semibold text-emerald-100 mt-1">
                        {amountDueLabel}
                      </p>
                    </div>
                  )}
                  {showPaymentPanel && (
                    <div className="rounded-xl border border-indigo-500/40 bg-indigo-900/30 p-4 space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-indigo-100">
                            {paymentOverLimit ? 'Selected seats exceed the online payment limit.' : 'Optional payment step'}
                          </p>
                          <p className="text-xs text-gray-300">
                            {paymentOverLimit
                              ? 'Reach out to staff to pay for larger parties.'
                              : `You can complete payment with ${paymentOption.provider_label || 'our partner'} now.`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPaymentPanelDismissed(true)}
                          className="text-xs text-gray-300 hover:text-white underline decoration-dotted"
                        >
                          Hide
                        </button>
                      </div>
                      {paymentOverLimit ? (
                        <p className="text-sm text-gray-100">
                          {paymentOption.over_limit_message || 'Please call the box office to arrange payment for larger groups.'}
                        </p>
                      ) : (
                        <>
                          {paymentProviderType === 'paypal_hosted_button' ? (
                            <div className="space-y-2">
                              <div id={paypalContainerId} className="min-h-[40px]" />
                              {paypalRenderError && (
                                <p className="text-xs text-amber-200">{paypalRenderError}</p>
                              )}
                            </div>
                          ) : paymentProviderType === 'paypal_orders' ? (
                            <p className="text-sm text-gray-100">
                              Online payment will be available after your request is submitted and approved.
                            </p>
                          ) : (
                            <a
                              href={paymentOption.payment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-300"
                              aria-label="Open payment link in a new tab"
                            >
                              {paymentOption.button_text || 'Pay Online'}
                            </a>
                          )}
                          {paymentOption.fine_print && (
                            <p className="text-xs text-gray-300">{paymentOption.fine_print}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition font-medium"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {paymentAvailableNotice && (
                    <p className="text-xs text-indigo-200">Online payment available after submitting your seat request.</p>
                  )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white mb-2 font-medium" htmlFor={nameInputId}>Your Name *</label>
                    <input 
                      id={nameInputId}
                      name="customerName" 
                      type="text"
                      value={form.customerName} 
                      onChange={handleChange} 
                      className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition" 
                      required 
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <label className="block text-white mb-2 font-medium" htmlFor={emailInputId}>Email (optional)</label>
                    <input 
                      id={emailInputId}
                      name="customerEmail" 
                      type="email" 
                      value={form.customerEmail} 
                      onChange={handleChange} 
                      className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition" 
                      disabled={submitting}
                      placeholder="Helps us send confirmation details"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium" htmlFor={phoneInputId}>Phone *</label>
                  <input 
                    id={phoneInputId}
                    name="customerPhone" 
                    type="tel"
                    value={form.customerPhone} 
                    onChange={handleChange} 
                    className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition" 
                    disabled={submitting}
                    required
                    aria-required="true"
                    aria-describedby={phoneHelpTextId}
                    placeholder="Required so staff can confirm your seats"
                  />
                  <p id={phoneHelpTextId} className="mt-1 text-sm text-gray-400">
                    Required so staff can confirm your seats.
                  </p>
                </div>

                <div>
                  <p id={selectedSeatsId} className="block text-white mb-2 font-medium">
                    Selected Seats ({selectedSeats.length})
                  </p>
                  {selectedSeatPricing.lineItems.length > 0 ? (
                    <div className="rounded-lg border border-amber-500/30 bg-gray-900/60 overflow-hidden" role="list" aria-labelledby={selectedSeatsId}>
                      <div className="max-h-56 overflow-y-auto divide-y divide-amber-400/15">
                        {selectedSeatPricing.lineItems.map((item) => (
                          <div key={item.seatId} className="flex items-center gap-3 px-4 py-3 text-sm" role="listitem">
                            <span aria-hidden="true" className="h-4 w-4 rounded-sm shrink-0" style={item.swatchStyle || undefined} />
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-white truncate">{item.seatLabel}</div>
                              <div className="text-xs text-gray-300 truncate">{item.tierLabel}</div>
                            </div>
                            <span className="font-semibold text-amber-100 whitespace-nowrap">{item.priceLabel}</span>
                          </div>
                        ))}
                      </div>
                      {selectedSeatPricing.total !== null && (
                        <div className="flex items-center justify-between gap-3 border-t border-amber-400/15 bg-amber-500/10 px-4 py-3">
                          <span className="text-sm font-semibold text-white">Running total</span>
                          <span className="text-sm font-semibold text-amber-100">
                            {formatCurrencyAmount(selectedSeatPricing.total)}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className="flex flex-wrap gap-2 p-4 bg-gray-800 rounded-lg border border-gray-700 min-h-[60px]"
                      role="list"
                      aria-labelledby={selectedSeatsId}
                    >
                      {selectedSeats.map((seatId) => (
                        <div key={seatId} className="px-3 py-1 bg-purple-600 text-white rounded-full text-sm font-medium" role="listitem">
                          {describeSeatSelection(seatId, seatLabelFor(seatId))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium" htmlFor={specialRequestsId}>Special Requests</label>
                  <textarea 
                    id={specialRequestsId}
                    name="specialRequests" 
                    value={form.specialRequests} 
                    onChange={handleChange} 
                    className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition resize-none" 
                    rows={4}
                    placeholder="Any special requirements or notes..."
                    disabled={submitting}
                  />
                </div>

                <div className="flex justify-between items-center pt-4 gap-4">
                  <button 
                    type="button" 
                    onClick={handleBackToSeats}
                    className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition font-medium"
                    disabled={submitting}
                  >
                    Back to Seats
                  </button>
                  <button 
                    type="submit" 
                    disabled={submitting}
                    className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition font-medium flex items-center gap-2"
                  >
                    <Send className="h-5 w-5" />
                    {submitting ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
                </form>
              )}
            </div>
          </div>
        ) : (
          // Seating Chart View
          <div ref={seatSelectionContentRef} className="flex-1 overflow-hidden p-6 min-h-0 seat-selection-content">
            {!hasPositions ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <AlertCircle className="h-16 w-16 mx-auto mb-4" />
                  <p className="text-xl">No seating layout available for this event</p>
                </div>
              </div>
            ) : (
              showLargeMap ? (
                <div className="h-full rounded-xl border border-indigo-500/30 bg-gray-950/40" aria-hidden="true" />
              ) : overlayOnlySeatChart ? (
                <button
                  type="button"
                  onClick={openLargeMapOverlay}
                  className="h-full w-full rounded-xl border border-indigo-500/30 bg-gray-950/70 p-6 text-left focus:outline-none focus:ring-2 focus:ring-indigo-300/70"
                  aria-label="Open full seating chart"
                >
                  <div className="relative h-full rounded-xl border border-indigo-500/20 bg-gradient-to-br from-gray-950 to-indigo-950/70 overflow-hidden">
                    <div className="absolute inset-0 bg-black/35" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-4">
                      <h3 className="text-2xl font-semibold text-white">Open full seating chart</h3>
                      <p className="max-w-2xl text-sm text-gray-200">
                        Click anywhere to enter the full chart view, pick seats, and confirm.
                      </p>
                      <span className="inline-flex items-center justify-center rounded-lg border border-indigo-400/60 bg-indigo-600/30 px-5 py-3 text-sm font-semibold text-white">
                        Open full seating chart
                      </span>
                    </div>
                  </div>
                </button>
              ) : (
                renderSeatWorkspace()
              )
            )}
          </div>
        )}

        {showLargeMap && hasPositions && !showContactForm && (
          <div
            ref={largeMapOverlayRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={largeMapTitleId}
            tabIndex={-1}
            className="fixed inset-0 z-[70] bg-black/70 p-3 sm:p-5 md:p-6 focus:outline-none"
          >
            <h3 id={largeMapTitleId} className="sr-only">Seating chart</h3>
            <div className="h-full w-full min-h-0 overflow-hidden rounded-xl border border-indigo-500/40 bg-gray-950 shadow-2xl">
              {renderSeatWorkspace({ expanded: true })}
            </div>
          </div>
        )}

        {/* Footer Buttons - Only show when not in contact form */}
        {!showContactForm && !loading && hasPositions && !showLargeMap && (
          <div className="p-6 border-t border-purple-500/20 bg-gray-900/50 flex flex-col gap-4 md:flex-row md:items-center md:justify-between seat-action-bar">
            <div className="flex-1">
              <div className="text-sm uppercase tracking-wide text-gray-400">Selected Seats</div>
              {paymentAvailableNotice && selectedSeats.length === 0 && (
                <p className="mt-2 text-xs text-indigo-200">Online payment available after submitting your seat request.</p>
              )}
              {selectedSeats.length > 0 ? (
                <>
                  {selectedSeatPricing.lineItems.length > 0 ? (
                    <div className="mt-3 rounded-xl border border-amber-500/25 bg-gray-950/35 overflow-hidden">
                      <div className="max-h-40 overflow-y-auto divide-y divide-amber-400/10">
                        {selectedSeatPricing.lineItems.map((item) => (
                          <div key={item.seatId} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <span aria-hidden="true" className="h-3.5 w-3.5 rounded-sm shrink-0" style={item.swatchStyle || undefined} />
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-white truncate">{item.seatLabel}</div>
                              <div className="text-xs text-gray-300 truncate">{item.tierLabel}</div>
                            </div>
                            <span className="font-semibold text-amber-100 whitespace-nowrap">{item.priceLabel}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedSeats.slice(0, 6).map((seat) => (
                        <span key={seat} className="px-3 py-1 bg-purple-600/80 text-white rounded-full text-sm font-medium">
                          {describeSeatSelection(seat, seatLabelFor(seat))}
                        </span>
                      ))}
                      {selectedSeats.length > 6 && (
                        <span className="text-gray-400 text-sm">+{selectedSeats.length - 6} more</span>
                      )}
                    </div>
                  )}
                  {selectedSeatPricing.total !== null && (
                    <p className="mt-3 text-sm font-semibold text-amber-200">
                      Running total {formatCurrencyAmount(selectedSeatPricing.total)}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-gray-200">
                  {seatingEnabled ? 'Pick seats on the map to continue.' : 'Seat selection is disabled right now, but you can still review the map.'}
                </p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleCancel}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSeats}
                disabled={selectedSeats.length === 0 || !seatingEnabled}
                className="px-8 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition font-medium text-lg"
              >
                {seatingEnabled
                  ? `Confirm Selection (${selectedSeats.length} ${selectedSeats.length === 1 ? 'seat' : 'seats'})`
                  : 'Temporarily Unavailable'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Dialog */}
      {showCancelConfirm && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 border border-purple-500/30 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4">Cancel Seat Selection?</h3>
            <p className="text-gray-300 mb-6">
              {showContactForm 
                ? 'Are you sure you want to cancel? Your contact information will be lost.'
                : 'Are you sure you want to cancel? Your selected seats will be lost.'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition font-medium"
              >
                No, Keep Going
              </button>
              <button
                onClick={confirmCancel}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium"
              >
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
  function normalizeFiniteNumber(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
