// ArtistSuggestion: public form for users to suggest artists
// Developer note: This component sends flattened contact fields to the
// suggestions API (contact_name, contact_email, contact_phone, music_links,
// social_media, genre). The backend accepts either a `contact` object or
// these flattened fields and will persist them into the `contact` JSON
// column. The admin UI reads flattened helper fields (e.g. contact_name,
// contact_email) and falls back to the raw `contact` JSON when necessary.
import React, { useState } from 'react';
import { Music, Send, CheckCircle } from 'lucide-react';
import { API_BASE } from '../App';

const GENRES = ['Rock', 'Jazz', 'Country', 'Hip Hop', 'Electronic', 'Folk', 'Blues', 'R&B', 'Pop', 'Metal', 'Indie', 'Other'];

export default function ArtistSuggestion() {
  const [submissionType, setSubmissionType] = useState('self'); // 'self' | 'fan'
  const [form, setForm] = useState({
    artistName: '',
    genre: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    musicLinks: '',
    socialMedia: '',
    message: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.artistName || !form.contactName || !form.contactEmail) {
      setError('Please provide artist name, contact name, and contact email.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        submission_type: submissionType,
        artist_name: form.artistName,
        genre: form.genre,
        contact_name: form.contactName,
        contact_email: form.contactEmail,
        contact_phone: form.contactPhone,
        music_links: form.musicLinks,
        social_media: form.socialMedia,
        message: form.message
      };

      const res = await fetch(`${API_BASE}/suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setForm({ artistName: '', genre: '', contactName: '', contactEmail: '', contactPhone: '', musicLinks: '', socialMedia: '', message: '' });
        setTimeout(() => setSuccess(false), 3500);
      } else {
        setError(data.message || 'Failed to submit suggestion');
      }
    } catch (err) {
      console.error(err);
      setError('Network error - please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="py-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold">Suggest an Artist</h2>
          <p className="text-gray-300 mt-2">Know a great act? Tell us about them or submit as an artist.</p>
        </div>

        <div className="bg-gray-800 rounded-xl p-6 border border-purple-500/20">
          <div className="flex items-center gap-3 mb-4">
            <Music className="h-6 w-6 text-purple-400" />
            <div className="text-sm text-gray-300">Submission type</div>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setSubmissionType('self')}
                aria-pressed={submissionType === 'self'}
                className={`px-3 py-1 rounded ${submissionType === 'self' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}`}
              >
                I am the artist
              </button>
              <button
                type="button"
                onClick={() => setSubmissionType('fan')}
                aria-pressed={submissionType === 'fan'}
                className={`px-3 py-1 rounded ${submissionType === 'fan' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}`}
              >
                Recommend an artist
              </button>
            </div>
          </div>

          {success && (
            <div className="p-3 mb-4 bg-green-500/20 border border-green-500 text-green-300 rounded flex items-center gap-3" role="status" aria-live="polite">
              <CheckCircle className="h-5 w-5" />
              <div>Thanks! Your suggestion was submitted.</div>
            </div>
          )}

          {error && (
            <div className="p-3 mb-4 bg-red-500/10 border border-red-500 text-red-300 rounded" role="alert" aria-live="assertive">{error}</div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-white mb-2">Artist/Band Name</label>
                <input name="artistName" value={form.artistName} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" required />
              </div>

              <div>
                <label className="block text-white mb-2">Genre</label>
                <select name="genre" value={form.genre} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg">
                  <option value="">Select genre</option>
                  {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-white mb-2">Contact Name</label>
                <input name="contactName" value={form.contactName} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" required />
              </div>
              <div>
                <label className="block text-white mb-2">Contact Email</label>
                <input name="contactEmail" type="email" value={form.contactEmail} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" required />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-white mb-2">Contact Phone</label>
              <input name="contactPhone" value={form.contactPhone} onChange={handleChange} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" />
            </div>

            <div className="mt-3">
              <label className="block text-white mb-2">Music Links (Spotify, YouTube, etc.)</label>
              <input name="musicLinks" value={form.musicLinks} onChange={handleChange} placeholder="https://... , https://..." className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" />
            </div>

            <div className="mt-3">
              <label className="block text-white mb-2">Social Media</label>
              <input name="socialMedia" value={form.socialMedia} onChange={handleChange} placeholder="@artist, facebook.com/artist" className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg" />
            </div>

            <div className="mt-3">
              <label className="block text-white mb-2">Message / Why should we book this artist?</label>
              <textarea name="message" value={form.message} onChange={handleChange} rows={4} className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg resize-none" />
            </div>

            <div className="mt-6 flex justify-end items-center gap-3">
              <button type="submit" disabled={submitting} className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2">
                <Send className="h-4 w-4" /> {submitting ? 'Submitting...' : 'Submit Suggestion'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
