import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../apiConfig';

const initialFilters = {
  action: '',
  entityType: '',
  actor: '',
  dateFrom: '',
  dateTo: '',
  limit: '200',
};

export default function AuditLogModule() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLogs = useCallback(async (activeFilters = initialFilters) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(activeFilters).forEach(([key, value]) => {
        if (value) {
          params.set(key === 'entityType' ? 'entity_type' : key === 'dateFrom' ? 'date_from' : key === 'dateTo' ? 'date_to' : key, value);
        }
      });
      const res = await fetch(`${API_BASE}/audit-log?${params.toString()}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to load audit log');
      }
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err) {
      console.error('loadLogs error', err);
      setError(err.message || 'Unable to load logs.');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(initialFilters);
  }, [fetchLogs]);

  const groupedActions = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.action))).sort();
  }, [logs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Audit Log</h1>
          <p className="text-sm text-gray-400">Recent administrative changes across events, seat requests, categories, and settings.</p>
        </div>
        <button
          type="button"
          onClick={() => fetchLogs(filters)}
          className="px-4 py-2 rounded bg-gray-800 text-white border border-gray-700 hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Action</label>
            <select
              value={filters.action}
              onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
              className="px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 text-sm"
            >
              <option value="">All actions</option>
              {groupedActions.map((action) => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Entity Type</label>
            <input
              type="text"
              value={filters.entityType}
              onChange={(e) => setFilters((prev) => ({ ...prev, entityType: e.target.value }))}
              className="px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 text-sm"
              placeholder="event, seat_request..."
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Actor</label>
            <input
              type="text"
              value={filters.actor}
              onChange={(e) => setFilters((prev) => ({ ...prev, actor: e.target.value }))}
              className="px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 text-sm"
              placeholder="Admin name/email"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Date From</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              className="px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 text-sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Date To</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              className="px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 text-sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Limit</label>
            <input
              type="number"
              min="25"
              max="1000"
              value={filters.limit}
              onChange={(e) => setFilters((prev) => ({ ...prev, limit: e.target.value }))}
              className="px-3 py-2 rounded bg-gray-800 text-white border border-gray-700 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setFilters(initialFilters);
              fetchLogs(initialFilters);
            }}
            className="px-3 py-2 rounded bg-gray-800 text-gray-200 text-sm border border-gray-700"
          >
            Clear Filters
          </button>
          <button
            type="button"
            onClick={() => fetchLogs(filters)}
            className="px-4 py-2 rounded bg-purple-600 text-white text-sm hover:bg-purple-700"
          >
            Apply Filters
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded border border-red-600 bg-red-900/30 text-red-100 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : logs.length === 0 ? (
        <div className="p-6 text-center text-gray-400 bg-gray-900 border border-gray-800 rounded-xl">
          No activity recorded for the selected filters.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="min-w-full divide-y divide-gray-800 text-sm">
            <thead className="bg-gray-800/60 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left">Timestamp</th>
                <th className="px-4 py-3 text-left">Actor</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Entity</th>
                <th className="px-4 py-3 text-left">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-gray-100">
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400">
                    {log.created_at ? new Date(log.created_at).toLocaleString() : 'n/a'}
                  </td>
                  <td className="px-4 py-3">{log.actor || 'system'}</td>
                  <td className="px-4 py-3">{log.action}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col text-xs">
                      <span className="font-mono">{log.entity_type}</span>
                      {log.entity_id && <span className="text-gray-400">#{log.entity_id}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {log.meta ? (
                      <pre className="text-xs text-gray-300 bg-gray-950/80 rounded p-2 overflow-auto max-h-32">{JSON.stringify(log.meta, null, 2)}</pre>
                    ) : (
                      <span className="text-xs text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
