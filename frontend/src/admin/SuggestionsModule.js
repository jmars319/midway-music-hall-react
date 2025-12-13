import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Trash2, Edit2, X } from 'lucide-react';
import { API_BASE } from '../App';

const submissionClasses = {
  self: 'bg-purple-500/20 text-purple-300',
  fan: 'bg-blue-500/20 text-blue-300',
};

const statusOptions = [
  { value: 'new', label: 'New', color: 'bg-blue-500/20 text-blue-300' },
  { value: 'contacted', label: 'Contacted', color: 'bg-yellow-500/20 text-yellow-300' },
  { value: 'considering', label: 'Considering', color: 'bg-purple-500/20 text-purple-300' },
  { value: 'booked', label: 'Booked', color: 'bg-green-500/20 text-green-300' },
  { value: 'not_interested', label: 'Not Interested', color: 'bg-gray-500/20 text-gray-300' },
  { value: 'archived', label: 'Archived', color: 'bg-gray-700/30 text-gray-300' },
];

const typeLabels = {
  self: 'Artist Submission',
  fan: 'Fan Suggestion',
  general: 'General',
};

export default function SuggestionsModule() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchSuggestions = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/suggestions`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.error('Failed to fetch suggestions', err);
      setError('Failed to load suggestions');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSuggestions();
  }, []);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((item) => {
      const status = (item.status || 'new').toLowerCase();
      const type = (item.submission_type || 'general').toLowerCase();
      if (filterStatus !== 'all' && status !== filterStatus) return false;
      if (filterType !== 'all' && type !== filterType) return false;

      if (startDate) {
        const created = new Date(item.created_at);
        if (Number.isFinite(created.getTime())) {
          const start = new Date(`${startDate}T00:00:00`);
          if (created < start) return false;
        }
      }

      if (endDate) {
        const created = new Date(item.created_at);
        if (Number.isFinite(created.getTime())) {
          const end = new Date(`${endDate}T23:59:59`);
          if (created > end) return false;
        }
      }

      if (normalizedSearch) {
        const haystack = [
          item.artist_name,
          item.name,
          item.genre,
          item.contact_name,
          item.contact_email,
          item.contact_phone,
          item.social_media,
          item.music_links,
          item.notes,
          item.message,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }

      return true;
    });
  }, [suggestions, filterStatus, filterType, startDate, endDate, normalizedSearch]);

  const statusCounts = useMemo(() => {
    return suggestions.reduce((acc, item) => {
      const key = (item.status || 'new').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [suggestions]);

  const handleStatusChange = async (suggestionId, newStatus) => {
    try {
      const res = await fetch(`${API_BASE}/suggestions/${suggestionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!data?.success) throw new Error('Update failed');
      fetchSuggestions();
    } catch (err) {
      console.error('Update suggestion status error', err);
      alert('Failed to update status');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this submission? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/suggestions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data?.success) throw new Error('Delete failed');
      fetchSuggestions();
    } catch (err) {
      console.error('Delete suggestion error', err);
      alert('Failed to delete suggestion');
    }
  };

  const handleSave = async (formData) => {
    if (!selectedSuggestion) return;
    setSaving(true);
    try {
      const payload = {
        artist_name: formData.artist_name,
        submission_type: formData.submission_type,
        status: formData.status,
        notes: formData.notes,
        contact_name: formData.contact_name,
        contact_email: formData.contact_email,
        contact_phone: formData.contact_phone,
        music_links: formData.music_links,
        social_media: formData.social_media,
        genre: formData.genre,
      };
      const res = await fetch(`${API_BASE}/suggestions/${selectedSuggestion.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data?.success) throw new Error('Save failed');
      setSelectedSuggestion(null);
      fetchSuggestions();
    } catch (err) {
      console.error('Failed to save suggestion', err);
      alert('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const sortedTypes = useMemo(() => {
    const unique = new Set();
    suggestions.forEach((item) => {
      if (item.submission_type) unique.add(item.submission_type);
    });
    return Array.from(unique);
  }, [suggestions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Artist Suggestions</h1>
          <p className="text-sm text-gray-500">Manage fan and artist submissions with filters and quick actions.</p>
        </div>
        <button
          onClick={fetchSuggestions}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="bg-gray-900 rounded-xl border border-purple-500/20 p-4 space-y-4">
        <div className="flex items-center gap-3 text-sm text-gray-300 flex-wrap">
          {statusOptions.map((opt) => (
            <div key={opt.value} className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${opt.color.replace('text-', 'bg-')}`} />
              <span>
                {opt.label}: {statusCounts[opt.value] || 0}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col">

  // Marker: suggestions admin enhancements applied (filters, counts, inline edits)
  export const SUGGESTIONS_MODULE_UPDATED = true;
            <label className="text-xs uppercase text-gray-400 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Source</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All sources</option>
              {sortedTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type] || type}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-xs uppercase text-gray-400 mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="text-xs uppercase text-gray-400 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Artist, contact, genre..."
                className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-12 w-12 border-4 border-purple-600 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>
      ) : filteredSuggestions.length === 0 ? (
        <div className="p-6 bg-gray-900 rounded-xl border border-gray-800 text-center text-gray-400">
          No suggestions found for the selected filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredSuggestions.map((suggestion) => {
            const currentStatus =
              statusOptions.find((opt) => opt.value === suggestion.status) || statusOptions[0];
            const typeLabel = typeLabels[suggestion.submission_type] || 'Submission';
            return (
              <div
                key={suggestion.id}
                className="bg-gray-900 rounded-xl border border-purple-500/20 p-5 space-y-4 flex flex-col"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-semibold">{suggestion.artist_name || suggestion.name}</h3>
                    <div className="text-sm text-gray-400">{suggestion.genre || 'Unspecified genre'}</div>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        submissionClasses[suggestion.submission_type] || 'bg-gray-700/40 text-gray-300'
                      }`}
                    >
                      {typeLabel}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${currentStatus.color}`}>
                      {currentStatus.label}
                    </span>
                  </div>
                </div>

                <div className="text-sm text-gray-300 space-y-2 flex-1">
                  {suggestion.contact_name && (
                    <div>
                      <strong>Contact:</strong> {suggestion.contact_name}
                    </div>
                  )}
                  {suggestion.contact_email && (
                    <div>
                      <strong>Email:</strong>{' '}
                      <a className="text-blue-400" href={`mailto:${suggestion.contact_email}`}>
                        {suggestion.contact_email}
                      </a>
                    </div>
                  )}
                  {suggestion.contact_phone && (
                    <div>
                      <strong>Phone:</strong>{' '}
                      <a className="text-blue-400" href={`tel:${suggestion.contact_phone}`}>
                        {suggestion.contact_phone}
                      </a>
                    </div>
                  )}
                  {suggestion.music_links && (
                    <div>
                      <strong>Music:</strong>{' '}
                      <span className="break-words text-blue-300">{suggestion.music_links}</span>
                    </div>
                  )}
                  {suggestion.social_media && (
                    <div>
                      <strong>Social:</strong>{' '}
                      <span className="break-words text-blue-300">{suggestion.social_media}</span>
                    </div>
                  )}
                  {suggestion.message && (
                    <div>
                      <strong>Notes:</strong>
                      <p className="text-gray-400 mt-1 whitespace-pre-line">{suggestion.message}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Submitted {formatDateTime(suggestion.created_at)}</span>
                  {suggestion.updated_at && (
                    <span>Updated {formatDateTime(suggestion.updated_at)}</span>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-gray-800">
                  <select
                    value={suggestion.status || 'new'}
                    onChange={(e) => handleStatusChange(suggestion.id, e.target.value)}
                    className="px-3 py-1 rounded-lg bg-gray-800 border border-gray-700 text-sm"
                  >
                    {statusOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedSuggestion(suggestion)}
                      className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm flex items-center gap-1"
                    >
                      <Edit2 className="h-4 w-4" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(suggestion.id)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex items-center gap-1 text-red-300"
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedSuggestion && (
        <SuggestionDetailModal
          suggestion={selectedSuggestion}
          onClose={() => setSelectedSuggestion(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}

function SuggestionDetailModal({ suggestion, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => buildFormState(suggestion));

  useEffect(() => {
    setForm(buildFormState(suggestion));
  }, [suggestion]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl border border-purple-500/30 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div>
            <h3 className="text-xl font-semibold">Edit Submission</h3>
            <p className="text-sm text-gray-400">
              Update artist info, contact details, and review notes before saving.
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Artist name</label>
              <input
                name="artist_name"
                value={form.artist_name}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Submission type</label>
              <select
                name="submission_type"
                value={form.submission_type}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              >
                <option value="self">Artist Submission</option>
                <option value="fan">Fan Suggestion</option>
                <option value="general">General</option>
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Status</label>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Genre</label>
              <input
                name="genre"
                value={form.genre}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Phone</label>
              <input
                name="contact_phone"
                value={form.contact_phone}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Contact name</label>
              <input
                name="contact_name"
                value={form.contact_name}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Contact email</label>
              <input
                name="contact_email"
                type="email"
                value={form.contact_email}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Music links</label>
              <textarea
                name="music_links"
                rows={2}
                value={form.music_links}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Social links</label>
              <textarea
                name="social_media"
                rows={2}
                value={form.social_media}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Notes</label>
            <textarea
              name="notes"
              rows={4}
              value={form.notes}
              onChange={handleChange}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:bg-gray-600"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function buildFormState(suggestion) {
  return {
    artist_name: suggestion.artist_name || suggestion.name || '',
    submission_type: suggestion.submission_type || 'general',
    status: suggestion.status || 'new',
    genre: suggestion.genre || '',
    contact_name: suggestion.contact_name || '',
    contact_email: suggestion.contact_email || '',
    contact_phone: suggestion.contact_phone || '',
    music_links: suggestion.music_links || '',
    social_media: suggestion.social_media || '',
    notes: suggestion.notes || suggestion.message || '',
  };
}

function formatDateTime(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
