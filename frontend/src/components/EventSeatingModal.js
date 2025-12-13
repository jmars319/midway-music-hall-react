import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Send, AlertCircle } from 'lucide-react';
import TableComponent, { isSeatReserved } from './TableComponent';
import { API_BASE } from '../App';
import { seatingLegendSwatches, seatingStatusLabels } from '../utils/seatingTheme';
import useFocusTrap from '../utils/useFocusTrap';

export default function EventSeatingModal({ event, onClose }) {
  const [seatingConfig, setSeatingConfig] = useState([]);
  const [reservedSeats, setReservedSeats] = useState([]);
  const [pendingSeats, setPendingSeats] = useState([]);
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [stagePosition, setStagePosition] = useState({ x: 50, y: 10 });
  const [stageSize, setStageSize] = useState({ width: 200, height: 80 });
  const [canvasSettings, setCanvasSettings] = useState({ width: 1200, height: 800 });
  const canvasContainerRef = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const titleId = `event-seating-title-${event.id}`;
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    specialRequests: ''
  });

  const handleModalClose = () => {
    // Close immediately when ESC is pressed; do not force confirmation
    onClose();
  };

  useFocusTrap(dialogRef, { onClose: handleModalClose, enabled: true, initialFocusRef: closeButtonRef });

  const activeRows = useMemo(
    () => seatingConfig.filter(r => {
      const type = r.element_type || 'table';
      return r.is_active !== false && type !== 'marker' && type !== 'area';
    }),
    [seatingConfig]
  );
  const canvasWidth = canvasSettings?.width || 1200;
  const canvasHeight = canvasSettings?.height || 800;

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    fetchEventSeating();
  }, [event.id]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const fetchEventSeating = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/seating/event/${event.id}`);
      const data = await res.json();
      if (data.success) {
        setSeatingConfig(data.seating || []);
        setReservedSeats(data.reservedSeats || []);
        setPendingSeats(data.pendingSeats || []);
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
        setErrorMessage('Failed to load seating data');
      }
    } catch (err) {
      console.error('Failed to fetch event seating:', err);
      setErrorMessage('Network error loading seating');
    } finally {
      setLoading(false);
    }
  };

  const toggleSeat = (id) => {
    setSelectedSeats(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

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
      setErrorMessage('Please select at least one seat');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }
    setShowContactForm(true);
    setErrorMessage('');
  };

  const handleBackToSeats = () => {
    setShowContactForm(false);
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
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setErrorMessage(data.message || 'Failed to submit request');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Network error - please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const hasPositions = activeRows.some(r => 
    r.pos_x !== null && r.pos_y !== null && 
    r.pos_x !== undefined && r.pos_y !== undefined
  );
  const legendItems = [
    { key: 'available', label: seatingStatusLabels.available, className: seatingLegendSwatches.available },
    { key: 'selected', label: seatingStatusLabels.selected, className: seatingLegendSwatches.selected },
    { key: 'pending', label: seatingStatusLabels.pending, className: seatingLegendSwatches.pending },
    { key: 'reserved', label: seatingStatusLabels.reserved, className: seatingLegendSwatches.reserved },
  ];

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
            className="text-gray-400 hover:text-white transition p-2 hover:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400"
            aria-label="Close seating selection"
          >
            <X className="h-7 w-7" />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin h-16 w-16 border-4 border-purple-500 border-t-transparent rounded-full"></div>
          </div>
        ) : errorMessage && !showContactForm ? (
          <div className="flex-1 flex items-center justify-center p-6">
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
                    <label className="block text-white mb-2 font-medium">Your Name *</label>
                    <input 
                      name="customerName" 
                      value={form.customerName} 
                      onChange={handleChange} 
                      className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition" 
                      required 
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <label className="block text-white mb-2 font-medium">Email (optional)</label>
                    <input 
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
                  <label className="block text-white mb-2 font-medium">Phone *</label>
                  <input 
                    name="customerPhone" 
                    type="tel"
                    value={form.customerPhone} 
                    onChange={handleChange} 
                    className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition" 
                    disabled={submitting}
                    required
                    aria-required="true"
                    placeholder="Required so staff can confirm your seats"
                  />
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium">Selected Seats ({selectedSeats.length})</label>
                  <div className="flex flex-wrap gap-2 p-4 bg-gray-800 rounded-lg border border-gray-700 min-h-[60px]">
                    {selectedSeats.map(s => (
                      <div key={s} className="px-3 py-1 bg-purple-600 text-white rounded-full text-sm font-medium">
                        {s}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium">Special Requests</label>
                  <textarea 
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
              <div
                className="relative h-full bg-gray-100 dark:bg-gray-900 rounded-xl overflow-auto border border-purple-500/20"
                ref={canvasContainerRef}
              >
                <div
                  className="relative mx-auto"
                  style={{
                    width: canvasWidth,
                    height: canvasHeight,
                    minWidth: canvasWidth,
                    minHeight: canvasHeight
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
                      height: `${stageSize.height || 80}px`
                    }}
                  >
                    STAGE
                  </div>

                  {/* Tables */}
                  {activeRows.map(row => {
                    if (row.pos_x === null || row.pos_y === null || row.pos_x === undefined || row.pos_y === undefined) return null;
                    
                    const reservedForRow = reservedSeats.filter(s => s.startsWith(`${row.section_name || row.section}-${row.row_label}-`));
                    const pendingForRow = pendingSeats.filter(s => s.startsWith(`${row.section_name || row.section}-${row.row_label}-`));
                    
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
                          minHeight: `${row.height || 120}px`
                        }}
                      >
                        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-xs font-medium text-gray-700 dark:text-gray-300 text-center whitespace-nowrap z-20">
                          {row.section_name} - {row.row_label}
                        </div>
                        <div className="flex items-center justify-center" style={{ minHeight: '60px' }}>
                          <div style={{ transform: `rotate(${row.rotation || 0}deg)` }}>
                            <TableComponent
                              row={row}
                              tableShape={row.table_shape || 'table-6'}
                              selectedSeats={selectedSeats}
                              pendingSeats={pendingForRow}
                              reservedSeats={reservedForRow}
                              onToggleSeat={(seatId) => {
                                if (isSeatReserved(row, seatId, reservedForRow)) return;
                                if (pendingForRow.includes(seatId)) return;
                                toggleSeat(seatId);
                              }}
                              interactive={true}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="absolute right-4 top-4 bg-gray-900/90 p-4 rounded-lg border border-purple-500/30 text-sm text-gray-200">
                  <div className="font-semibold mb-3 text-white">Legend</div>
                  {legendItems.map((item) => (
                    <div className="flex items-center gap-2 mb-2 last:mb-0" key={item.key}>
                      <span className={`w-6 h-6 rounded ${item.className}`} />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
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
                      {seat}
                    </span>
                  ))}
                  {selectedSeats.length > 6 && (
                    <span className="text-gray-400 text-sm">+{selectedSeats.length - 6} more</span>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-gray-500">Pick seats on the map to continue.</p>
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
                disabled={selectedSeats.length === 0}
                className="px-8 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition font-medium text-lg"
              >
                Confirm Selection ({selectedSeats.length} {selectedSeats.length === 1 ? 'seat' : 'seats'})
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
