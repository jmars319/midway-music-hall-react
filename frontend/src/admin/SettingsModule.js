import React, { useEffect, useState } from 'react';
import { API_BASE } from '../App';

// SettingsModule: admin UI for business/stage settings

export default function SettingsModule(){
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const data = await res.json();
      if (data && data.success && data.settings) {
        setSettings(data.settings);
      } else {
        setSettings({});
      }
    } catch (err) {
      console.error('Failed to fetch settings', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSettings(); }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data && data.success) {
        // optionally refetch
        fetchSettings();
      } else {
        setError('Failed to save settings');
      }
    } catch (err) {
      console.error('Save settings error', err);
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <form onSubmit={handleSave} className="bg-gray-800 rounded-xl p-6 border border-purple-500/30 max-w-3xl">
          {error && <div className="mb-4 p-3 bg-red-600/10 border border-red-600 text-red-400 rounded">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1">Business Name</label>
              <input name="business_name" value={settings.business_name || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1">Phone</label>
              <input name="business_phone" value={settings.business_phone || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1">Email</label>
              <input name="business_email" value={settings.business_email || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-gray-300 mb-1">Address</label>
              <input name="business_address" value={settings.business_address || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button type="submit" disabled={saving} className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded">{saving ? 'Saving...' : 'Save Settings'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
 