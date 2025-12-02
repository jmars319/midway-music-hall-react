// MediaManager: admin interface for uploading and organizing images
import React, { useEffect, useState } from 'react';
import { Upload, Trash2, Image as ImageIcon, X } from 'lucide-react';
import { API_BASE } from '../App';

const categories = [
  { value: 'all', label: 'All Files', color: 'bg-gray-500' },
  { value: 'logo', label: 'Logos', color: 'bg-purple-500' },
  { value: 'hero', label: 'Hero Images', color: 'bg-blue-500' },
  { value: 'gallery', label: 'Gallery', color: 'bg-green-500' },
  { value: 'other', label: 'Other', color: 'bg-gray-500' },
];

export default function MediaManager() {
  const [media, setMedia] = useState([]);
  const [filteredMedia, setFilteredMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadCategory, setUploadCategory] = useState('other');
  const [editingMedia, setEditingMedia] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  const fetchMedia = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/media`);
      const data = await res.json();
      if (data.success) {
        setMedia(data.media || []);
      }
    } catch (err) {
      console.error('Failed to fetch media', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  useEffect(() => {
    if (activeCategory === 'all') {
      setFilteredMedia(media);
    } else {
      setFilteredMedia(media.filter(m => m.category === activeCategory));
    }
  }, [media, activeCategory]);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('category', uploadCategory);

    try {
      const res = await fetch(`${API_BASE}/media`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setSelectedFile(null);
        setPreviewUrl(null);
        fetchMedia();
      } else {
        alert('Upload failed');
      }
    } catch (err) {
      console.error('Upload error', err);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateMedia = async (id, updates) => {
    try {
      const res = await fetch(`${API_BASE}/media/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.success) {
        fetchMedia();
        setEditingMedia(null);
      } else {
        alert('Update failed');
      }
    } catch (err) {
      console.error('Update error', err);
      alert('Update failed');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this image? This cannot be undone.')) return;

    try {
      const res = await fetch(`${API_BASE}/media/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        fetchMedia();
      } else {
        alert('Delete failed');
      }
    } catch (err) {
      console.error('Delete error', err);
      alert('Delete failed');
    }
  };

  const copyUrl = (url) => {
    const fullUrl = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(fullUrl);
    alert('URL copied to clipboard!');
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Media Manager</h1>
      </div>

      {/* Upload Section */}
      <div className="bg-gray-800 rounded-xl p-6 mb-6 border border-purple-500/30">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Upload className="h-5 w-5" /> Upload Image
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Select File</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
            />

            <label className="block text-sm font-medium mt-4 mb-2">Category</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
            >
              {categories.filter(c => c.value !== 'all').map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>

            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="mt-4 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>

          {previewUrl && (
            <div>
              <label className="block text-sm font-medium mb-2">Preview</label>
              <div className="relative">
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full h-48 object-cover rounded border border-gray-600"
                />
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setPreviewUrl(null);
                  }}
                  className="absolute top-2 right-2 p-1 bg-red-600 hover:bg-red-700 rounded-full"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {categories.map(cat => (
          <button
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
              activeCategory === cat.value
                ? `${cat.color} text-white`
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {cat.label} {cat.value === 'all' ? `(${media.length})` : `(${media.filter(m => m.category === cat.value).length})`}
          </button>
        ))}
      </div>

      {/* Media Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : filteredMedia.length === 0 ? (
        <div className="text-center py-12 bg-gray-800 rounded-xl border border-gray-700">
          <ImageIcon className="h-12 w-12 mx-auto text-gray-500 mb-3" />
          <p className="text-gray-400">No images in this category</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredMedia.map(item => (
            <div key={item.id} className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700 hover:border-purple-500 transition-colors">
              <div className="relative aspect-video">
                <img
                  src={`${API_BASE}${item.file_url}`}
                  alt={item.alt_text || item.original_name}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => setEditingMedia(item)}
                />
                <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs text-white ${
                  categories.find(c => c.value === item.category)?.color || 'bg-gray-500'
                }`}>
                  {categories.find(c => c.value === item.category)?.label || item.category}
                </div>
              </div>

              <div className="p-3">
                <p className="text-sm font-medium truncate mb-1">{item.original_name}</p>
                <p className="text-xs text-gray-400 mb-2">{formatFileSize(item.file_size)}</p>

                <div className="flex gap-2">
                  <button
                    onClick={() => copyUrl(item.file_url)}
                    className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded"
                  >
                    Copy URL
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingMedia && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-700">
              <h3 className="text-xl font-bold">Edit Image</h3>
              <button
                onClick={() => setEditingMedia(null)}
                className="p-2 hover:bg-gray-700 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-4">
                <img
                  src={`${API_BASE}${editingMedia.file_url}`}
                  alt={editingMedia.alt_text || editingMedia.original_name}
                  className="w-full max-h-96 object-contain rounded border border-gray-700"
                />
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Filename</label>
                  <p className="px-4 py-2 bg-gray-700 rounded text-gray-300">{editingMedia.filename}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Category</label>
                  <select
                    value={editingMedia.category}
                    onChange={(e) => setEditingMedia({ ...editingMedia, category: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
                  >
                    {categories.filter(c => c.value !== 'all').map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Alt Text</label>
                  <input
                    type="text"
                    value={editingMedia.alt_text || ''}
                    onChange={(e) => setEditingMedia({ ...editingMedia, alt_text: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
                    placeholder="Description for accessibility"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Caption</label>
                  <textarea
                    value={editingMedia.caption || ''}
                    onChange={(e) => setEditingMedia({ ...editingMedia, caption: e.target.value })}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded border border-gray-600"
                    rows="3"
                    placeholder="Optional caption"
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <button
                    onClick={() => handleUpdateMedia(editingMedia.id, {
                      category: editingMedia.category,
                      alt_text: editingMedia.alt_text,
                      caption: editingMedia.caption
                    })}
                    className="flex-1 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={() => setEditingMedia(null)}
                    className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
