import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { X, Send, AlertCircle, Phone, Mail } from 'lucide-react';
import TableComponent from './TableComponent';
import { API_BASE } from '../apiConfig';
import { buildSeatLegendItems, buildSeatStatusMap } from '../utils/seatingTheme';
import useFocusTrap from '../utils/useFocusTrap';
import { buildSeatLookupMap, describeSeatSelection, isSeatRow } from '../utils/seatLabelUtils';
import { CONTACT_LINK_CLASSES, formatPhoneHref } from '../utils/contactLinks';
import { filterUnavailableSeats } from '../utils/seatAvailability';
import { useSeatDebugLogger, useSeatDebugProbe } from '../hooks/useSeatDebug';

const publicSeatLabel = (label = '') => {
  const safe = String(label || '').trim();
  if (!safe) return '';
  const idx = safe.lastIndexOf(' - ');
  return idx >= 0 ? safe.slice(idx + 3).trim() : safe;
};

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
  const paymentOption = event?.payment_option || null;
  const [paymentPanelDismissed, setPaymentPanelDismissed] = useState(false);
  const [stagePosition, setStagePosition] = useState({ x: 50, y: 10 });
  const [stageSize, setStageSize] = useState({ width: 200, height: 80 });
  const [canvasSettings, setCanvasSettings] = useState({ width: 1200, height: 800 });
  const [seatingEnabled, setSeatingEnabled] = useState(() => Number(event.seating_enabled) === 1);
  const [mapTransform, setMapTransform] = useState({ scale: 1, translateX: 0, translateY: 0 });
  const canvasContainerRef = useRef(null);
  const mapViewportRef = useRef(null);
  const mapFitRequestedRef = useRef(false);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
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
    () => seatingConfig.filter((row) => row.is_active !== false && isSeatRow(row)),
    [seatingConfig]
  );
  const seatLabelMap = useMemo(() => buildSeatLookupMap(activeRows), [activeRows]);
  const seatLabelFor = (seatId) => publicSeatLabel(seatLabelMap[seatId] || seatId);
  const canvasWidth = canvasSettings?.width || 1200;
  const canvasHeight = canvasSettings?.height || 800;
  const hasPositions = useMemo(
    () =>
      activeRows.some(
        (r) =>
          r.pos_x !== null &&
          r.pos_y !== null &&
          r.pos_x !== undefined &&
          r.pos_y !== undefined
      ),
    [activeRows]
  );

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

  const fitSeatsToViewport = useCallback(() => {
    if (!hasPositions) return;
    const viewport = mapViewportRef.current;
    const scrollContainer = canvasContainerRef.current;
    if (!viewport || !scrollContainer) return;
    const viewportWidth = viewport.clientWidth || 0;
    const viewportHeight = viewport.clientHeight || 0;
    if (!viewportWidth || !viewportHeight) return;
    const scale = Math.min(viewportWidth / canvasWidth, viewportHeight / canvasHeight, 1);
    const translateX = scale === 1 ? 0 : (viewportWidth - canvasWidth * scale) / 2;
    const translateY = scale === 1 ? 0 : (viewportHeight - canvasHeight * scale) / 2;
    scrollContainer.scrollTop = 0;
    scrollContainer.scrollLeft = 0;
    setMapTransform({ scale, translateX, translateY });
  }, [canvasHeight, canvasWidth, hasPositions]);

  const handleFitSeatsClick = useCallback(() => {
    mapFitRequestedRef.current = true;
    fitSeatsToViewport();
  }, [fitSeatsToViewport]);

  useEffect(() => {
    const handleResize = () => {
      if (mapFitRequestedRef.current) {
        fitSeatsToViewport();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [fitSeatsToViewport]);

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
  };

  const handleBackToSeats = () => {
    setShowContactForm(false);
    clearTransientErrorTimer();
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
        setSuccessMessage('Request submitted successfully! We will contact you soon.');
        setSelectedSeats([]);
        setShowContactForm(false);
        fetchEventSeating();
        seatDebugLog('reservation-submit-finish', {
          eventId: event.id,
          seatCount: selectedSeats.length,
          status: res.status,
          success: true,
        });
        setTimeout(() => {
          onClose();
        }, 2000);
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

  const paymentSeatLimit = paymentOption?.limit_seats ?? 2;
  const showPaymentPanel = showContactForm && paymentOption && !paymentPanelDismissed;
  const paymentOverLimit = showPaymentPanel && selectedSeats.length > paymentSeatLimit;

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-gray-900 rounded-xl w-full max-w-7xl h-[90vh] flex flex-col border border-purple-500/30 shadow-2xl focus:outline-none"
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-purple-500/20">
          <div>
            <h2 id={titleId} className="text-3xl font-bold text-white">
              {event.artist_name || event.title}
            </h2>
            <p className="text-gray-400 mt-1">
              {new Date(event.start_datetime || event.event_date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </p>
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

        {hasEventContact && (
          <div className="px-6 py-4 border-b border-purple-500/20 bg-gray-950/40 space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-purple-200">Event Contact</p>
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
              <h3 className="text-2xl font-bold text-white mb-6">Enter Your Contact Information</h3>

              {showPaymentPanel && (
                <div className="mb-6 rounded-xl border border-indigo-500/40 bg-indigo-900/30 p-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-indigo-100">
                        {paymentOverLimit ? 'Selected seats exceed the online payment limit.' : 'Optional payment step'}
                      </p>
                      <p className="text-xs text-gray-300">
                        {paymentOverLimit
                          ? 'Reach out to staff to pay for larger parties.'
                          : `You can complete payment with ${paymentOption.provider_label || 'our partner'} after submitting your request.`}
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
                      <a
                        href={paymentOption.payment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-semibold text-white hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-300"
                        aria-label="Open payment link in a new tab"
                      >
                        {paymentOption.button_text || 'Pay Online'}
                      </a>
                      {paymentOption.fine_print && (
                        <p className="text-xs text-gray-300">{paymentOption.fine_print}</p>
                      )}
                    </>
                  )}
                </div>
              )}
              
              {successMessage && (
                <div className="p-4 mb-6 bg-green-500/20 border border-green-500 text-green-300 rounded-lg" role="status" aria-live="polite">
                  {successMessage}
                </div>
              )}

              {errorMessage && (
                <div className="p-4 mb-6 bg-red-500/20 border border-red-500 text-red-300 rounded-lg" role="alert" aria-live="assertive">
                  {errorMessage}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
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
            </div>
          </div>
        ) : (
          // Seating Chart View
          <div className="flex-1 overflow-hidden p-6">
            {!hasPositions ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <AlertCircle className="h-16 w-16 mx-auto mb-4" />
                  <p className="text-xl">No seating layout available for this event</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col xl:flex-row gap-4 h-full">
                <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-[360px]">
                  <div
                    className="seat-map-viewport seat-map-text-lock bg-gray-100 dark:bg-gray-900 rounded-xl border border-purple-500/20"
                    ref={mapViewportRef}
                  >
                    <div
                      className="seat-map-scroll relative w-full h-full"
                      ref={canvasContainerRef}
                      style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
                    >
                      <div
                        className="relative mx-auto"
                        style={{
                          width: canvasWidth,
                          height: canvasHeight,
                          minWidth: canvasWidth,
                          minHeight: canvasHeight,
                          transformOrigin: 'top left',
                          transform: `scale(${mapTransform.scale}) translate(${mapTransform.translateX}px, ${mapTransform.translateY}px)`
                        }}
                      >
                        {/* Stage */}
                        <div 
                          className="absolute bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 rounded-lg font-bold shadow-lg z-10 flex items-center justify-center"
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

                        {/* Tables */}
                        {activeRows.map(row => {
                          if (row.pos_x === null || row.pos_y === null || row.pos_x === undefined || row.pos_y === undefined) return null;
                          return (
                            <div
                              key={row.id}
                              className="absolute"
                              style={{
                                left: `${row.pos_x}%`,
                                top: `${row.pos_y}%`,
                                transform: `translate(-50%, -50%)`,
                                padding: '20px',
                                minWidth: `${row.width || 120}px`,
                                minHeight: `${row.height || 120}px`,
                                pointerEvents: 'none'
                              }}
                            >
                              <div className="flex items-center justify-center" style={{ minHeight: '60px', pointerEvents: 'auto' }}>
                                <div style={{ transform: `rotate(${row.rotation || 0}deg)` }}>
                                  <TableComponent
                                    row={row}
                                    tableShape={row.table_shape || 'table-6'}
                                    selectedSeats={selectedSeats}
                                    pendingSeats={pendingSeats}
                                    holdSeats={holdSeats}
                                    reservedSeats={reservedSeats}
                                    seatStatusMap={seatStatusMap}
                                    onToggleSeat={(seatId, meta = {}) =>
                                      handleSeatInteraction(seatId, {
                                        ...meta,
                                        tableId: row?.id || `${row.section_name}-${row.row_label}`,
                                        rowLabel: row.row_label,
                                        section: row.section_name || row.section,
                                      })
                                    }
                                    interactive
                                    labelFormatter={publicSeatLabel}
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-gray-400 flex-1 min-w-[200px]">
                      Drag or pinch inside the map to explore available seats.
                    </p>
                    <button
                      type="button"
                      onClick={handleFitSeatsClick}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-purple-500/50 bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400/60"
                    >
                      Fit seats to screen
                    </button>
                  </div>
                </div>
                <aside className="bg-gray-900/80 border border-purple-500/30 rounded-xl p-4 text-sm text-gray-200 w-full xl:w-72 flex-shrink-0 max-h-[320px] xl:max-h-[calc(100vh-10rem)] overflow-y-auto">
                  <div className="font-semibold mb-3 text-white">Legend</div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    {legendItems.map((item) => (
                      <div className="flex items-center gap-2 min-w-0" key={item.key}>
                        <span className={`w-6 h-6 rounded ${item.className}`} />
                        <span className="text-sm text-gray-100 break-words">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </aside>
              </div>
            )}
          </div>
        )}

        {/* Footer Buttons - Only show when not in contact form */}
        {!showContactForm && !loading && hasPositions && (
          <div className="p-6 border-t border-purple-500/20 bg-gray-900/50 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex-1">
              <div className="text-sm uppercase tracking-wide text-gray-400">Selected Seats</div>
                  {selectedSeats.length > 0 ? (
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
