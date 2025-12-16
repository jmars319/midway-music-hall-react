import React, { useEffect, useState } from 'react';
import { API_BASE, SERVER_BASE, invalidateBrandingCache } from '../apiConfig';
import ResponsiveImage from '../components/ResponsiveImage';
import { invalidateSiteContentCache } from '../hooks/useSiteContent';

// SettingsModule: admin UI for business/stage settings

export default function SettingsModule(){
  const [settings, setSettings] = useState({});
  const [media, setMedia] = useState([]);
  const [heroMedia, setHeroMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedHeroImages, setSelectedHeroImages] = useState([]);
  const [selectedTgpHeroImages, setSelectedTgpHeroImages] = useState([]);

  const fetchMedia = async () => {
    try {
      const res = await fetch(`${API_BASE}/media?category=logo`);
      const data = await res.json();
      if (data && data.success) {
        setMedia(data.media || []);
      }
    } catch (err) {
      console.error('Failed to fetch media', err);
    }

    try {
      const res = await fetch(`${API_BASE}/media?category=hero`);
      const data = await res.json();
      if (data && data.success) {
        setHeroMedia(data.media || []);
      }
    } catch (err) {
      console.error('Failed to fetch hero media', err);
    }
  };

  const fetchSettings = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const data = await res.json();
      if (data && data.success && data.settings) {
        setSettings(data.settings);
        // Parse hero_images if it exists
        const assignImageSelection = (raw, setter) => {
          if (!raw) {
            setter([]);
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            setter(Array.isArray(parsed) ? parsed : []);
          } catch (e) {
            setter([]);
          }
        };
        assignImageSelection(data.settings.hero_images, setSelectedHeroImages);
        assignImageSelection(data.settings.tgp_hero_images, setSelectedTgpHeroImages);
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

  useEffect(() => { 
    fetchSettings(); 
    fetchMedia();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const settingsToSave = {
        ...settings,
        hero_images: JSON.stringify(selectedHeroImages),
        tgp_hero_images: JSON.stringify(selectedTgpHeroImages)
      };
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsToSave),
      });
      const data = await res.json();
      if (data && data.success) {
        invalidateSiteContentCache();
        invalidateBrandingCache();
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
          <div className="mb-6 p-3 bg-blue-500/10 border border-blue-500/30 text-blue-100 rounded text-sm">
            Business contact info, social links, policies, and lessons are now managed under <strong>Site Content</strong>.
          </div>
          
          <div className="mt-10 pt-6 border-t border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">The Gathering Place Hero</h3>
              <span className="text-xs text-gray-400 uppercase tracking-wide">TGP Route</span>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              Configure the hero shown on <code className="bg-black/30 px-2 py-1 rounded text-xs">/thegatheringplace</code>. 
              Defaults fall back to the main site hero if left blank.
            </p>

            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">TGP Hero Title</label>
                <input
                  name="tgp_hero_title"
                  value={settings.tgp_hero_title || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="The Gathering Place"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">TGP Hero Subtitle</label>
                <textarea
                  name="tgp_hero_subtitle"
                  value={settings.tgp_hero_subtitle || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  rows="2"
                  placeholder="Neighboring room for DJs, shag lessons, private rentals..."
                />
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">Selected TGP Hero Images ({selectedTgpHeroImages.length})</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  {selectedTgpHeroImages.map((imgUrl, idx) => (
                    <div key={`${imgUrl}-${idx}`} className="relative group">
                      <ResponsiveImage
                        src={`${SERVER_BASE}${imgUrl}`}
                        alt={`TGP Hero ${idx + 1}`}
                        width={320}
                        height={192}
                        className="w-full h-24 object-cover rounded border-2 border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedTgpHeroImages(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                      >
                        ×
                      </button>
                      <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Available Hero Images for TGP (click to add)</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {heroMedia
                    .filter(m => !selectedTgpHeroImages.includes(m.file_url))
                    .map(m => (
                      <div
                        key={`tgp-${m.id}`}
                        onClick={() => setSelectedTgpHeroImages(prev => [...prev, m.file_url])}
                        className="cursor-pointer hover:ring-2 hover:ring-blue-500 rounded transition"
                      >
                        <ResponsiveImage
                          src={`${SERVER_BASE}${m.file_url}`}
                          alt={m.original_name}
                          width={320}
                          height={192}
                          className="w-full h-24 object-cover rounded border border-gray-600"
                        />
                        <p className="text-xs text-gray-400 mt-1 truncate">{m.original_name}</p>
                      </div>
                    ))}
                </div>
                {heroMedia.filter(m => !selectedTgpHeroImages.includes(m.file_url)).length === 0 && (
                  <p className="text-sm text-gray-500 italic">No available hero images. Upload to the Hero category in Media Manager.</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={settings.tgp_hero_slideshow_enabled === 'true'}
                      onChange={(e) => setSettings(prev => ({ ...prev, tgp_hero_slideshow_enabled: e.target.checked ? 'true' : 'false' }))}
                      className="rounded bg-gray-700"
                    />
                    <span className="text-sm text-gray-300">Enable TGP Slideshow</span>
                  </label>
                  <p className="text-xs text-gray-500 ml-6">Rotate through selected TGP hero images</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">TGP Slideshow Interval (ms)</label>
                  <input
                    type="number"
                    name="tgp_hero_slideshow_interval"
                    value={settings.tgp_hero_slideshow_interval || '5000'}
                    onChange={handleChange}
                    min="2000"
                    step="1000"
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  />
                  <p className="text-xs text-gray-400 mt-1">Default: 5000ms</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-lg font-bold mb-4">Hero Section</h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Hero Title</label>
                <input name="hero_title" value={settings.hero_title || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" placeholder="Midway Music Hall" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Hero Subtitle</label>
                <textarea name="hero_subtitle" value={settings.hero_subtitle || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" rows="2" placeholder="Experience local and touring acts..." />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-lg font-bold mb-4">About Section</h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">About Title</label>
                <input name="about_title" value={settings.about_title || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" placeholder="About Midway Music Hall" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">About Description</label>
                <textarea name="about_description" value={settings.about_description || ''} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded" rows="5" placeholder="Description of your venue..." />
                <p className="text-xs text-gray-400 mt-1">Use double line breaks to separate paragraphs</p>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-lg font-bold mb-4">Hero Background Images</h3>
            <p className="text-sm text-gray-400 mb-4">Select images from the Hero category in Media Manager to use as hero backgrounds</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">Selected Hero Images ({selectedHeroImages.length})</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  {selectedHeroImages.map((imgUrl, idx) => (
                    <div key={idx} className="relative group">
                      <ResponsiveImage 
                        src={`${SERVER_BASE}${imgUrl}`} 
                        alt={`Hero ${idx + 1}`}
                        width={320}
                        height={192}
                        className="w-full h-24 object-cover rounded border-2 border-purple-500"
                      />
                      <button
                        type="button"
                        onClick={() => setSelectedHeroImages(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                      >
                        ×
                      </button>
                      <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-2 py-1 rounded">
                        {idx + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Available Hero Images (click to add)</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {heroMedia
                    .filter(m => !selectedHeroImages.includes(m.file_url))
                    .map(m => (
                      <div 
                        key={m.id} 
                        onClick={() => setSelectedHeroImages(prev => [...prev, m.file_url])}
                        className="cursor-pointer hover:ring-2 hover:ring-purple-500 rounded transition"
                      >
                        <ResponsiveImage 
                          src={`${SERVER_BASE}${m.file_url}`} 
                          alt={m.original_name}
                          width={320}
                          height={192}
                          className="w-full h-24 object-cover rounded border border-gray-600"
                        />
                        <p className="text-xs text-gray-400 mt-1 truncate">{m.original_name}</p>
                      </div>
                    ))}
                </div>
                {heroMedia.filter(m => !selectedHeroImages.includes(m.file_url)).length === 0 && (
                  <p className="text-sm text-gray-500 italic">No hero images available. Upload images with "Hero" category in Media Manager.</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      checked={settings.hero_slideshow_enabled === 'true'}
                      onChange={(e) => setSettings(prev => ({ ...prev, hero_slideshow_enabled: e.target.checked ? 'true' : 'false' }))}
                      className="rounded bg-gray-700"
                    />
                    <span className="text-sm text-gray-300">Enable Slideshow</span>
                  </label>
                  <p className="text-xs text-gray-500 ml-6">Auto-rotate through hero images</p>
                </div>

                <div>
                  <label className="block text-sm text-gray-300 mb-1">Slideshow Interval (ms)</label>
                  <input 
                    type="number" 
                    name="hero_slideshow_interval" 
                    value={settings.hero_slideshow_interval || '5000'} 
                    onChange={handleChange}
                    min="2000"
                    step="1000"
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded" 
                  />
                  <p className="text-xs text-gray-400 mt-1">Default: 5000ms (5 seconds)</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-lg font-bold mb-3">Beach Series Pricing</h3>
            <p className="text-sm text-gray-400 mb-4">
              This overrides the Beach Bands pricing badge across the public site. Leave blank to fall back to each event&apos;s own price.
            </p>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Beach Price Label</label>
                <input
                  name="beach_price_label"
                  value={settings.beach_price_label || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="$15 advance / $20 door"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Beach Price Note (optional)</label>
                <textarea
                  name="beach_price_note"
                  value={settings.beach_price_note || ''}
                  onChange={handleChange}
                  rows="2"
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded"
                  placeholder="Includes reserved seating · Cash or card at the door"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <h3 className="text-lg font-bold mb-4">Site Images</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-2">Navigation Logo</label>
                <select 
                  name="site_logo" 
                  value={settings.site_logo || ''} 
                  onChange={handleChange} 
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded mb-2"
                >
                  <option value="">Select Logo...</option>
                  {media.map(m => (
                    <option key={m.id} value={m.file_url}>{m.original_name}</option>
                  ))}
                </select>
                {settings.site_logo && (
                  <ResponsiveImage 
                    src={`${SERVER_BASE}${settings.site_logo}`} 
                    alt="Current logo" 
                    width={256}
                    height={128}
                    className="w-32 h-auto border border-gray-600 rounded object-contain"
                    priority
                  />
                )}
                <p className="text-xs text-gray-400 mt-1">Upload logos in Media Manager</p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Default Event Image</label>
                <select 
                  name="default_event_image" 
                  value={settings.default_event_image || ''} 
                  onChange={handleChange} 
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded mb-2"
                >
                  <option value="">Select Image...</option>
                  {media.map(m => (
                    <option key={m.id} value={m.file_url}>{m.original_name}</option>
                  ))}
                </select>
                {settings.default_event_image && (
                  <ResponsiveImage 
                    src={`${SERVER_BASE}${settings.default_event_image}`} 
                    alt="Default event" 
                    width={256}
                    height={160}
                    className="w-32 h-auto border border-gray-600 rounded object-cover"
                  />
                )}
                <p className="text-xs text-gray-400 mt-1">Used when events have no image</p>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-2">Square Icon / Avatar</label>
                <select
                  name="site_brand_mark"
                  value={settings.site_brand_mark || ''}
                  onChange={handleChange}
                  className="w-full px-4 py-2 bg-gray-700 text-white rounded mb-2"
                >
                  <option value="">Use navigation logo</option>
                  {media.map((m) => (
                    <option key={m.id} value={m.file_url}>{m.original_name}</option>
                  ))}
                </select>
                {settings.site_brand_mark && (
                  <ResponsiveImage
                    src={`${SERVER_BASE}${settings.site_brand_mark}`}
                    alt="Brand icon"
                    width={128}
                    height={128}
                    className="w-24 h-24 border border-gray-600 rounded object-cover"
                  />
                )}
                <p className="text-xs text-gray-400 mt-1">Used for avatars and compact brand marks.</p>
              </div>
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
 
