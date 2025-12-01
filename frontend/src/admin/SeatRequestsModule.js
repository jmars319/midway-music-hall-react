import React, { useEffect, useState } from 'react';
// SeatRequestsModule: admin list view for seat requests (simpler alternative to RequestsModule)
import { CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { API_BASE } from '../App';

const statusClasses = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-green-500/20 text-green-400',
  denied: 'bg-red-500/20 text-red-400',
};

export default function SeatRequestsModule(){
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchRequests = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/seat-requests`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.requests)) {
        setRequests(data.requests);
      } else {
        setRequests([]);
      }
    } catch (err) {
      console.error('Failed to fetch requests', err);
      setError('Failed to load seat requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRequests(); }, []);

  const parseSeats = (selected_seats) => {
    try {
      const arr = typeof selected_seats === 'string' ? JSON.parse(selected_seats) : selected_seats;
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE}/seat-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data && data.success) fetchRequests();
      else alert('Failed to update status');
    } catch (err) {
      console.error('Update status error', err);
      alert('Failed to update status');
    }
  };

  const deleteRequest = async (id) => {
    if (!window.confirm('Are you sure you want to delete this seat request? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/seat-requests/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data && data.success) fetchRequests();
      else alert('Failed to delete request');
    } catch (err) {
      console.error('Delete request error', err);
      alert('Failed to delete request');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Seat Requests</h1>
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
                const seats = parseSeats(req.selected_seats || '[]');
                return (
                  <tr key={req.id} className="border-t border-gray-700 hover:bg-gray-700/40">
                    <td className="px-4 py-3">{req.customer_name}</td>
                    <td className="px-4 py-3">{req.artist_name} <div className="text-xs text-gray-500">{req.event_date} {req.event_time}</div></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {seats.slice(0,3).map((s,i) => (
                          <span key={i} className="px-2 py-1 bg-purple-600 text-white text-xs rounded">{s}</span>
                        ))}
                        {seats.length > 3 && (
                          <span className="px-2 py-1 bg-gray-600 text-white text-xs rounded">+{seats.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{req.customer_email}</div>
                      {req.customer_phone && <div className="text-xs text-gray-400">{req.customer_phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-sm ${statusClasses[req.status] || ''}`}>{req.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {req.status === 'pending' && (
                          <>
                            <button onClick={() => updateStatus(req.id, 'approved')} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-2"><CheckCircle className="h-4 w-4" /> Approve</button>
                            <button onClick={() => updateStatus(req.id, 'denied')} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2"><XCircle className="h-4 w-4" /> Deny</button>
                          </>
                        )}
                        <button onClick={() => deleteRequest(req.id)} className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded flex items-center gap-2" title="Delete request"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
 