import React, { useEffect, useState } from 'react';
import { API_BASE } from '../App';

function parseSeats(selected_seats){
  if (!selected_seats) return [];
  if (Array.isArray(selected_seats)) return selected_seats;
  if (typeof selected_seats === 'string'){
    try{ return JSON.parse(selected_seats); }catch(e){ return []; }
  }
  return [];
}

function ConflictModal({ conflicts = [], onClose = () => {}, onRefresh = () => {} }){
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-red-600">
        <h3 className="text-xl font-bold text-red-400 mb-3">Conflict detected</h3>
        <p className="text-sm text-gray-300 mb-3">The following seats are already reserved and prevented approval:</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {conflicts.map(s => <span key={s} className="px-2 py-1 bg-red-600 text-white rounded text-xs">{s}</span>)}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onRefresh} className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded">Refresh</button>
          <button onClick={onClose} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">Dismiss</button>
        </div>
      </div>
    </div>
  );
}

// RequestsModule (admin)
// Shows customer seat requests, allows admin to approve or deny requests.
// - Polls `/api/seat-requests` periodically when polling is enabled
// - Approve action will call `/api/seat-requests/:id/approve` and may
//   return a 409 with conflicts if seats were already reserved
// This module presents a table view and a small seat-preview for each request.
export default function RequestsModule(){
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const [polling, setPolling] = useState(true);

  const fetchRequests = async () => {
    setLoading(true);
    setError('');
    try{
      const res = await fetch(`${API_BASE}/seat-requests?limit=200`);
      const json = await res.json();
      if (json && json.success) setRequests(json.requests || []);
      else setRequests([]);
    }catch(e){ console.error('Failed to fetch requests', e); setRequests([]); setError('Failed to load seat requests'); }
    setLoading(false);
  };

  useEffect(()=>{ fetchRequests(); }, []);

  // Poll for pending requests every 8 seconds when polling enabled
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(() => {
      fetchRequests();
    }, 8000);
    return () => clearInterval(id);
  }, [polling]);

  const act = async (id, action) => {
    try{
      const res = await fetch(`${API_BASE}/seat-requests/${id}/${action}`, { method: 'POST' });
      if (res.status === 409) {
        // conflict - parse response for conflicts list
        const json = await res.json();
        setConflicts(json.conflicts || []);
        return;
      }
      const json = await res.json();
      if (json && json.success) fetchRequests();
      else alert('Action failed');
    }catch(e){ console.error('Action failed', e); alert('Action failed'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Seat Requests</h1>
          <div className="text-sm text-gray-300 bg-gray-800 px-2 py-1 rounded border border-purple-500/20">Polling: <span className="font-medium text-white ml-1">{polling ? 'On' : 'Off'}</span></div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { fetchRequests(); }} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">Refresh</button>
          <button onClick={() => setPolling(p => !p)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">{polling ? 'Stop' : 'Start'} Poll</button>
        </div>
      </div>

      {/* Compact legend */}
      <div className="mb-4 text-sm text-gray-300 flex items-center gap-4">
        <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-green-500" /> Available</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-purple-700 ring-2 ring-purple-400" /> Customer selection</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-purple-500/80 border-2 border-dashed border-purple-300" /> Pending</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 rounded bg-red-600 ring-2 ring-red-400" /> Reserved</div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>
      ) : (
        <div className="bg-gray-800 rounded-xl overflow-hidden border border-purple-500/30">
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Customer</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Event</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Seats</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Contact</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Status</th>
                <th className="px-4 py-3 text-right text-sm text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => {
                const seats = parseSeats(req.selected_seats || []);
                const SeatPreview = ({ seats = [] }) => (
                  <div className="flex items-center gap-1">
                    {seats.slice(0,6).map((s, i) => (
                      <span key={i} title={s} className="w-3 h-3 rounded-full bg-purple-600" />
                    ))}
                    {seats.length > 6 && <span className="text-xs text-gray-400">+{seats.length - 6}</span>}
                  </div>
                );

                return (
                  <tr key={req.id} className="border-t border-gray-700 hover:bg-gray-700/40">
                    <td className="px-4 py-3">{req.customer_name}</td>
                    <td className="px-4 py-3">{req.event_title} <div className="text-xs text-gray-500">{req.event_date} {req.event_time}</div></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {seats.map((s,i) => (
                            <span key={i} className="px-2 py-1 bg-purple-600 text-white text-xs rounded">{s}</span>
                          ))}
                          {seats.length === 0 && <span className="text-xs text-gray-400">No seats</span>}
                        </div>
                        <div className="pl-2"><SeatPreview seats={seats} /></div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{req.customer_email}</div>
                      {req.customer_phone && <div className="text-xs text-gray-400">{req.customer_phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-sm ${req.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : req.status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{req.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {req.status === 'pending' ? (
                        <div className="inline-flex gap-2">
                          <button onClick={() => act(req.id, 'approve')} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-2">Approve</button>
                          <button onClick={() => act(req.id, 'deny')} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2">Deny</button>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400">No actions</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {conflicts && <ConflictModal conflicts={conflicts} onClose={() => setConflicts(null)} onRefresh={() => { setConflicts(null); fetchRequests(); }} />}
    </div>
  );
}
