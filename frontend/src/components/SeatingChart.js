import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Send, X, AlertCircle } from 'lucide-react';
import TableComponent from './TableComponent';
import { API_BASE } from '../apiConfig';
import { buildSeatLookupMap, describeSeatSelection, isSeatRow, seatIdsForRow, resolveRowHeaderLabels } from '../utils/seatLabelUtils';
import { filterUnavailableSeats, resolveSeatDisableReason } from '../utils/seatAvailability';
import { useSeatDebugLogger, useSeatDebugProbe } from '../hooks/useSeatDebug';

const DEFAULT_STAGE_POSITION = { x: 50, y: 8 };
const DEFAULT_STAGE_SIZE = { width: 200, height: 80 };
const DEFAULT_CANVAS = { width: 1200, height: 800 };

/**
 * SeatingChart
 * Shared renderer for the public seating reference section and the interactive
 * seat-request surface. When `eventId` is provided it automatically loads the
 * event-specific layout via `/api/seating/event/:id` to keep the public view in
 * sync with the admin editor. Without an event id it will attempt to load the
 * default layout template so the homepage always reflects the latest layout.
 */
export default function SeatingChart({
  seatingConfig,
  events = [],
  interactive = true,
  reservedSeats,
  pendingSeats,
  eventId = null,
  autoFetch = true,
  showLegend = true,
  showHeader = true,
  stagePosition: providedStagePosition,
  stageSize: providedStageSize,
  canvasSettings: providedCanvasSettings,
}) {
  const externalLayoutProvided = Array.isArray(seatingConfig) && seatingConfig.length > 0;
  const externalReservedProvided = Array.isArray(reservedSeats);
  const externalPendingProvided = Array.isArray(pendingSeats);

  const [layoutRows, setLayoutRows] = useState(externalLayoutProvided ? seatingConfig : []);
  const [reservedSeatIds, setReservedSeatIds] = useState(externalReservedProvided ? reservedSeats : []);
  const [pendingSeatIds, setPendingSeatIds] = useState(externalPendingProvided ? pendingSeats : []);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [layoutRefreshToken, setLayoutRefreshToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    specialRequests: '',
    eventId: eventId || (events[0]?.id ?? ''),
  });
  const formEventId = form.eventId;
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [layoutError, setLayoutError] = useState('');
  const [layoutLoading, setLayoutLoading] = useState(() => {
    if (!autoFetch) return false;
    if (eventId) return true;
    return !externalLayoutProvided;
  });
  const [stagePosition, setStagePosition] = useState(
    providedStagePosition || DEFAULT_STAGE_POSITION
  );
  const [stageSize, setStageSize] = useState(providedStageSize || DEFAULT_STAGE_SIZE);
  const [canvasSettings, setCanvasSettings] = useState(
    providedCanvasSettings || DEFAULT_CANVAS
  );
  const errorResetTimer = useRef(null);
  const seatingSurfaceRef = useRef(null);
  const seatDebug = useSeatDebugLogger('public');
  const { log: seatDebugLog } = seatDebug;
  useSeatDebugProbe(seatingSurfaceRef, seatDebug);

  const clearTransientErrorTimer = useCallback(() => {
    if (errorResetTimer.current) {
      clearTimeout(errorResetTimer.current);
      errorResetTimer.current = null;
    }
  }, []);

  const showTransientError = useCallback(
    (message) => {
      setErrorMessage(message);
      clearTransientErrorTimer();
      errorResetTimer.current = setTimeout(() => {
        setErrorMessage('');
        errorResetTimer.current = null;
      }, 2500);
    },
    [clearTransientErrorTimer]
  );

  useEffect(
    () => () => {
      clearTransientErrorTimer();
    },
    [clearTransientErrorTimer]
  );

  useEffect(() => {
    if (externalLayoutProvided) {
      setLayoutRows(seatingConfig);
      setLayoutLoading(false);
    }
  }, [externalLayoutProvided, seatingConfig]);

  useEffect(() => {
    if (providedStagePosition) {
      setStagePosition(providedStagePosition);
    }
  }, [providedStagePosition]);

  useEffect(() => {
    if (providedStageSize) {
      setStageSize(providedStageSize);
    }
  }, [providedStageSize]);

  useEffect(() => {
    if (providedCanvasSettings) {
      setCanvasSettings({
        width: providedCanvasSettings.width || DEFAULT_CANVAS.width,
        height: providedCanvasSettings.height || DEFAULT_CANVAS.height,
      });
    }
  }, [providedCanvasSettings]);

  useEffect(() => {
    if (externalReservedProvided) {
      setReservedSeatIds(reservedSeats || []);
    }
  }, [externalReservedProvided, reservedSeats]);

  useEffect(() => {
    if (externalPendingProvided) {
      setPendingSeatIds(pendingSeats || []);
    }
  }, [externalPendingProvided, pendingSeats]);

  useEffect(() => {
    let cancelled = false;
    const shouldLoadDefault = !eventId && !externalLayoutProvided && autoFetch;
    const shouldLoadEvent = Boolean(eventId) && autoFetch;
    if (!shouldLoadDefault && !shouldLoadEvent) {
      setLayoutLoading(false);
      return () => {};
    }

    const loadLayout = async () => {
      setLayoutLoading(true);
      setLayoutError('');
      try {
        const endpoint = eventId
          ? `${API_BASE}/seating/event/${eventId}`
          : `${API_BASE}/seating-layouts/default`;
        seatDebugLog('layout-load-start', {
          eventId: eventId || null,
          refreshToken: layoutRefreshToken,
          endpoint,
        });
        const res = await fetch(endpoint);
        const data = await res.json();
        if (cancelled) return;

        if (!data.success) {
          setLayoutError(data.message || 'Unable to load seating layout');
          setLayoutRows([]);
          seatDebugLog('layout-load-error', {
            eventId: eventId || null,
            refreshToken: layoutRefreshToken,
            message: data.message || 'unknown-error',
            status: res.status,
          });
          return;
        }

        if (eventId) {
          setLayoutRows(Array.isArray(data.seating) ? data.seating : []);
          setReservedSeatIds(Array.isArray(data.reservedSeats) ? data.reservedSeats : []);
          setPendingSeatIds(Array.isArray(data.pendingSeats) ? data.pendingSeats : []);
          seatDebugLog('layout-load-success', {
            eventId,
            refreshToken: layoutRefreshToken,
            rows: Array.isArray(data.seating) ? data.seating.length : 0,
            reserved: Array.isArray(data.reservedSeats) ? data.reservedSeats.length : 0,
            pending: Array.isArray(data.pendingSeats) ? data.pendingSeats.length : 0,
          });
          if (data.stagePosition) {
            setStagePosition({
              x: data.stagePosition.x ?? DEFAULT_STAGE_POSITION.x,
              y: data.stagePosition.y ?? DEFAULT_STAGE_POSITION.y,
            });
          }
          if (data.stageSize) {
            setStageSize({
              width: data.stageSize.width ?? DEFAULT_STAGE_SIZE.width,
              height: data.stageSize.height ?? DEFAULT_STAGE_SIZE.height,
            });
          }
          if (data.canvasSettings) {
            setCanvasSettings({
              width: data.canvasSettings.width || DEFAULT_CANVAS.width,
              height: data.canvasSettings.height || DEFAULT_CANVAS.height,
            });
          }
        } else if (data.layout) {
          setLayoutRows(Array.isArray(data.layout.layout_data) ? data.layout.layout_data : []);
          seatDebugLog('layout-load-success', {
            eventId: null,
            refreshToken: layoutRefreshToken,
            rows: Array.isArray(data.layout.layout_data) ? data.layout.layout_data.length : 0,
            reserved: 0,
            pending: 0,
          });
          if (data.layout.stage_position) {
            setStagePosition({
              x: data.layout.stage_position.x ?? DEFAULT_STAGE_POSITION.x,
              y: data.layout.stage_position.y ?? DEFAULT_STAGE_POSITION.y,
            });
          }
          if (data.layout.stage_size) {
            setStageSize({
              width: data.layout.stage_size.width ?? DEFAULT_STAGE_SIZE.width,
              height: data.layout.stage_size.height ?? DEFAULT_STAGE_SIZE.height,
            });
          }
          if (data.layout.canvas_settings) {
            setCanvasSettings({
              width: data.layout.canvas_settings.width || DEFAULT_CANVAS.width,
              height: data.layout.canvas_settings.height || DEFAULT_CANVAS.height,
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLayoutError('Network error while loading seating layout');
          setLayoutRows([]);
          seatDebugLog('layout-load-error', {
            eventId: eventId || null,
            refreshToken: layoutRefreshToken,
            message: err.message || 'network-error',
          });
        }
      } finally {
        if (!cancelled) {
          setLayoutLoading(false);
        }
      }
    };

    loadLayout();
    return () => {
      cancelled = true;
    };
  }, [autoFetch, eventId, externalLayoutProvided, layoutRefreshToken, seatDebugLog]);

  useEffect(() => {
    if (!eventId && events[0]?.id) {
      setForm((prev) => (prev.eventId ? prev : { ...prev, eventId: events[0].id }));
    }
  }, [eventId, events]);

  const activeRows = useMemo(
    () => (layoutRows || []).filter((row) => row && row.is_active !== false && isSeatRow(row)),
    [layoutRows]
  );

  const seatLabelMap = useMemo(() => buildSeatLookupMap(activeRows), [activeRows]);
  const reservedSeatSet = useMemo(() => new Set(reservedSeatIds || []), [reservedSeatIds]);
  const pendingSeatSet = useMemo(() => new Set(pendingSeatIds || []), [pendingSeatIds]);

  useEffect(() => {
    setSelectedSeats((prev) => {
      const filtered = filterUnavailableSeats(prev, reservedSeatSet, pendingSeatSet);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [pendingSeatSet, reservedSeatSet]);

  useEffect(() => {
    setSelectedSeats((prev) => (prev.length ? [] : prev));
  }, [eventId, formEventId]);

  const hasPositions = activeRows.some(
    (row) =>
      row &&
      row.pos_x !== null &&
      row.pos_y !== null &&
      row.pos_x !== undefined &&
      row.pos_y !== undefined
  );

  const resolvedEventId = eventId || formEventId || (events[0]?.id ?? null);

  const handleSeatInteraction = useCallback(
    (seatId, meta = {}) => {
      if (!interactive) return;
      const reason = resolveSeatDisableReason(seatId, reservedSeatSet, pendingSeatSet);
      seatDebugLog('seat-click', {
        eventId: resolvedEventId,
        seatId,
        tableId: meta.tableId || null,
        disabled: Boolean(reason),
        reason: reason || 'available',
      });
      if (reason) {
        const message =
          reason === 'reserved'
            ? 'That seat is already reserved.'
            : 'That seat currently has a pending request.';
        showTransientError(message);
        return;
      }
      setSelectedSeats((prev) => {
        const exists = prev.includes(seatId);
        const next = exists ? prev.filter((id) => id !== seatId) : [...prev, seatId];
        seatDebugLog('seat-selection-updated', {
          eventId: resolvedEventId,
          seatId,
          tableId: meta.tableId || null,
          selected: !exists,
          totalSelected: next.length,
        });
        return next;
      });
    },
    [interactive, pendingSeatSet, reservedSeatSet, resolvedEventId, seatDebugLog, showTransientError]
  );

  const openRequestModal = () => {
    if (!interactive) return;
    if (selectedSeats.length === 0) {
      showTransientError('Select at least one seat before requesting.');
      return;
    }
    if (!eventId && !form.eventId) {
      showTransientError('Select an event before requesting seats.');
      return;
    }
    setShowModal(true);
    setSuccessMessage('');
    setErrorMessage('');
  };

  const closeModal = () => setShowModal(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage('');
    seatDebugLog('reservation-submit-start', {
      eventId: resolvedEventId,
      seatIds: selectedSeats.slice(),
      seatCount: selectedSeats.length,
      requestType: 'public',
    });

    if (!resolvedEventId) {
      showTransientError('Please select an event.');
      seatDebugLog('reservation-submit-abort', { reason: 'missing_event' });
      setSubmitting(false);
      return;
    }

    try {
      const payload = {
        event_id: resolvedEventId,
        customer_name: form.customerName,
        contact: { email: form.customerEmail, phone: form.customerPhone },
        selected_seats: selectedSeats,
        special_requests: form.specialRequests,
      };

      const res = await fetch(`${API_BASE}/seat-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMessage('Request submitted. We will follow up soon.');
        setSelectedSeats([]);
        setLayoutRefreshToken((prev) => prev + 1);
        seatDebugLog('reservation-submit-finish', {
          eventId: resolvedEventId,
          seatCount: selectedSeats.length,
          status: res.status,
          success: true,
        });
        setTimeout(() => {
          setShowModal(false);
          setSuccessMessage('');
        }, 2200);
      } else {
        clearTransientErrorTimer();
        setErrorMessage(data.message || 'Failed to submit request');
        seatDebugLog('reservation-submit-finish', {
          eventId: resolvedEventId,
          seatCount: selectedSeats.length,
          status: res.status,
          success: false,
          reason: data.message || 'server-rejection',
        });
      }
    } catch (err) {
      clearTransientErrorTimer();
      setErrorMessage('Network error - please try again');
      seatDebugLog('reservation-submit-error', {
        eventId: resolvedEventId,
        seatCount: selectedSeats.length,
        reason: err.message || 'network-error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const renderLayoutBody = () => {
    if (layoutLoading) {
      return (
        <div className="flex items-center justify-center h-[320px]">
          <div className="animate-spin h-12 w-12 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      );
    }

    if (layoutError) {
      return (
        <div className="flex flex-col items-center justify-center text-center text-red-300 py-10 gap-3">
          <AlertCircle className="h-10 w-10" />
          <p>{layoutError}</p>
        </div>
      );
    }

    if (!hasPositions) {
      return (
        <div className="text-center py-12 text-gray-400">
          Layout not available. Contact the admin team for assistance.
        </div>
      );
    }

    return (
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="relative flex-1">
          <div
            ref={seatingSurfaceRef}
            className="relative bg-gray-900 rounded-xl p-6 border border-purple-500/20 overflow-auto min-h-[360px]"
            style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y' }}
          >
            <div
              className="relative mx-auto"
              style={{
                width: canvasSettings.width,
                height: canvasSettings.height,
                minWidth: canvasSettings.width,
                minHeight: canvasSettings.height,
              }}
            >
              <div
                className="absolute inset-0 rounded-[32px] border border-gray-700/60 pointer-events-none"
                style={{
                  boxShadow: 'inset 0 0 35px rgba(0,0,0,0.55)',
                }}
                aria-hidden="true"
              />
              <div
                className="absolute bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 rounded-lg font-bold shadow-lg z-10 flex items-center justify-center"
                style={{
                  left: `${stagePosition.x}%`,
                  top: `${stagePosition.y}%`,
                  transform: 'translate(-50%, -50%)',
                  width: `${stageSize.width || DEFAULT_STAGE_SIZE.width}px`,
                  height: `${stageSize.height || DEFAULT_STAGE_SIZE.height}px`,
                  pointerEvents: 'none',
                }}
              >
                STAGE
              </div>

              {activeRows.map((row) => {
                if (
                  row.pos_x === null ||
                  row.pos_y === null ||
                  row.pos_x === undefined ||
                  row.pos_y === undefined
                ) {
                  return null;
                }

                const rowKey = row.id || `${row.section_name}-${row.row_label}`;
                const rotation = row.rotation || 0;
                const elementType = (row.element_type || 'table').toLowerCase();
                const baseWidth = row.width || (elementType === 'chair' ? 56 : 140);
                const baseHeight = row.height || (elementType === 'chair' ? 56 : 120);
                const minDimension = elementType === 'chair' ? 48 : 100;
                const width = Math.max(baseWidth, minDimension);
                const height = Math.max(baseHeight, minDimension);
                const seatIds = seatIdsForRow(row);
                const reservedForRow = seatIds.filter((seatId) => reservedSeatSet.has(seatId));
                const pendingForRow = seatIds.filter((seatId) => pendingSeatSet.has(seatId));
                const labels = resolveRowHeaderLabels(row);
                const paddingValue = elementType === 'chair' ? '8px 6px' : '14px 10px';

                return (
                  <div
                    key={rowKey}
                    className="absolute"
                    style={{
                      left: `${row.pos_x}%`,
                      top: `${row.pos_y}%`,
                      transform: 'translate(-50%, -50%)',
                      minWidth: `${width}px`,
                      minHeight: `${height}px`,
                      padding: paddingValue,
                      pointerEvents: 'none',
                    }}
                  >
                    {(labels.sectionLabel || labels.rowLabel) && (
                      <div className="absolute -top-6 left-1/2 flex flex-col items-center gap-0.5 -translate-x-1/2 text-center text-white pointer-events-none">
                        {labels.sectionLabel && (
                          <span className="text-[10px] tracking-[0.2em] text-gray-300 bg-black/30 px-2 py-0.5 rounded-full">
                            {labels.sectionLabel.toUpperCase()}
                          </span>
                        )}
                        {labels.rowLabel && (
                          <span className="text-xs font-semibold bg-black/70 px-2 py-0.5 rounded-full shadow">
                            {labels.rowLabel}
                          </span>
                        )}
                      </div>
                    )}
                    <div
                      className="flex items-center justify-center"
                      style={{ minHeight: `${height - 20}px`, pointerEvents: 'auto' }}
                    >
                      <div style={{ transform: `rotate(${rotation}deg)` }}>
                        <TableComponent
                          row={row}
                          tableShape={row.table_shape || row.seat_type || 'table-6'}
                          selectedSeats={selectedSeats}
                          pendingSeats={pendingForRow}
                          reservedSeats={reservedForRow}
                          onToggleSeat={(seatId) =>
                            handleSeatInteraction(seatId, {
                              tableId: rowKey,
                              rowLabel: row.row_label,
                              section: row.section_name || row.section,
                            })
                          }
                          interactive={interactive}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="absolute left-4 bottom-4 text-gray-300 bg-gray-800/70 px-3 py-1 rounded-lg pointer-events-none">
              Selected seats: <span className="font-semibold text-white">{selectedSeats.length}</span>
            </div>

            {interactive && (
              <div className="absolute right-4 bottom-4 flex flex-col sm:flex-row gap-3 items-center">
                {errorMessage && <div className="text-sm text-red-400">{errorMessage}</div>}
                <button
                  onClick={openRequestModal}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2 transition"
                >
                  <Send className="h-4 w-4" /> Request Seats
                </button>
              </div>
            )}
          </div>
        </div>
        {showLegend && (
          <aside className="bg-gray-900/80 border border-purple-500/20 rounded-xl p-4 text-sm text-gray-200 w-full xl:w-64 flex-shrink-0">
            <div className="font-semibold mb-3">Legend</div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded bg-gray-500" /> <span>Available</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded bg-purple-700 ring-2 ring-purple-400" />{' '}
              <span>Your Selection</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded bg-purple-500/80 border-2 border-dashed border-purple-300" />{' '}
              <span>Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-red-600 ring-2 ring-red-400" /> <span>Reserved</span>
            </div>
          </aside>
        )}
      </div>
    );
  };

  return (
    <section className="py-6" id="seating">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {showHeader && (
          <div className="text-center mb-8">
            <h2 className="text-4xl font-bold">Seating Chart</h2>
            <p className="text-gray-300 mt-2">
              {interactive
                ? 'Select seats to submit a reservation request.'
                : 'Reference layout for upcoming shows.'}
            </p>
          </div>
        )}

        {renderLayoutBody()}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl max-w-lg w-full p-6 border border-purple-500/20">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-2xl font-bold">Request Seats</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </div>

            {successMessage && (
              <div className="p-3 mb-4 bg-green-500/20 border border-green-500 text-green-300 rounded">
                {successMessage}
              </div>
            )}

            {errorMessage && (
              <div className="p-3 mb-4 bg-red-500/20 border border-red-500 text-red-300 rounded">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {!eventId && (
                <div className="mb-3">
                  <label className="block text-white mb-2">Event</label>
                  <select
                    name="eventId"
                    value={form.eventId}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">Select an event</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.artist_name || ev.title} - {formatDateForOption(ev.event_date)}{' '}
                        {formatTimeForOption(ev.event_time)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-white mb-2">Your name</label>
                  <input
                    name="customerName"
                    value={form.customerName}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-white mb-2">Email</label>
                  <input
                    name="customerEmail"
                    type="email"
                    value={form.customerEmail}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-white mb-2">Phone</label>
                <input
                  name="customerPhone"
                  value={form.customerPhone}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg"
                />
              </div>

              <div className="mt-3">
                <label className="block text-white mb-2">Selected Seats</label>
                <div className="flex flex-wrap gap-2">
                  {selectedSeats.map((seatId) => (
                    <div key={seatId} className="px-3 py-1 bg-gray-700 text-white rounded">
                      {describeSeatSelection(seatId, seatLabelMap[seatId])}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-white mb-2">Special requests</label>
                <textarea
                  name="specialRequests"
                  value={form.specialRequests}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg resize-none"
                  rows={3}
                />
              </div>

              <div className="mt-6 flex justify-end items-center gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function formatDateForOption(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimeForOption(timeString) {
  if (!timeString) return '';
  const [hours, minutes] = (timeString || '').split(':');
  const hour = parseInt(hours || '0', 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minutes || '00'} ${ampm}`;
}

// Feature flag / marker for git history: seating sync behaviour
export const SEATING_SYNC_FEATURE = true;
