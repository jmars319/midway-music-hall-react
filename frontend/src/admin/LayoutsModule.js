// LayoutsModule: admin UI to create and manage seating layout templates
import React, { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Star, Eye, Copy } from 'lucide-react';
import { API_BASE } from '../App';

const initialForm = {
  name: '',
  description: '',
  is_default: false,
  layout_data: []
};

export default function LayoutsModule() {
  const [layouts, setLayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(null);

  const fetchLayouts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/seating-layouts`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.layouts)) {
        setLayouts(data.layouts);
      } else {
        setLayouts([]);
      }
    } catch (err) {
      console.error('Failed to fetch layouts', err);
      setLayouts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLayouts(); }, []);

  const openAdd = () => {
    setEditing(null);
    setFormData(initialForm);
    setShowForm(true);
    setError('');
  };

  const openEdit = (layout) => {
    setEditing(layout);
    setFormData({
      name: layout.name || '',
      description: layout.description || '',
      is_default: layout.is_default === 1,
      layout_data: layout.layout_data || []
    });
    setShowForm(true);
    setError('');
  };

  const openDuplicate = (layout) => {
    setEditing(null);
    setFormData({
      name: `${layout.name} (Copy)`,
      description: layout.description || '',
      is_default: false,
      layout_data: layout.layout_data || []
    });
    setShowForm(true);
    setError('');
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ 
      ...prev, 
      [name]: type === 'checkbox' ? checked : value 
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${API_BASE}/seating-layouts/${editing.id}` : `${API_BASE}/seating-layouts`;
      
      const payload = {
        name: formData.name,
        description: formData.description,
        is_default: formData.is_default ? 1 : 0,
        layout_data: formData.layout_data
      };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      const data = await res.json();
      if (data && data.success) {
        setShowForm(false);
        fetchLayouts();
      } else {
        setError(data.message || 'Failed to save layout');
      }
    } catch (err) {
      console.error('Save layout error', err);
      setError('Failed to save layout');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id, isDefault) => {
    if (isDefault) {
      alert('Cannot delete the default layout');
      return;
    }
    
    if (!window.confirm('Delete this layout? Events using this layout will fall back to the default.')) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/seating-layouts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data && data.success) {
        fetchLayouts();
      } else {
        alert(data.message || 'Failed to delete layout');
      }
    } catch (err) {
      console.error('Delete layout error', err);
      alert('Failed to delete layout');
    }
  };

  const handleSetDefault = async (id) => {
    if (!window.confirm('Set this as the default layout?')) {
      return;
    }

    try {
      const layout = layouts.find(l => l.id === id);
      const res = await fetch(`${API_BASE}/seating-layouts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...layout, is_default: 1 }),
      });
      
      const data = await res.json();
      if (data && data.success) {
        fetchLayouts();
      } else {
        alert(data.message || 'Failed to set default');
      }
    } catch (err) {
      console.error('Set default error', err);
      alert('Failed to set default');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Seating Layouts</h2>
          <p className="text-gray-500 dark:text-gray-400">Manage seating layout templates for events</p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
        >
          <Plus className="h-5 w-5" /> New Layout
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-12 w-12 border-4 border-purple-500 border-t-transparent rounded-full"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {layouts.map(layout => (
            <div 
              key={layout.id} 
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold">{layout.name}</h3>
                    {layout.is_default === 1 && (
                      <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 text-xs font-medium rounded flex items-center gap-1">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {layout.description || 'No description'}
                  </p>
                </div>
              </div>

              <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                {Array.isArray(layout.layout_data) ? layout.layout_data.length : 0} rows configured
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPreview(layout)}
                  className="flex-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-sm flex items-center justify-center gap-1"
                >
                  <Eye className="h-4 w-4" /> Preview
                </button>
                <button
                  onClick={() => openDuplicate(layout)}
                  className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  title="Duplicate"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  onClick={() => openEdit(layout)}
                  className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50"
                  title="Edit"
                >
                  <Edit className="h-4 w-4" />
                </button>
                {layout.is_default !== 1 && (
                  <>
                    <button
                      onClick={() => handleSetDefault(layout.id)}
                      className="px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/50"
                      title="Set as Default"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(layout.id, layout.is_default === 1)}
                      className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {layouts.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p>No layouts found. Create your first layout to get started.</p>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-bold mb-4">
              {editing ? 'Edit Layout' : 'New Layout'}
            </h3>

            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Layout Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Description</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                    rows={3}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="is_default"
                    id="is_default"
                    checked={formData.is_default}
                    onChange={handleChange}
                    className="w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
                  />
                  <label htmlFor="is_default" className="text-sm font-medium">
                    Set as default layout
                  </label>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    <strong>Note:</strong> To configure the actual seating arrangement (rows, seats, positions), 
                    use the <strong>Seating</strong> module after creating this layout. The layout name helps 
                    you organize different seating configurations for different event types.
                  </p>
                </div>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-300 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
                >
                  {submitting ? 'Saving...' : editing ? 'Update Layout' : 'Create Layout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-2xl font-bold">{showPreview.name}</h3>
                <p className="text-gray-500 dark:text-gray-400">{showPreview.description}</p>
              </div>
              <button
                onClick={() => setShowPreview(null)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                ✕
              </button>
            </div>

            <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4">
              <h4 className="font-semibold mb-2">Layout Data:</h4>
              {Array.isArray(showPreview.layout_data) && showPreview.layout_data.length > 0 ? (
                <div className="space-y-2">
                  {showPreview.layout_data.map((row, idx) => (
                    <div key={idx} className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-300 dark:border-gray-700">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div><strong>Section:</strong> {row.section_name || row.section}</div>
                        <div><strong>Row:</strong> {row.row_label}</div>
                        <div><strong>Seats:</strong> {row.total_seats}</div>
                        <div><strong>Type:</strong> {row.seat_type}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">No rows configured yet. Use the Seating module to add rows.</p>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowPreview(null)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
