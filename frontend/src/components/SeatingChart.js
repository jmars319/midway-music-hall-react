import React, { useMemo, useState, useEffect } from 'react';
import { Armchair, Send, X } from 'lucide-react';
import Table6 from './Table6';
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

export default function SeatingChart({ seatingConfig = [], events = [] }) {
  const activeRows = useMemo(() => seatingConfig.filter(r => r.is_active !== false), [seatingConfig]);

  const [selectedSeats, setSelectedSeats] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ customerName: '', customerEmail: '', customerPhone: '', specialRequests: '', eventId: events && events[0] ? events[0].id : '' });
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingSeats, setPendingSeats] = useState([]);

  const toggleSeat = (id) => {
    setSelectedSeats(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const openRequestModal = () => {
    if (selectedSeats.length === 0) {
      setErrorMessage('Please select at least one seat before requesting.');
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }
    setShowModal(true);
    setSuccessMessage('');
    setErrorMessage('');
  };

  const closeModal = () => setShowModal(false);

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
        event_id: form.eventId || (events && events[0] && events[0].id) || null,
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
        setSuccessMessage('Request submitted — we will contact you soon.');
        setSelectedSeats([]);
        setForm({ customerName: '', customerEmail: '', customerPhone: '', specialRequests: '', eventId: form.eventId });
        setTimeout(() => { setShowModal(false); setSuccessMessage(''); }, 2200);
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

  // Determine whether spatial data exists
  const hasPositions = activeRows.some(r => r.pos_x !== null && r.pos_y !== null && r.pos_x !== undefined && r.pos_y !== undefined);

  return (
    <section className="py-6" id="seating">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-bold">Seating Chart</h2>
          <p className="text-gray-300 mt-2">Select your preferred seats and submit a request.</p>
        </div>

        {!hasPositions ? (
          <div className="text-center py-12 text-gray-400">No spatial seating configuration available. Contact admin to set positions or use the list view.</div>
        ) : (
          <div className="relative bg-gray-900 rounded-xl p-6 border border-purple-500/20" style={{ height: 600 }}>
            <StageRenderer />

            {activeRows.map(row => {
              if (row.pos_x === null || row.pos_y === null || row.pos_x === undefined || row.pos_y === undefined) return null;
              const left = `${parseFloat(row.pos_x)}%`;
              const top = `${parseFloat(row.pos_y)}%`;
              const transform = `translate(-50%, -50%) rotate(${row.rotation || 0}deg)`;
              return (
                <div key={row.id} style={{ position: 'absolute', left, top, transform }} className="flex flex-col items-center gap-2">
                  <div className="text-sm text-gray-300 font-semibold">{row.section_name || row.section || 'Section'} {row.row_label || ''}</div>

                  {row.seat_type === 'table-6' && (row.total_seats || 0) === 6 ? (
                    (() => {
                      const reserved = (row.selected_seats && typeof row.selected_seats === 'string') ? (()=>{try{return JSON.parse(row.selected_seats);}catch(e){return []}})() : (row.selected_seats || []);
                      // pending seats specific to this row
                      const pendingForRow = Array.isArray(pendingSeats) ? pendingSeats.filter(s => s.startsWith(`${row.section_name || row.section}-${row.row_label}-`)) : [];
                      return (
                        <Table6
                          row={row}
                          selectedSeats={[...new Set([...(reserved || []), ...selectedSeats])]}
                          pendingSeats={pendingForRow}
                          onToggleSeat={(seatId) => {
                            if (reserved.includes(seatId)) return; // don't allow customers to grab reserved seats
                            if (pendingForRow.includes(seatId)) return; // don't allow customers to grab pending seats
                            toggleSeat(seatId);
                          }}
                        />
                      );
                    })()
                  ) : (
                    <div className="flex gap-2">
                      {Array.from({ length: row.total_seats || 0 }).map((_, idx) => {
                        const seatNum = idx + 1;
                        const seatId = `${row.section_name || row.section}-${row.row_label}-${seatNum}`;
                        const isSelected = selectedSeats.includes(seatId);
                        const isPendingSeat = pendingSeats.includes(seatId);
                        const reservedList = (row.selected_seats && typeof row.selected_seats === 'string') ? (()=>{try{return JSON.parse(row.selected_seats);}catch(e){return []}})() : (row.selected_seats || []);
                        const isReservedSeat = reservedList.includes(seatId);

                        // priority: reserved > pending > selected
                        let classes = '';
                        if (isReservedSeat) classes = 'w-9 h-9 flex items-center justify-center rounded bg-red-600 ring-2 ring-red-400 text-white';
                        else if (isPendingSeat) classes = 'w-9 h-9 flex items-center justify-center rounded bg-purple-500/80 border-2 border-dashed border-purple-300 text-white';
                        else classes = `w-9 h-9 flex items-center justify-center rounded cursor-pointer ${seatTypeClass(row.seat_type, isSelected)}`;

                        return <button key={seatId} onClick={() => { if (!isPendingSeat && !isReservedSeat) toggleSeat(seatId); }} className={classes}><Armchair className="h-4 w-4" /></button>;
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="absolute left-4 bottom-4 text-gray-300">Selected seats: <span className="font-medium text-white">{selectedSeats.length}</span></div>
            {/* Legend */}
            <div className="absolute right-4 top-4 bg-gray-800/80 p-3 rounded-lg border border-purple-500/20 text-sm text-gray-200">
              <div className="font-semibold mb-2">Legend</div>
              <div className="flex items-center gap-2 mb-1"><span className="w-5 h-5 rounded bg-green-500" /> Available</div>
              <div className="flex items-center gap-2 mb-1"><span className="w-5 h-5 rounded bg-purple-700 ring-2 ring-purple-400" /> Your selection</div>
              <div className="flex items-center gap-2 mb-1"><span className="w-5 h-5 rounded bg-purple-500/80 border-2 border-dashed border-purple-300" /> Pending request</div>
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-red-600 ring-2 ring-red-400" /> Reserved</div>
            </div>
            <div className="absolute right-4 bottom-4 flex items-center gap-3">
              {errorMessage && <div className="text-sm text-red-400">{errorMessage}</div>}
              <button onClick={openRequestModal} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2">
                <Send className="h-4 w-4" /> Request Seats
              </button>
            </div>
          </div>
        )}
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
              <div className="p-3 mb-4 bg-green-500/20 border border-green-500 text-green-300 rounded">{successMessage}</div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="block text-white mb-2">Event</label>
                <select name="eventId" value={form.eventId} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg focus:ring-2 focus:ring-purple-500">
                  <option value="">Select an event</option>
                  {events.map(ev => (
                    <option key={ev.id} value={ev.id}>{ev.artist_name} — {formatDateForOption(ev.event_date)} {formatTimeForOption(ev.event_time)}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-white mb-2">Your name</label>
                  <input name="customerName" value={form.customerName} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" required />
                </div>
                <div>
                  <label className="block text-white mb-2">Email</label>
                  <input name="customerEmail" type="email" value={form.customerEmail} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" required />
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-white mb-2">Phone</label>
                <input name="customerPhone" value={form.customerPhone} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" />
              </div>

              <div className="mt-3">
                <label className="block text-white mb-2">Selected Seats</label>
                <div className="flex flex-wrap gap-2">
                  {selectedSeats.map(s => (
                    <div key={s} className="px-3 py-1 bg-gray-700 text-white rounded">{s}</div>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-white mb-2">Special requests</label>
                <textarea name="specialRequests" value={form.specialRequests} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg resize-none" rows={3} />
              </div>

              <div className="mt-6 flex justify-end items-center gap-3">
                <button type="button" onClick={closeModal} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg">
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
            {errorMessage && <div className="mt-4 text-sm text-red-400">{errorMessage}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function StageRenderer(){
  const [stage, setStage] = useState(null);
  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/stage-settings`).then(r => r.json()).then(d => { if (mounted && d && d.success) setStage(d.settings); }).catch(()=>{ });
    // fetch pending seat requests to mark pending seats
    fetch(`${API_BASE}/seat-requests?status=pending`).then(r => r.json()).then(d => {
      if (mounted && d && d.success && Array.isArray(d.requests)) {
        const allSeats = [];
        d.requests.forEach(req => {
          const seats = Array.isArray(req.selected_seats) ? req.selected_seats : (typeof req.selected_seats === 'string' ? (()=>{try{return JSON.parse(req.selected_seats);}catch(e){return []}})() : []);
          seats.forEach(s => allSeats.push(s));
        });
        setPendingSeats(allSeats);
      }
    }).catch(()=>{});
    return () => { mounted = false; };
  }, []);

  if (!stage) return null;
  const pos = stage.position || 'back-left';
  const style = { position: 'absolute', width: '22%', height: 40, background: '#2d2d2d', border: '2px solid #7c3aed', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  switch (pos) {
    case 'back-left': return <div style={{ ...style, left: '6%', top: '4%' }}>Stage</div>;
    case 'back-right': return <div style={{ ...style, right: '6%', top: '4%' }}>Stage</div>;
    case 'front-center': return <div style={{ ...style, left: '50%', top: '88%', transform: 'translateX(-50%)' }}>Stage</div>;
    default: return <div style={{ ...style, left: '6%', top: '4%' }}>Stage</div>;
  }
}

// Helper date/time formatting used inside the modal options
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
