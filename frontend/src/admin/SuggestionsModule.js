// SuggestionsModule: admin interface for reviewing artist suggestions
// Developer note: The suggestions API returns a normalized object where
// contact details are provided both as a raw `contact` JSON column and as
// flattened helper fields for easy rendering. Frontend expects fields like
// `contact_name`, `contact_email`, `contact_phone`, `music_links`,
// `social_media`, and `genre`. The component falls back to `contact` when
// flattened fields are missing — avoid rendering mailto: links unless an
// email value is present.
import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { API_BASE } from '../App';

const submissionClasses = {
  self: 'bg-purple-500/20 text-purple-400',
  fan: 'bg-blue-500/20 text-blue-400',
};

export default function SuggestionsModule(){
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchSuggestions = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/suggestions`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.error('Failed to fetch suggestions', err);
      setError('Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSuggestions(); }, []);

  const updateStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE}/suggestions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (data && data.success) fetchSuggestions();
      else alert('Failed to update status');
    } catch (err) {
      console.error('Update suggestion status error', err);
      alert('Failed to update status');
    }
  };

  const deleteSuggestion = async (id) => {
    if (!window.confirm('Are you sure you want to delete this suggestion? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/suggestions/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data && data.success) fetchSuggestions();
      else alert('Failed to delete suggestion');
    } catch (err) {
      console.error('Delete suggestion error', err);
      alert('Failed to delete suggestion');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Artist Suggestions</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {suggestions.length === 0 && <div className="p-6 bg-gray-800 rounded">No suggestions yet.</div>}

          {suggestions.map(s => (
            <div key={s.id} className="bg-gray-800 rounded-xl p-6 border border-purple-500/30">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-xl font-bold">{s.artist_name}</h3>
                  <div className="text-sm text-gray-400">{s.genre}</div>
                </div>
                <div className="text-right">
                  <div className={`inline-block px-3 py-1 rounded-full text-sm ${submissionClasses[s.submission_type] || ''}`}>{s.submission_type === 'self' ? 'Artist Submission' : 'Fan Suggestion'}</div>
                  <div className="text-xs text-gray-500 mt-1">{s.status}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 mb-3">
                {(s.contact_name || s.contact_email || s.contact || s.message) ? (
                  <div>
                    <strong>Contact:</strong>{' '}
                    {s.contact_name ? <span>{s.contact_name}</span> : (s.contact && s.contact.name ? <span>{s.contact.name}</span> : <span className="text-gray-400">(no name)</span>)}
                    {' '}
                    {s.contact_email ? (
                      <a className="text-blue-400" href={`mailto:${s.contact_email}`}>{s.contact_email}</a>
                    ) : (s.contact && s.contact.email ? (
                      <a className="text-blue-400" href={`mailto:${s.contact.email}`}>{s.contact.email}</a>
                    ) : null)}
                    {!s.contact_email && !s.contact?.email && !s.message && !s.contact && !s.contact_name && (
                      <span className="text-gray-400 ml-2">No contact info provided</span>
                    )}
                  </div>
                ) : null}

                {(s.contact_phone || (s.contact && s.contact.phone)) && (
                  <div><strong>Phone:</strong> {s.contact_phone || s.contact.phone}</div>
                )}

                {(s.music_links || (s.contact && s.contact.music_links)) && (
                  <div><strong>Music:</strong> <div className="text-blue-400 break-words">{s.music_links || s.contact.music_links}</div></div>
                )}

                {(s.social_media || (s.contact && s.contact.social_media)) && (
                  <div><strong>Social:</strong> <div className="text-blue-400 break-words">{s.social_media || s.contact.social_media}</div></div>
                )}

                {/* Fallback: show raw notes/message if no contact fields present */}
                {!s.contact_name && !s.contact_email && !s.contact_phone && !s.music_links && !s.social_media && s.message && (
                  <div><strong>Notes:</strong> <div className="text-gray-300">{s.message}</div></div>
                )}
              </div>

              {s.message && (
                <div className="mb-4 text-gray-300">{s.message}</div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-400">Submitted: {new Date(s.created_at).toLocaleString()}</div>
                <div className="flex items-center gap-2">
                  {s.status === 'pending' && (
                    <>
                      <button onClick={() => updateStatus(s.id, 'approved')} className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-2"><CheckCircle className="h-4 w-4" /> Approve</button>
                      <button onClick={() => updateStatus(s.id, 'declined')} className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-2"><XCircle className="h-4 w-4" /> Decline</button>
                    </>
                  )}
                  <button onClick={() => deleteSuggestion(s.id)} className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white rounded flex items-center gap-2" title="Delete suggestion"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
 