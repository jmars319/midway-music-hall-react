import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, XCircle, Trash2, Edit3, RefreshCw, X, Clock } from 'lucide-react';
import { API_BASE } from '../App';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'hold', label: 'Hold' },
  { value: 'pending', label: 'Pending' },
  { value: 'finalized', label: 'Finalized' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'denied', label: 'Denied' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_BADGES = {
  hold: 'bg-blue-500/15 text-blue-200 border border-blue-500/30',
  pending: 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30',
  finalized: 'bg-green-500/15 text-green-200 border border-green-500/30',
  cancelled: 'bg-gray-500/15 text-gray-200 border border-gray-500/30',
  denied: 'bg-red-500/15 text-red-200 border border-red-500/30',
  expired: 'bg-orange-500/15 text-orange-200 border border-orange-500/30',
};

const DETAIL_STATUS_OPTIONS = STATUS_OPTIONS.filter(opt => opt.value !== 'all');

const formatDateTime = (value) => {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString();
};

const toLocalInputValue = (value) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const tzOffset = dt.getTimezoneOffset();
  const local = new Date(dt.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
};

const fromLocalInputValue = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

const isHoldExpired = (value) => {
  if (!value) return false;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getTime() < Date.now();
};

const describeHoldWindow = (value) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const diffMs = dt.getTime() - Date.now();
  const diffHours = Math.round(Math.abs(diffMs) / 3600000);
  if (diffMs < 0) {
    return diffHours > 0 ? `Expired ${diffHours}h ago` : 'Expired just now';
  }
  if (diffHours === 0) return 'Less than 1h left';
  return `${diffHours}h left`;
};

export default function SeatRequestsModule() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ status: 'all', eventId: 'all', search: '' });
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingDetail, setSavingDetail] = useState(false);

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [filters.status, filters.eventId]);

  const fetchEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/events?scope=admin&limit=500`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.events)) {
        setEvents(data.events);
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
    }
  };

  const fetchRequests = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filters.status && filters.status !== 'all') params.append('status', filters.status);
      if (filters.eventId && filters.eventId !== 'all') params.append('event_id', filters.eventId);
      const res = await fetch(`${API_BASE}/seat-requests${params.toString() ? `?${params.toString()}` : ''}`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.requests)) {
        setRequests(data.requests);
      } else {
        setRequests([]);
      }
    } catch (err) {
      console.error('Failed to fetch seat requests', err);
      setError('Failed to load seat requests');
    } finally {
      setLoading(false);
    }
  };

  const refresh = () => fetchRequests();

  const visibleRequests = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    if (!term) return requests;
    return requests.filter((req) => {
      const haystack = [
        req.customer_name,
        req.customer_email,
        req.customer_phone,
        req.event_title,
        req.special_requests,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [requests, filters.search]);

  const parseSeats = (selected_seats) => {
    try {
      const arr = typeof selected_seats === 'string' ? JSON.parse(selected_seats) : selected_seats;
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  };

  const deleteRequest = async (id) => {
    if (!window.confirm('Delete this seat request?')) return;
    try {
      const res = await fetch(`${API_BASE}/seat-requests/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data?.success) {
        fetchRequests();
      } else {
        alert('Failed to delete request');
      }
    } catch (err) {
      console.error('Delete request error', err);
      alert('Failed to delete request');
    }
  };

  const approveRequest = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/seat-requests/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data?.success) {
        fetchRequests();
      } else {
        alert(data?.message || 'Failed to finalize request');
      }
    } catch (err) {
      console.error('Approve error', err);
      alert('Failed to finalize request');
    }
  };

  const denyRequest = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/seat-requests/${id}/deny`, { method: 'POST' });
      const data = await res.json();
      if (data?.success) {
        fetchRequests();
      } else {
        alert(data?.message || 'Failed to deny request');
      }
    } catch (err) {
      console.error('Deny error', err);
      alert('Failed to deny request');
    }
  };

  const updateRequest = async (id, payload, failureMessage = 'Failed to update request') => {
    try {
      const res = await fetch(`${API_BASE}/seat-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.success) {
        fetchRequests();
      } else {
        alert(data?.message || failureMessage);
      }
    } catch (err) {
      console.error('Seat request update error', err);
      alert(failureMessage);
    }
  };

  const extendHoldQuick = (request, hours = 24) => {
    if (!request) return;
    const baseDate = request.hold_expires_at ? new Date(request.hold_expires_at) : new Date();
    if (Number.isNaN(baseDate.getTime())) return;
    baseDate.setHours(baseDate.getHours() + hours);
    updateRequest(request.id, {
      hold_expires_at: baseDate.toISOString(),
      status: request.status === 'expired' ? 'hold' : request.status,
    });
  };

  const markExpired = (request) => {
    if (!request) return;
    updateRequest(request.id, { status: 'expired', hold_expires_at: null });
  };

  const openDetail = (req) => {
    setSelectedRequest(req);
    setEditForm({
      customer_name: req.customer_name || '',
      customer_email: req.customer_email || '',
      customer_phone: req.customer_phone || '',
      special_requests: req.special_requests || '',
      staff_notes: req.staff_notes || '',
      status: req.status || 'pending',
      hold_expires_at: toLocalInputValue(req.hold_expires_at),
    });
  };

  const closeDetail = () => {
    setSelectedRequest(null);
    setEditForm(null);
    setSavingDetail(false);
  };

  const handleDetailChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const extendHoldInModal = (hours = 24) => {
    if (!selectedRequest) return;
    const base = editForm?.hold_expires_at ? new Date(editForm.hold_expires_at) : new Date();
    if (Number.isNaN(base.getTime())) return;
    base.setHours(base.getHours() + hours);
    setEditForm((prev) => ({ ...prev, hold_expires_at: toLocalInputValue(base.toISOString()) }));
  };

  const saveDetail = async () => {
    if (!selectedRequest || !editForm) return;
    setSavingDetail(true);
    try {
      const payload = {
        customer_name: editForm.customer_name,
        customer_email: editForm.customer_email,
        customer_phone: editForm.customer_phone,
        special_requests: editForm.special_requests,
        staff_notes: editForm.staff_notes,
        status: editForm.status,
        contact: {
          email: editForm.customer_email,
          phone: editForm.customer_phone,
        },
      };
      if (editForm.hold_expires_at) {
        payload.hold_expires_at = fromLocalInputValue(editForm.hold_expires_at);
      } else {
        payload.hold_expires_at = null;
      }
      const res = await fetch(`${API_BASE}/seat-requests/${selectedRequest.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.success) {
        closeDetail();
        fetchRequests();
      } else {
        alert(data?.message || 'Failed to save changes');
      }
    } catch (err) {
      console.error('Update request error', err);
      alert('Failed to save changes');
    } finally {
      setSavingDetail(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Seat Requests</h1>
          <p className="text-sm text-gray-400">Manage holds, pending requests, and finalized seat assignments.</p>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-800 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-700"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <select
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          className="px-3 py-2 bg-gray-800 text-white rounded"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={filters.eventId}
          onChange={(e) => setFilters((prev) => ({ ...prev, eventId: e.target.value }))}
          className="px-3 py-2 bg-gray-800 text-white rounded min-w-[220px]"
        >
          <option value="all">All events</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.artist_name || ev.title || `Event ${ev.id}`}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          placeholder="Search name, email, phone"
          className="flex-1 min-w-[200px] px-3 py-2 bg-gray-800 text-white rounded placeholder-gray-500"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>
      ) : visibleRequests.length === 0 ? (
        <div className="p-6 bg-gray-800 rounded text-center text-gray-400 border border-gray-700">
          No seat requests found for the selected filters.
        </div>
      ) : (
        <div className="bg-gray-900 rounded-xl overflow-hidden border border-purple-500/20">
          <table className="w-full">
            <thead className="bg-gray-950">
              <tr>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Customer</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Event</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Seats</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Contact</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Status</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Hold expires</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Created</th>
                <th className="px-4 py-3 text-right text-sm text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((req) => {
                const seats = parseSeats(req.selected_seats || '[]');
                const badge = STATUS_BADGES[req.status] || 'bg-gray-500/15 text-gray-200 border border-gray-500/30';
                const expiredHold = isHoldExpired(req.hold_expires_at) && ['hold', 'pending'].includes(req.status);
                const statusLabel = expiredHold && req.status !== 'expired' ? `${req.status} (expired)` : req.status;
                return (
                  <tr
                    key={req.id}
                    className={`border-t border-gray-800 hover:bg-gray-800/40 ${expiredHold ? 'bg-red-900/10' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-white">{req.customer_name || 'Guest'}</div>
                      <div className="text-xs text-gray-400">{req.special_requests || 'No notes'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-white">{req.event_title || `Event ${req.event_id}`}</div>
                      <div className="text-xs text-gray-400">{formatDateTime(req.start_datetime)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {seats.slice(0, 4).map((seat) => (
                          <span key={seat} className="px-2 py-1 bg-purple-600/50 text-purple-100 rounded text-xs">{seat}</span>
                        ))}
                        {seats.length > 4 && (
                          <span className="px-2 py-1 bg-gray-600 text-white rounded text-xs">+{seats.length - 4}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-200">
                      <div>{req.customer_email || 'No email'}</div>
                      <div className="text-xs text-gray-400">{req.customer_phone || 'No phone'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${badge} ${expiredHold ? 'ring-1 ring-red-500/60' : ''}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      <div>{formatDateTime(req.hold_expires_at)}</div>
                      {req.hold_expires_at && (
                        <div className={`text-xs ${expiredHold ? 'text-red-400' : 'text-green-400'}`}>
                          {describeHoldWindow(req.hold_expires_at)}
                        </div>
                      )}
                      {['hold', 'pending', 'expired'].includes(req.status) && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => extendHoldQuick(req, 24)}
                            className="px-2 py-1 text-[11px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-200 rounded flex items-center gap-1"
                          >
                            +24h
                          </button>
                          {expiredHold && req.status !== 'expired' && (
                            <button
                              type="button"
                              onClick={() => markExpired(req)}
                              className="px-2 py-1 text-[11px] bg-red-600/20 hover:bg-red-600/40 text-red-200 rounded"
                            >
                              Mark expired
                            </button>
                          )}
                          {req.status === 'hold' && (
                            <button
                              type="button"
                              onClick={() => updateRequest(req.id, { status: 'cancelled', hold_expires_at: null })}
                              className="px-2 py-1 text-[11px] bg-gray-600/30 hover:bg-gray-600/50 text-gray-200 rounded"
                            >
                              Release hold
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {formatDateTime(req.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {req.status === 'pending' && (
                          <>
                            <button
                              onClick={() => approveRequest(req.id)}
                              className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-1"
                            >
                              <CheckCircle className="h-4 w-4" /> Finalize
                            </button>
                            <button
                              onClick={() => denyRequest(req.id)}
                              className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-1"
                            >
                              <XCircle className="h-4 w-4" /> Deny
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => openDetail(req)}
                          className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-1"
                        >
                          <Edit3 className="h-4 w-4" /> View
                        </button>
                        <button
                          onClick={() => deleteRequest(req.id)}
                          className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded flex items-center gap-1"
                          title="Delete request"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedRequest && editForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl max-w-3xl w-full border border-purple-500/30 shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div>
                <h3 className="text-xl font-semibold text-white">Seat request for {selectedRequest.event_title || `Event ${selectedRequest.event_id}`}</h3>
                <p className="text-sm text-gray-400">Submitted {formatDateTime(selectedRequest.created_at)}</p>
              </div>
              <button onClick={closeDetail} className="p-2 rounded hover:bg-gray-800 text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Customer name</label>
                  <input
                    name="customer_name"
                    value={editForm.customer_name}
                    onChange={handleDetailChange}
                    className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Status</label>
                  <select
                    name="status"
                    value={editForm.status}
                    onChange={handleDetailChange}
                    className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                  >
                    {DETAIL_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Email</label>
                  <input
                    name="customer_email"
                    value={editForm.customer_email}
                    onChange={handleDetailChange}
                    className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Phone</label>
                  <input
                    name="customer_phone"
                    value={editForm.customer_phone}
                    onChange={handleDetailChange}
                    className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Hold expiration</label>
                  <div className="flex gap-2">
                    <input
                      type="datetime-local"
                      name="hold_expires_at"
                      value={editForm.hold_expires_at || ''}
                      onChange={handleDetailChange}
                      className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => extendHoldInModal(24)}
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-1"
                      >
                        <Clock className="h-4 w-4" /> +24h
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            hold_expires_at: '',
                            status: 'expired',
                          }))
                        }
                        className="px-3 py-2 bg-red-600/30 hover:bg-red-600/60 text-red-200 rounded text-sm"
                      >
                        Expire now
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Customer notes</label>
                <textarea
                  name="special_requests"
                  value={editForm.special_requests}
                  onChange={handleDetailChange}
                  rows="3"
                  className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Staff notes</label>
                <textarea
                  name="staff_notes"
                  value={editForm.staff_notes}
                  onChange={handleDetailChange}
                  rows="3"
                  className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-800">
              <button
                onClick={closeDetail}
                className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white"
              >
                Cancel
              </button>
              <button
                onClick={saveDetail}
                disabled={savingDetail}
                className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-60"
              >
                {savingDetail ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Marker: seat requests lifecycle improvements applied (hold controls, quick actions)
export const SEAT_REQUESTS_UPDATES = true;
