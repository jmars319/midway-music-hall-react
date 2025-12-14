import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../App';

const initialEditState = { id: null, name: '' };

export default function CategoriesModule() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editState, setEditState] = useState(initialEditState);
  const [pendingAction, setPendingAction] = useState(null);

  const loadCategories = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/event-categories`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.categories)) {
        setCategories(data.categories);
      } else {
        setError(data?.message || 'Unable to load categories.');
      }
    } catch (err) {
      console.error('Failed to load categories', err);
      setError('Unable to load categories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const handleCreate = async (evt) => {
    evt.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/event-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to create category');
      }
      setNewName('');
      await loadCategories();
    } catch (err) {
      console.error('Create category failed', err);
      setError(err.message || 'Unable to create category.');
    } finally {
      setCreating(false);
    }
  };

  const startRename = (category) => {
    setEditState({ id: category.id, name: category.name });
  };

  const cancelRename = () => {
    setEditState(initialEditState);
  };

  const saveRename = async () => {
    if (!editState.id || !editState.name.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/event-categories/${editState.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editState.name.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to rename category');
      }
      setEditState(initialEditState);
      await loadCategories();
    } catch (err) {
      console.error('Rename category failed', err);
      setError(err.message || 'Unable to rename category.');
    }
  };

  const toggleActive = (category) => {
    if (category.is_system && category.is_active) {
      alert('System categories cannot be deactivated.');
      return;
    }
    if (category.is_active) {
      setPendingAction({
        type: 'deactivate',
        category,
        replacementId: '',
      });
    } else {
      updateCategory(category.id, { is_active: true });
    }
  };

  const updateCategory = async (id, payload) => {
    try {
      const res = await fetch(`${API_BASE}/event-categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to update category');
      }
      await loadCategories();
    } catch (err) {
      console.error('Update category failed', err);
      setError(err.message || 'Unable to update category.');
    }
  };

  const confirmDeactivate = async () => {
    if (!pendingAction?.category) return;
    await updateCategory(pendingAction.category.id, {
      is_active: false,
      replacement_category_id: pendingAction.replacementId ? Number(pendingAction.replacementId) : null,
    });
    setPendingAction(null);
  };

  const selectableReplacementOptions = useMemo(() => {
    if (!pendingAction?.category) return [];
    return categories
      .filter((cat) => cat.id !== pendingAction.category.id && cat.is_active)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pendingAction, categories]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Event Categories</h1>
          <p className="text-sm text-gray-400">Manage routing tags for events and seat request workflows.</p>
        </div>
        <button
          type="button"
          onClick={loadCategories}
          className="px-3 py-2 rounded bg-gray-800 text-sm border border-gray-600 hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      <form onSubmit={handleCreate} className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm text-gray-300 mb-1">New category name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Workshops"
              className="w-full px-3 py-2 rounded bg-gray-800 text-white border border-gray-700"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {creating ? 'Adding...' : 'Add Category'}
          </button>
        </div>
        <p className="text-xs text-gray-500">Slug is auto-generated and remains stable after creation.</p>
      </form>

      {error && (
        <div className="p-3 rounded border border-red-600 bg-red-900/30 text-red-100 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
          <table className="min-w-full divide-y divide-gray-800">
            <thead className="bg-gray-800/60 text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Slug</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Events</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 text-sm text-gray-200">
              {categories.map((category) => {
                const editing = editState.id === category.id;
                return (
                  <tr key={category.id}>
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editState.name}
                            onChange={(e) => setEditState((prev) => ({ ...prev, name: e.target.value }))}
                            className="px-2 py-1 rounded bg-gray-800 border border-gray-600 flex-1"
                          />
                          <button
                            type="button"
                            onClick={saveRename}
                            className="px-2 py-1 rounded bg-green-600 text-white text-xs"
                            disabled={!editState.name.trim()}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            className="px-2 py-1 rounded bg-gray-700 text-white text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span>{category.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{category.slug}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${category.is_active ? 'bg-green-500/10 text-green-200 border border-green-500/30' : 'bg-gray-700 text-gray-200 border border-gray-600'}`}>
                        {category.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{category.is_system ? 'System' : 'Custom'}</td>
                    <td className="px-4 py-3">{category.usage_count || 0}</td>
                    <td className="px-4 py-3 space-x-2">
                      {!editing && (
                        <button
                          type="button"
                          onClick={() => startRename(category)}
                          className="text-xs px-2 py-1 rounded border border-blue-500 text-blue-200 hover:bg-blue-500/10"
                        >
                          Rename
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleActive(category)}
                        className="text-xs px-2 py-1 rounded border border-amber-500 text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                        disabled={category.is_system && category.is_active}
                      >
                        {category.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {categories.length === 0 && (
            <div className="p-6 text-center text-gray-400">No categories yet.</div>
          )}
        </div>
      )}

      {pendingAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full space-y-4">
            <h2 className="text-xl font-semibold">Deactivate “{pendingAction.category.name}”?</h2>
            <p className="text-sm text-gray-300">
              Existing events will keep this category even if it is inactive. You can optionally migrate them to another category now.
            </p>
            <label className="block text-sm text-gray-300 mb-1">Replacement category (optional)</label>
            <select
              value={pendingAction.replacementId}
              onChange={(e) => setPendingAction((prev) => ({ ...prev, replacementId: e.target.value }))}
              className="w-full px-3 py-2 rounded bg-gray-800 text-white border border-gray-700"
            >
              <option value="">Leave assigned as-is</option>
              {selectableReplacementOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="px-3 py-2 rounded bg-gray-700 text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeactivate}
                className="px-3 py-2 rounded bg-amber-600 text-white"
              >
                Confirm Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
