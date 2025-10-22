import React, { useEffect, useState } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { API_BASE } from '../App';

const initialForm = {
  artist_name: '',
  event_date: '',
  event_time: '',
  genre: '',
  description: '',
  image_url: '',
  ticket_price: '',
  door_price: '',
  age_restriction: 'All Ages',
  venue_section: '',
};

export default function EventsModule(){
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/events`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.events)) {
        setEvents(data.events);
      } else {
        setEvents([]);
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvents(); }, []);

  const openAdd = () => {
    setEditing(null);
    setFormData(initialForm);
    setShowForm(true);
  };

  const openEdit = (event) => {
    setEditing(event);
    setFormData({
      artist_name: event.artist_name || '',
      event_date: event.event_date || '',
      event_time: event.event_time || '',
      genre: event.genre || '',
      description: event.description || '',
      image_url: event.image_url || '',
      ticket_price: event.ticket_price || '',
      door_price: event.door_price || '',
      age_restriction: event.age_restriction || 'All Ages',
      venue_section: event.venue_section || '',
    });
    setShowForm(true);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${API_BASE}/events/${editing.id}` : `${API_BASE}/events`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (data && data.success) {
        setShowForm(false);
        fetchEvents();
      } else {
        setError('Failed to save event');
      }
    } catch (err) {
      console.error('Save event error', err);
      setError('Failed to save event');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this event?')) return;
    try {
      const res = await fetch(`${API_BASE}/events/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data && data.success) {
        fetchEvents();
      } else {
        alert('Failed to delete');
      }
    } catch (err) {
      console.error('Delete error', err);
      alert('Delete failed');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Events</h1>
        <div>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">
            <Plus className="h-4 w-4" /> Add Event
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl overflow-hidden border border-purple-500/30">
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Artist</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Date</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Time</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Genre</th>
                <th className="px-4 py-3 text-left text-sm text-gray-300">Price</th>
                <th className="px-4 py-3 text-right text-sm text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.id} className="border-t border-gray-700 hover:bg-gray-700/40">
                  <td className="px-4 py-3">{ev.artist_name}</td>
                  <td className="px-4 py-3">{ev.event_date}</td>
                  <td className="px-4 py-3">{ev.event_time}</td>
                  <td className="px-4 py-3">{ev.genre}</td>
                  <td className="px-4 py-3">${ev.ticket_price}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button onClick={() => openEdit(ev)} className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded"><Edit className="h-4 w-4" /></button>
                      <button onClick={() => handleDelete(ev.id)} className="p-2 bg-red-600 hover:bg-red-700 text-white rounded"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-50 overflow-auto">
          <div className="bg-gray-800 rounded-xl max-w-3xl w-full p-6 border border-purple-500/30">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">{editing ? 'Edit Event' : 'Add Event'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">Close</button>
            </div>

            {error && <div className="mb-4 p-3 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>}

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Artist Name*</label>
                <input name="artist_name" value={formData.artist_name} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Genre</label>
                <input name="genre" value={formData.genre} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Event Date*</label>
                <input type="date" name="event_date" value={formData.event_date} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Event Time*</label>
                <input type="time" name="event_time" value={formData.event_time} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Ticket Price*</label>
                <input name="ticket_price" value={formData.ticket_price} onChange={handleChange} type="number" step="0.01" required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Door Price*</label>
                <input name="door_price" value={formData.door_price} onChange={handleChange} type="number" step="0.01" required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Age Restriction</label>
                <select name="age_restriction" value={formData.age_restriction} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded">
                  <option>All Ages</option>
                  <option>18+</option>
                  <option>21+</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Venue Section</label>
                <input name="venue_section" value={formData.venue_section} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Image URL</label>
                <input name="image_url" value={formData.image_url} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm text-gray-300 mb-1">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange} rows="4" className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">{submitting ? 'Saving...' : 'Save Event'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
 