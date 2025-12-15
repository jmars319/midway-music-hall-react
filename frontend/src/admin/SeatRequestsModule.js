import React, { useEffect, useMemo, useState, useRef } from 'react';
import { CheckCircle, XCircle, Trash2, Edit3, RefreshCw, X, Clock, ChevronDown, ChevronRight, Plus, Info } from 'lucide-react';
import { API_BASE } from '../App';
import TableComponent from '../components/TableComponent';
import { seatingLegendSwatches, seatingStatusLabels } from '../utils/seatingTheme';
import useFocusTrap from '../utils/useFocusTrap';
import { buildSeatLookupMap, describeSeatSelection, isSeatRow } from '../utils/seatLabelUtils';

const OPEN_STATUSES = ['new', 'contacted', 'waiting'];
const FINAL_STATUSES = ['confirmed', 'declined', 'closed', 'spam'];

const STATUS_FILTERS = [
  { value: 'open', label: 'Open (New / Contacted / Waiting)' },
  { value: 'all', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'waiting', label: 'Waiting for payment' },
  { value: 'confirmed', label: 'Confirmed / Reserved' },
  { value: 'declined', label: 'Declined' },
  { value: 'closed', label: 'Closed / Released' },
  { value: 'spam', label: 'Spam' },
  { value: 'expired', label: 'Expired hold' },
];

const STATUS_BADGES = {
  new: 'bg-blue-500/15 text-blue-200 border border-blue-500/30',
  contacted: 'bg-amber-500/15 text-amber-200 border border-amber-500/30',
  waiting: 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30',
  confirmed: 'bg-green-500/15 text-green-200 border border-green-500/30',
  declined: 'bg-red-500/15 text-red-200 border border-red-500/30',
  closed: 'bg-gray-500/15 text-gray-200 border border-gray-500/30',
  spam: 'bg-pink-500/15 text-pink-200 border border-pink-500/30',
  expired: 'bg-orange-500/15 text-orange-200 border border-orange-500/30',
};

const STATUS_HELP_TEXT = {
  new: 'New request awaiting outreach (24-hour hold).',
  contacted: 'You have contacted the guest and are awaiting next steps.',
  waiting: 'Waiting on payment or guest confirmation.',
  confirmed: 'Seats are finalized and committed to this guest.',
  declined: 'Unable to accommodate the request.',
  closed: 'Conversation closed or guest released seats.',
  spam: 'Marked as spam / invalid.',
  expired: 'Hold expired automatically.',
};

const DETAIL_STATUS_OPTIONS = ['new', 'contacted', 'waiting', 'confirmed', 'declined', 'closed', 'spam', 'expired'];
const DEFAULT_STAFF_INBOX = 'midwayeventcenter@gmail.com';
const ROUTING_SOURCES = {
  event: 'Event override for this show',
  category: 'Category inbox set in Event Categories',
  category_slug: 'Beach Bands auto-routing',
  default: 'Default Midway staff inbox',
};

const resolveRoutingInfo = (request = {}) => {
  const email = request.seat_request_target_email || DEFAULT_STAFF_INBOX;
  const sourceKey = request.seat_request_target_source || 'default';
  const label = ROUTING_SOURCES[sourceKey] || ROUTING_SOURCES.default;
  return { email, label };
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
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

const normalizeStatus = (status) => (status || 'new').toLowerCase();
const isOpenStatus = (status) => OPEN_STATUSES.includes(normalizeStatus(status));
const isFinalStatus = (status) => FINAL_STATUSES.includes(normalizeStatus(status));

const parseSeats = (selectedSeats) => {
  if (!selectedSeats) return [];
  if (Array.isArray(selectedSeats)) return selectedSeats;
  try {
    const arr = typeof selectedSeats === 'string' ? JSON.parse(selectedSeats) : selectedSeats;
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
};

const textToSeatList = (text) => {
  if (!text) return [];
  return text
    .split(/[\n,]/)
    .map((seat) => seat.trim())
    .filter(Boolean);
};

const parseSeatSnapshot = (snapshot) => {
  if (!snapshot) return [];
  let raw = snapshot;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (err) {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.layout_data)) {
    return raw.layout_data;
  }
  return [];
};

const buildDisplaySeatList = (request) => {
  const seats = parseSeats(request.selected_seats || []);
  if (!seats.length) return [];
  if (Array.isArray(request.seat_display_labels) && request.seat_display_labels.length) {
    return request.seat_display_labels;
  }
  const snapshotRows = parseSeatSnapshot(request.seat_map_snapshot);
  if (!snapshotRows.length) {
    return seats;
  }
  const lookup = buildSeatLookupMap(snapshotRows.filter(isSeatRow));
  return seats.map((seatId) => describeSeatSelection(seatId, lookup[seatId]));
};

export default function SeatRequestsModule() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ status: 'open', eventId: 'all', search: '', groupByEvent: false });
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const displaySeatsForSelected = useMemo(
    () => (selectedRequest ? buildDisplaySeatList(selectedRequest) : []),
    [selectedRequest]
  );

  useEffect(() => {
    fetchEvents();
  }, []);
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    fetchRequests();
  }, [filters.status, filters.eventId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    setCollapsedGroups({});
  }, [filters.groupByEvent]);

  const fetchEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/events?scope=admin&limit=500&archived=all`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.events)) {
        const filtered = data.events.filter((ev) => {
          const seatingEnabled = Number(ev.seating_enabled) === 1;
          return seatingEnabled || !!ev.layout_id || !!ev.layout_version_id;
        });
        setEvents(filtered);
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
      setRequests([]);
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
        req.staff_notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [requests, filters.search]);

  const groupedRequests = useMemo(() => {
    if (!filters.groupByEvent) return [];
    const groups = new Map();
    visibleRequests.forEach((req) => {
      const key = req.event_id || 'unassigned';
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: req.event_title || 'Unassigned requests',
          start: req.start_datetime,
          requests: [],
        });
      }
      groups.get(key).requests.push(req);
    });
    return Array.from(groups.values()).sort((a, b) => {
      const aDate = a.start ? new Date(a.start).getTime() : 0;
      const bDate = b.start ? new Date(b.start).getTime() : 0;
      return aDate - bDate;
    });
  }, [filters.groupByEvent, visibleRequests]);

  const toggleGroup = (groupKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const eventOptions = useMemo(() => {
    const map = new Map();
    events.forEach((ev) => map.set(ev.id, ev));
    requests.forEach((req) => {
      if (req.event_id && !map.has(req.event_id)) {
        map.set(req.event_id, {
          id: req.event_id,
          title: req.event_title || `Event ${req.event_id}`,
          artist_name: req.event_title ? null : undefined,
        });
      }
    });
    return Array.from(map.values());
  }, [events, requests]);

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
        alert(data?.message || 'Failed to confirm request');
      }
    } catch (err) {
      console.error('Approve error', err);
      alert('Failed to confirm request');
    }
  };

  const denyRequest = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/seat-requests/${id}/deny`, { method: 'POST' });
      const data = await res.json();
      if (data?.success) {
        fetchRequests();
      } else {
        alert(data?.message || 'Failed to decline request');
      }
    } catch (err) {
      console.error('Deny error', err);
      alert('Failed to decline request');
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

  const changeStatus = (request, nextStatus) => {
    const payload = { status: nextStatus };
    if (nextStatus === 'closed' || nextStatus === 'declined' || nextStatus === 'spam') {
      payload.hold_expires_at = null;
    }
    updateRequest(request.id, payload);
  };

  const extendHoldQuick = (request, hours = 24) => {
    if (!request) return;
    const baseDate = request.hold_expires_at ? new Date(request.hold_expires_at) : new Date();
    if (Number.isNaN(baseDate.getTime())) return;
    baseDate.setHours(baseDate.getHours() + hours);
    updateRequest(request.id, {
      hold_expires_at: baseDate.toISOString(),
      status: request.status === 'expired' ? 'waiting' : request.status,
    });
  };

  const markExpired = (request) => {
    if (!request) return;
    updateRequest(request.id, { status: 'expired', hold_expires_at: null });
  };

  const openDetail = (req) => {
    const seats = parseSeats(req.selected_seats || '[]');
    setSelectedRequest(req);
    setEditForm({
      customer_name: req.customer_name || '',
      customer_email: req.customer_email || '',
      customer_phone: req.customer_phone || '',
      special_requests: req.special_requests || '',
      staff_notes: req.staff_notes || '',
      status: req.status || 'new',
      hold_expires_at: toLocalInputValue(req.hold_expires_at),
      selectedSeatsText: seats.join('\n'),
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
    if (!editForm) return;
    const base = editForm.hold_expires_at ? new Date(editForm.hold_expires_at) : new Date();
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
      };
      if (editForm.hold_expires_at) {
        payload.hold_expires_at = fromLocalInputValue(editForm.hold_expires_at);
      } else {
        payload.hold_expires_at = null;
      }
      if (!isFinalStatus(editForm.status)) {
        payload.selected_seats = textToSeatList(editForm.selectedSeatsText);
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

  const renderActionButtons = (req) => {
    const status = normalizeStatus(req.status);
    const buttons = [];
    if (status !== 'new') {
      buttons.push(
        <button
          key="new"
          onClick={() => changeStatus(req, 'new')}
          className="px-2 py-1 text-[11px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-200 rounded"
        >
          Mark new
        </button>
      );
    }
    if (status !== 'contacted') {
      buttons.push(
        <button
          key="contacted"
          onClick={() => changeStatus(req, 'contacted')}
          className="px-2 py-1 text-[11px] bg-amber-600/20 hover:bg-amber-600/40 text-amber-100 rounded"
        >
          Contacted
        </button>
      );
    }
    if (status !== 'waiting') {
      buttons.push(
        <button
          key="waiting"
          onClick={() => changeStatus(req, 'waiting')}
          className="px-2 py-1 text-[11px] bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-100 rounded"
        >
          Waiting
        </button>
      );
    }
    if (!isFinalStatus(status)) {
      buttons.push(
        <button
          key="confirm"
          onClick={() => approveRequest(req.id)}
          className="px-2 py-1 text-[11px] bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-1"
        >
          <CheckCircle className="h-3.5 w-3.5" /> Confirm
        </button>
      );
      buttons.push(
        <button
          key="decline"
          onClick={() => denyRequest(req.id)}
          className="px-2 py-1 text-[11px] bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-1"
        >
          <XCircle className="h-3.5 w-3.5" /> Decline
        </button>
      );
      buttons.push(
        <button
          key="close"
          onClick={() => changeStatus(req, 'closed')}
          className="px-2 py-1 text-[11px] bg-gray-600/40 hover:bg-gray-600/60 text-gray-100 rounded"
        >
          Close
        </button>
      );
      buttons.push(
        <button
          key="spam"
          onClick={() => changeStatus(req, 'spam')}
          className="px-2 py-1 text-[11px] bg-pink-600/25 hover:bg-pink-600/45 text-pink-100 rounded"
        >
          Spam
        </button>
      );
    } else {
      buttons.push(
        <button
          key="reopen"
          onClick={() => changeStatus(req, 'waiting')}
          className="px-2 py-1 text-[11px] bg-purple-600/30 hover:bg-purple-600/50 text-purple-100 rounded"
        >
          Reopen
        </button>
      );
    }
    buttons.push(
      <button
        key="view"
        onClick={() => openDetail(req)}
        className="px-2 py-1 text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-1"
      >
        <Edit3 className="h-3.5 w-3.5" /> View
      </button>
    );
    buttons.push(
      <button
        key="delete"
        onClick={() => deleteRequest(req.id)}
        className="px-2 py-1 text-[11px] bg-gray-700 hover:bg-gray-600 text-white rounded flex items-center gap-1"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    );
    return (
      <div className="flex flex-wrap gap-2 justify-end">
        {buttons}
      </div>
    );
  };

  const renderTable = (data, { hideEventColumn = false } = {}) => {
    if (!data.length) {
      return (
        <div className="p-6 bg-gray-800 rounded text-center text-gray-400 border border-gray-700">
          No seat requests match the current filters.
        </div>
      );
    }
    return (
      <div className="bg-gray-900 rounded-xl overflow-hidden border border-purple-500/20">
        <table className="w-full">
          <thead className="bg-gray-950 text-left text-sm text-gray-300">
            <tr>
              <th className="px-4 py-3">Customer</th>
              {!hideEventColumn && <th className="px-4 py-3">Event</th>}
              <th className="px-4 py-3">Seats</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Hold / Timeline</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((req) => {
              const displaySeats = buildDisplaySeatList(req);
              const status = normalizeStatus(req.status);
              const badge = STATUS_BADGES[status] || 'bg-gray-500/15 text-gray-200 border border-gray-500/30';
              const expiredHold = isHoldExpired(req.hold_expires_at) && isOpenStatus(status);
              const isExpired = status === 'expired';
              const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
              const holdDisplay = req.hold_expires_at
                ? formatDateTime(req.hold_expires_at)
                : (isFinalStatus(status) ? 'Released' : 'Not set');
              const routing = resolveRoutingInfo(req);
              return (
                <tr
                  key={req.id}
                  className={`border-t border-gray-800 hover:bg-gray-800/40 ${expiredHold ? 'bg-red-900/10' : ''} ${isExpired ? 'opacity-75' : ''}`}
                >
                  <td className="px-4 py-3 align-top">
                    <div className={`text-sm font-semibold ${isExpired ? 'text-gray-500 line-through' : 'text-white'}`}>{req.customer_name || 'Guest'}</div>
                    <div className={`text-xs mt-0.5 ${isExpired ? 'text-gray-600 line-through' : 'text-gray-400'}`}>
                      {req.special_requests ? `Guest notes: ${req.special_requests}` : 'No guest notes'}
                    </div>
                    {req.staff_notes && (
                      <div className={`text-xs mt-1 ${isExpired ? 'text-purple-200/70 line-through' : 'text-purple-200'}`}>
                        Staff: {req.staff_notes}
                      </div>
                    )}
                  </td>
                  {!hideEventColumn && (
                    <td className="px-4 py-3 align-top">
                      <div className={`text-sm ${isExpired ? 'text-gray-500 line-through' : 'text-white'}`}>{req.event_title || `Event ${req.event_id}`}</div>
                      <div className={`text-xs ${isExpired ? 'text-gray-600 line-through' : 'text-gray-400'}`}>{formatDateTime(req.start_datetime)}</div>
                    </td>
                  )}
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-1">
                      {displaySeats.slice(0, 4).map((seat) => (
                        <span key={seat} className="px-2 py-1 bg-purple-600/50 text-purple-100 rounded text-xs">{seat}</span>
                      ))}
                      {displaySeats.length > 4 && (
                        <span className="px-2 py-1 bg-gray-600 text-white rounded text-xs">+{displaySeats.length - 4}</span>
                      )}
                    </div>
                    {displaySeats.length === 0 && (
                      <div className="text-xs text-gray-400">No seats listed</div>
                    )}
                  </td>
                  <td className={`px-4 py-3 align-top text-sm ${isExpired ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                    <div>{req.customer_email || 'No email'}</div>
                    <div className={`text-xs ${isExpired ? 'text-gray-600 line-through' : 'text-gray-400'}`}>{req.customer_phone || 'No phone'}</div>
                    <div className="mt-2 text-xs text-gray-400">
                      Seat requests notify:{' '}
                      <span className="text-gray-100">{routing.email}</span>
                      <div className="text-[11px] text-gray-500">{routing.label}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-flex items-center gap-1 ${badge} ${expiredHold ? 'ring-1 ring-red-500/60' : ''}`}>
                      {expiredHold && status !== 'expired' ? `${statusLabel} (expired)` : statusLabel}
                    </span>
                    {STATUS_HELP_TEXT[status] && (
                      <p className="mt-1 text-[11px] text-gray-400 max-w-[240px]">
                        {STATUS_HELP_TEXT[status]}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-gray-300">
                    <div>Hold: {holdDisplay}</div>
                    {req.hold_expires_at && (
                      <div className={`text-xs ${expiredHold ? 'text-red-400' : 'text-green-400'}`}>
                        {describeHoldWindow(req.hold_expires_at)}
                      </div>
                    )}
                    <div className="text-xs text-gray-500 mt-1">Created {formatDateTime(req.created_at)}</div>
                    <div className="text-xs text-gray-500">Updated {formatDateTime(req.updated_at)}</div>
                    {(isOpenStatus(status) || status === 'expired') && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => extendHoldQuick(req, 24)}
                          className="px-2 py-1 text-[11px] bg-blue-600/20 hover:bg-blue-600/40 text-blue-200 rounded flex items-center gap-1"
                        >
                          <Clock className="h-3.5 w-3.5" /> +24h
                        </button>
                        {expiredHold && status !== 'expired' && (
                          <button
                            type="button"
                            onClick={() => markExpired(req)}
                            className="px-2 py-1 text-[11px] bg-red-600/20 hover:bg-red-600/40 text-red-200 rounded"
                          >
                            Mark expired
                          </button>
                        )}
                        {isOpenStatus(status) && (
                          <button
                            type="button"
                            onClick={() => changeStatus(req, 'closed')}
                            className="px-2 py-1 text-[11px] bg-gray-600/30 hover:bg-gray-600/50 text-gray-200 rounded"
                          >
                            Release hold
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {renderActionButtons(req)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Seat Requests</h1>
          <p className="text-sm text-gray-400">Track holds, outreach, and finalized seat assignments.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManualModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
          >
            <Plus className="h-4 w-4" /> New Manual Reservation
          </button>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-800 rounded text-sm hover:bg-gray-300 dark:hover:bg-gray-700"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <select
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          className="px-3 py-2 bg-gray-800 text-white rounded min-w-[220px]"
        >
          {STATUS_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={filters.eventId}
          onChange={(e) => setFilters((prev) => ({ ...prev, eventId: e.target.value }))}
          className="px-3 py-2 bg-gray-800 text-white rounded min-w-[220px]"
        >
          <option value="all">All events</option>
          {eventOptions.map((ev) => (
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
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={filters.groupByEvent}
            onChange={(e) => setFilters((prev) => ({ ...prev, groupByEvent: e.target.checked }))}
            className="w-4 h-4 rounded border-gray-600 bg-gray-800"
          />
          Group by event
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>
      ) : filters.groupByEvent ? (
        groupedRequests.length === 0 ? (
          <div className="p-6 bg-gray-800 rounded text-center text-gray-400 border border-gray-700">
            No seat requests match the current filters.
          </div>
        ) : (
          <div className="space-y-4">
            {groupedRequests.map((group) => {
              const collapsed = collapsedGroups[group.key];
              return (
                <div key={group.key} className="border border-gray-800 rounded-xl bg-gray-900/60">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left text-sm text-gray-200 hover:bg-gray-800/70"
                  >
                    <div className="flex items-center gap-2">
                      {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      <div>
                        <div className="font-semibold">{group.title}</div>
                        <div className="text-xs text-gray-400">{formatDateTime(group.start)}</div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400">{group.requests.length} requests</span>
                  </button>
                  {!collapsed && (
                    <div className="p-4 pt-0">
                      {renderTable(group.requests, { hideEventColumn: true })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        renderTable(visibleRequests)
      )}

      {showManualModal && (
        <ManualReservationModal
          events={eventOptions}
          onClose={() => setShowManualModal(false)}
          onCreated={() => {
            setShowManualModal(false);
            fetchRequests();
          }}
        />
      )}

      {selectedRequest && editForm && (() => {
        const detailRouting = resolveRoutingInfo(selectedRequest || {});
        return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl max-w-4xl w-full border border-purple-500/30 shadow-2xl">
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
              <div className="bg-gray-800 border border-gray-700/80 rounded-xl p-4 flex items-start gap-3">
                <div className="p-2 bg-purple-600/20 rounded-full text-purple-200">
                  <Info className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">Seat requests notify</p>
                  <p className="text-lg text-white font-semibold">{detailRouting.email}</p>
                  <p className="text-sm text-gray-400">{detailRouting.label}</p>
                </div>
              </div>
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
                      <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
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
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-400 mb-1">Hold expiration</label>
                  <div className="flex flex-col md:flex-row gap-2">
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div>
                <label className="block text-sm text-gray-400 mb-1">Selected seats</label>
                {displaySeatsForSelected.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {displaySeatsForSelected.map((seat) => (
                      <span key={seat} className="px-2 py-1 bg-purple-600/40 text-purple-100 rounded text-xs">{seat}</span>
                    ))}
                  </div>
                )}
                {isFinalStatus(editForm.status) ? (
                  <div className="px-3 py-2 bg-gray-800 text-gray-200 rounded text-sm whitespace-pre-wrap">
                    {editForm.selectedSeatsText || 'Seats locked after confirmation'}
                  </div>
                ) : (
                  <textarea
                    name="selectedSeatsText"
                    value={editForm.selectedSeatsText}
                    onChange={handleDetailChange}
                    rows="3"
                    placeholder="One seat per line (e.g., Rect Table-Row 1-1)"
                    className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                  />
                )}
                {!isFinalStatus(editForm.status) ? (
                  <p className="text-xs text-gray-500 mt-1">Seats update when you save. They are locked once the request is confirmed.</p>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">Seats are locked because this request is finalized. Reopen the request to edit seats.</p>
                )}
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
      )})()}
    </div>
  );
}

// Marker: seat requests lifecycle overhaul applied
export const SEAT_REQUESTS_UPDATES = true;

function ManualReservationModal({ events = [], onClose = () => {}, onCreated = () => {} }) {
  const [selectedEventId, setSelectedEventId] = useState(events[0]?.id ? String(events[0].id) : '');
  const [layoutRows, setLayoutRows] = useState([]);
  const [reservedSeats, setReservedSeats] = useState([]);
  const [pendingSeats, setPendingSeats] = useState([]);
  const [stagePosition, setStagePosition] = useState({ x: 50, y: 10 });
  const [stageSize, setStageSize] = useState({ width: 200, height: 80 });
  const [canvasSettings, setCanvasSettings] = useState({ width: 1200, height: 800 });
  const [selectedSeats, setSelectedSeats] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '', status: 'confirmed' });
  const [loadingLayout, setLoadingLayout] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canvasWidth = canvasSettings?.width || 1200;
  const canvasHeight = canvasSettings?.height || 800;
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const titleId = 'manual-reservation-title';
  useFocusTrap(dialogRef, { onClose, enabled: true, initialFocusRef: closeButtonRef });

  const activeRows = useMemo(
    () => layoutRows.filter((r) => {
      const type = r.element_type || 'table';
      return r.is_active !== false && type !== 'marker' && type !== 'area';
    }),
    [layoutRows]
  );

  useEffect(() => {
    if (selectedEventId) {
      setSelectedSeats([]);
      fetchLayout(selectedEventId);
    }
  }, [selectedEventId]);

  const fetchLayout = async (eventId) => {
    setLoadingLayout(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/seating/event/${eventId}`);
      const data = await res.json();
      if (data?.success) {
        setLayoutRows(Array.isArray(data.seating) ? data.seating : []);
        setReservedSeats(data.reservedSeats || []);
        setPendingSeats(data.pendingSeats || []);
        if (data.stagePosition) setStagePosition(data.stagePosition);
        if (data.stageSize) setStageSize(data.stageSize);
        if (data.canvasSettings) {
          setCanvasSettings({
            width: data.canvasSettings.width || 1200,
            height: data.canvasSettings.height || 800,
          });
        }
      } else {
        setError(data?.message || 'Failed to load seating layout');
      }
    } catch (err) {
      console.error('Failed to fetch layout', err);
      setError('Network error loading seating');
    } finally {
      setLoadingLayout(false);
    }
  };

  const toggleSeat = (seatId, rowReserved = [], rowPending = []) => {
    if (rowReserved.includes(seatId) || rowPending.includes(seatId)) {
      return;
    }
    setSelectedSeats((prev) =>
      prev.includes(seatId) ? prev.filter((id) => id !== seatId) : [...prev, seatId]
    );
  };

  const handleSubmit = async () => {
    if (!selectedEventId) {
      setError('Select an event');
      return;
    }
    if (selectedSeats.length === 0) {
      setError('Select at least one seat');
      return;
    }
    if (form.name.trim() === '' || form.phone.trim() === '') {
      setError('Name and phone are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        event_id: Number(selectedEventId),
        customer_name: form.name,
        contact: { phone: form.phone, email: form.email || undefined },
        selected_seats: selectedSeats,
        special_requests: form.notes || undefined,
        status: form.status,
      };
      const res = await fetch(`${API_BASE}/admin/seat-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.success) {
        onCreated();
      } else {
        setError(data?.message || 'Failed to create reservation');
      }
    } catch (err) {
      console.error('Manual reservation error', err);
      setError('Network error creating reservation');
    } finally {
      setSaving(false);
    }
  };

  const legendItems = [
    { key: 'available', label: seatingStatusLabels.available, className: seatingLegendSwatches.available },
    { key: 'selected', label: seatingStatusLabels.selected, className: seatingLegendSwatches.selected },
    { key: 'pending', label: seatingStatusLabels.pending, className: seatingLegendSwatches.pending },
    { key: 'reserved', label: seatingStatusLabels.reserved, className: seatingLegendSwatches.reserved },
  ];

  const selectedEvent = events.find((ev) => String(ev.id) === String(selectedEventId));
  const hasPositions = activeRows.some((r) => r.pos_x !== null && r.pos_y !== null && r.pos_x !== undefined && r.pos_y !== undefined);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-gray-900 rounded-2xl w-full max-w-6xl max-h-[95vh] overflow-y-auto border border-purple-500/30 shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h3 id={titleId} className="text-xl font-semibold text-white">Manual Reservation</h3>
            {selectedEvent && (
              <p className="text-sm text-gray-400">
                {selectedEvent.artist_name || selectedEvent.title || `Event ${selectedEvent.id}`}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-800 text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400"
            aria-label="Close manual reservation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 rounded bg-red-600/20 border border-red-600 text-red-200 text-sm">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Event</label>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded"
              >
                <option value="">Select an event</option>
                {events.map((ev) => (
                  <option key={ev.id} value={String(ev.id)}>
                    {ev.artist_name || ev.title || `Event ${ev.id}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Customer name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Phone</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email (optional)</label>
              <input
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded"
              >
                <option value="confirmed">Finalize immediately</option>
                <option value="new">New hold (24h)</option>
                <option value="waiting">Waiting for payment</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="relative h-[420px] bg-gray-100 dark:bg-gray-900 rounded-xl overflow-auto border border-purple-500/20">
                {(!selectedEventId || loadingLayout) && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                    {loadingLayout ? 'Loading layout…' : 'Select an event to see seats'}
                  </div>
                )}
                {selectedEventId && !loadingLayout && !hasPositions && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                    No seating layout available for this event
                  </div>
                )}
                {selectedEventId && !loadingLayout && hasPositions && (
                  <div
                    className="relative mx-auto"
                    style={{
                      width: canvasWidth,
                      height: canvasHeight,
                      minWidth: canvasWidth,
                      minHeight: canvasHeight,
                    }}
                  >
                    <div
                      className="absolute bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 rounded-lg font-bold shadow-lg flex items-center justify-center"
                      style={{
                        left: `${stagePosition.x}%`,
                        top: `${stagePosition.y}%`,
                        transform: 'translate(-50%, -50%)',
                        width: `${stageSize.width}px`,
                        height: `${stageSize.height}px`,
                      }}
                    >
                      STAGE
                    </div>
                    {activeRows.map((row) => {
                      if (row.pos_x === null || row.pos_y === null || row.pos_x === undefined || row.pos_y === undefined) {
                        return null;
                      }
                      const reservedForRow = reservedSeats.filter((seatId) =>
                        seatId.startsWith(`${row.section_name || row.section}-${row.row_label}-`)
                      );
                      const pendingForRow = pendingSeats.filter((seatId) =>
                        seatId.startsWith(`${row.section_name || row.section}-${row.row_label}-`)
                      );
                      return (
                        <div
                          key={`${row.id}-${row.row_label}`}
                          className="absolute"
                          style={{
                            left: `${row.pos_x}%`,
                            top: `${row.pos_y}%`,
                            transform: 'translate(-50%, -50%)',
                            padding: '20px',
                            minWidth: `${row.width || 120}px`,
                            minHeight: `${row.height || 120}px`,
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
                                onToggleSeat={(seatId) => toggleSeat(seatId, reservedForRow, pendingForRow)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="bg-gray-900/70 border border-purple-500/30 rounded-lg p-4">
                <div className="font-semibold text-white mb-3">Legend</div>
                {legendItems.map((item) => (
                  <div className="flex items-center gap-2 text-sm text-gray-200 mb-2 last:mb-0" key={item.key}>
                    <span className={`w-5 h-5 rounded ${item.className}`} />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              <div className="bg-gray-900/70 border border-purple-500/30 rounded-lg p-4">
                <div className="text-sm text-gray-300 mb-2">
                  Selected seats: <span className="font-semibold text-white">{selectedSeats.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedSeats.map((seatId) => (
                    <span key={seatId} className="px-3 py-1 bg-purple-600/60 text-white rounded text-xs">
                      {seatId}
                    </span>
                  ))}
                  {selectedSeats.length === 0 && (
                    <span className="text-xs text-gray-400">No seats selected</span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Internal notes</label>
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-800 text-white rounded"
                  placeholder="Payment details, wheelchair access, etc."
                />
              </div>
              <div className="text-sm text-gray-400">
                Seats in this reservation will immediately show as{' '}
                <span className="font-semibold text-white">Reserved</span> to the public when status is
                <span className="font-semibold text-white"> Finalized</span>. Using a hold status will block seats for 24 hours.
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Create reservation'}
          </button>
        </div>
      </div>
    </div>
  );
}
