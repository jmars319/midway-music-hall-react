import React, { useState, useEffect, useMemo } from 'react';
import { X, Armchair, Send, AlertCircle } from 'lucide-react';
import TableComponent from './TableComponent';
import { API_BASE } from '../App';

const seatTypeClass = (type, selected) => {
  if (selected) return 'bg-purple-700 ring-2 ring-purple-400 text-white';

  switch ((type || '').toLowerCase()) {
    case 'vip':
      return 'bg-yellow-500 hover:bg-yellow-400 text-black';
    case 'premium':
      return 'bg-purple-500 hover:bg-purple-400 text-white';
    case 'accessible':
      return 'bg-blue-500 hover:bg-blue-400 text-white';
    case 'standing':
      return 'bg-green-500 hover:bg-green-400 text-white';
    default:
      return 'bg-gray-500 hover:bg-gray-400 text-white';
  }
};

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
  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    specialRequests: ''
  });

  const activeRows = useMemo(() => seatingConfig.filter(r => r.is_active !== false), [seatingConfig]);

  useEffect(() => {
    fetchEventSeating();
  }, [event.id]);

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
      setErrorMessage('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const hasPositions = activeRows.some(r => 
    r.pos_x !== null && r.pos_y !== null && 
    r.pos_x !== undefined && r.pos_y !== undefined
  );

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl w-full max-w-7xl h-[90vh] flex flex-col border border-purple-500/30 shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-purple-500/20">
          <div>
            <h2 className="text-3xl font-bold text-white">{event.artist_name || event.title}</h2>
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
            onClick={handleCancel}
            className="text-gray-400 hover:text-white transition p-2 hover:bg-gray-800 rounded-lg"
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
                <div className="p-4 mb-6 bg-green-500/20 border border-green-500 text-green-300 rounded-lg">
                  {successMessage}
                </div>
              )}

              {errorMessage && (
                <div className="p-4 mb-6 bg-red-500/20 border border-red-500 text-red-300 rounded-lg">
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
                    <label className="block text-white mb-2 font-medium">Email *</label>
                    <input 
                      name="customerEmail" 
                      type="email" 
                      value={form.customerEmail} 
                      onChange={handleChange} 
                      className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition" 
                      required 
                      disabled={submitting}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-white mb-2 font-medium">Phone</label>
                  <input 
                    name="customerPhone" 
                    value={form.customerPhone} 
                    onChange={handleChange} 
                    className="w-full px-4 py-3 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/50 outline-none transition" 
                    disabled={submitting}
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
              <div className="relative h-full bg-gray-100 dark:bg-gray-900 rounded-xl overflow-auto border border-purple-500/20">
                <div className="relative min-h-[1600px] p-8">
                  {/* Stage */}
                  <div 
                    className="absolute bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 rounded-lg font-bold shadow-lg z-10 flex items-center justify-center"
                    style={{
                      left: `${stagePosition.x}%`,
                      top: `${stagePosition.y}%`,
                      transform: 'translate(-50%, -50%)',
                      width: `${stageSize.width}px`,
                      height: `${stageSize.height}px`
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
                          padding: '40px 20px',
                          minWidth: '120px',
                          minHeight: '120px'
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
                              onToggleSeat={(seatId) => {
                                if (reservedForRow.includes(seatId)) return;
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

                {/* Selected Seats Counter */}
                <div className="absolute left-4 bottom-4 bg-gray-900/90 px-4 py-2 rounded-lg border border-purple-500/30">
                  <span className="text-gray-300">Selected seats: </span>
                  <span className="font-bold text-white text-lg">{selectedSeats.length}</span>
                </div>

                {/* Legend */}
                <div className="absolute right-4 top-4 bg-gray-900/90 p-4 rounded-lg border border-purple-500/30 text-sm text-gray-200">
                  <div className="font-semibold mb-3 text-white">Legend</div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded bg-gray-500" />
                    <span>Available</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded bg-purple-700 ring-2 ring-purple-400" />
                    <span>Your selection</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded bg-purple-500/80 border-2 border-dashed border-purple-300" />
                    <span>Pending</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-red-600 ring-2 ring-red-400" />
                    <span>Reserved</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer Buttons - Only show when not in contact form */}
        {!showContactForm && !loading && hasPositions && (
          <div className="p-6 border-t border-purple-500/20 flex justify-between items-center bg-gray-900/50">
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

function StageRenderer() {
  const [stage, setStage] = useState(null);
  
  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/stage-settings`)
      .then(r => r.json())
      .then(d => { 
        if (mounted && d && d.success) setStage(d.settings); 
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  if (!stage) return null;
  
  const pos = stage.position || 'back-left';
  const style = { 
    position: 'absolute', 
    width: '22%', 
    height: 48, 
    background: '#1f1f1f', 
    border: '3px solid #7c3aed', 
    color: '#fff', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: '16px',
    borderRadius: '8px'
  };
  
  switch (pos) {
    case 'back-left': 
      return <div style={{ ...style, left: '6%', top: '4%' }}>STAGE</div>;
    case 'back-right': 
      return <div style={{ ...style, right: '6%', top: '4%' }}>STAGE</div>;
    case 'front-center': 
      return <div style={{ ...style, left: '50%', top: '88%', transform: 'translateX(-50%)' }}>STAGE</div>;
    default: 
      return <div style={{ ...style, left: '6%', top: '4%' }}>STAGE</div>;
  }
}
