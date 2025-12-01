// LayoutsModule: admin UI to create and manage seating layout templates with visual editor
import React, { useEffect, useState, useRef } from 'react';
import { Plus, Edit, Trash2, Star, Eye, Copy, Save, X } from 'lucide-react';
import { API_BASE } from '../App';
import TableComponent from '../components/TableComponent';

const initialForm = {
  name: '',
  description: '',
  is_default: false,
  layout_data: []
};

const seatTypes = ['general', 'premium', 'vip', 'accessible'];
const tableShapes = [
  { value: 'table-2', label: '2-Top Table', seats: 2 },
  { value: 'table-4', label: '4-Top Table', seats: 4 },
  { value: 'table-6', label: '6-Top Table', seats: 6 },
  { value: 'table-8', label: '8-Top Table', seats: 8 },
  { value: 'round-6', label: 'Round Table (6)', seats: 6 },
  { value: 'round-8', label: 'Round Table (8)', seats: 8 },
  { value: 'bar-6', label: 'Bar Seating (6)', seats: 6 },
  { value: 'booth-4', label: 'Booth (4)', seats: 4 },
  { value: 'standing-10', label: 'Standing (10)', seats: 10 },
  { value: 'standing-20', label: 'Standing (20)', seats: 20 }
];

export default function LayoutsModule() {
  const [layouts, setLayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingLayout, setEditingLayout] = useState(null);
  const [layoutRows, setLayoutRows] = useState([]);
  const [showAddRow, setShowAddRow] = useState(false);
  const [rowForm, setRowForm] = useState({
    section_name: '',
    row_label: '',
    seat_type: 'general',
    table_shape: 'table-6',
    total_seats: 6,
    pos_x: 50,
    pos_y: 50,
    rotation: 0
  });
  const containerRef = useRef(null);
  const [draggingRow, setDraggingRow] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(5); // percentage
  const [ghostPosition, setGhostPosition] = useState(null);
  const [stagePosition, setStagePosition] = useState({ x: 50, y: 10 });
  const [draggingStage, setDraggingStage] = useState(false);
  const [stageGhostPosition, setStageGhostPosition] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 200, height: 80 });
  const [resizingStage, setResizingStage] = useState(false);

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
    setEditingLayout(layout);
    setLayoutRows(Array.isArray(layout.layout_data) ? layout.layout_data.map((r, idx) => ({ ...r, id: r.id || `temp-${idx}` })) : []);
    // Load stage position and size from layout metadata if it exists
    if (layout.stage_position) {
      setStagePosition(layout.stage_position);
    } else {
      setStagePosition({ x: 50, y: 10 });
    }
    if (layout.stage_size) {
      setStageSize(layout.stage_size);
    } else {
      setStageSize({ width: 200, height: 80 });
    }
    setShowEditor(true);
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

  const openEditMetadata = (layout) => {
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

  // Visual editor functions
  const handleAddRow = () => {
    const shape = tableShapes.find(s => s.value === rowForm.table_shape);
    const newRow = {
      id: `temp-${Date.now()}`,
      section_name: rowForm.section_name || 'Main Floor',
      row_label: rowForm.row_label || `Row ${layoutRows.length + 1}`,
      seat_type: rowForm.seat_type,
      table_shape: rowForm.table_shape,
      total_seats: shape ? shape.seats : rowForm.total_seats,
      pos_x: rowForm.pos_x,
      pos_y: rowForm.pos_y,
      rotation: rowForm.rotation
    };
    setLayoutRows([...layoutRows, newRow]);
    setShowAddRow(false);
    setRowForm({
      section_name: '',
      row_label: '',
      seat_type: 'general',
      table_shape: 'table-6',
      total_seats: 6,
      pos_x: 50,
      pos_y: 50,
      rotation: 0
    });
  };

  const handleDeleteRow = (rowId) => {
    setLayoutRows(layoutRows.filter(r => r.id !== rowId));
  };

  const handleRowDragStart = (e, row) => {
    setDraggingRow(row);
    e.dataTransfer.effectAllowed = 'move';
  };

  const snapToGridValue = (value) => {
    if (!snapToGrid) return value;
    return Math.round(value / gridSize) * gridSize;
  };

  const handleCanvasDragOver = (e) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;

    // Snap to grid if enabled
    if (snapToGrid) {
      x = snapToGridValue(x);
      y = snapToGridValue(y);
    }

    if (draggingStage) {
      setStageGhostPosition({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
      return;
    }
    
    if (draggingRow) {
      setGhostPosition({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
    }
  };

  const handleCanvasDrop = (e) => {
    e.preventDefault();
    
    if (draggingStage) {
      handleStageDrop(e);
      return;
    }
    
    if (!draggingRow || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;

    // Snap to grid if enabled
    if (snapToGrid) {
      x = snapToGridValue(x);
      y = snapToGridValue(y);
    }

    setLayoutRows(layoutRows.map(r => 
      r.id === draggingRow.id 
        ? { ...r, pos_x: Math.max(0, Math.min(100, x)), pos_y: Math.max(0, Math.min(100, y)) }
        : r
    ));
    setDraggingRow(null);
    setGhostPosition(null);
  };

  const handleSaveLayout = async () => {
    if (!editingLayout) return;
    
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/seating-layouts/${editingLayout.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editingLayout,
          layout_data: layoutRows,
          stage_position: stagePosition,
          stage_size: stageSize
        }),
      });
      
      const data = await res.json();
      if (data && data.success) {
        setShowEditor(false);
        setEditingLayout(null);
        fetchLayouts();
      } else {
        alert(data.message || 'Failed to save layout');
      }
    } catch (err) {
      console.error('Save layout error', err);
      alert('Failed to save layout');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStageDragStart = (e) => {
    setDraggingStage(true);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleStageDrop = (e) => {
    e.preventDefault();
    if (!draggingStage || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;

    // Snap to grid if enabled
    if (snapToGrid) {
      x = snapToGridValue(x);
      y = snapToGridValue(y);
    }

    setStagePosition({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
    setDraggingStage(false);
    setStageGhostPosition(null);
  };

  const handleStageResize = (e, direction) => {
    e.stopPropagation();
    e.preventDefault();
    setResizingStage(true);
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = stageSize.width;
    const startHeight = stageSize.height;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;

      if (direction.includes('right')) {
        newWidth = Math.max(100, startWidth + deltaX);
      }
      if (direction.includes('left')) {
        newWidth = Math.max(100, startWidth - deltaX);
      }
      if (direction.includes('bottom')) {
        newHeight = Math.max(50, startHeight + deltaY);
      }
      if (direction.includes('top')) {
        newHeight = Math.max(50, startHeight - deltaY);
      }

      setStageSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setResizingStage(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleRotateRow = (rowId, delta) => {
    setLayoutRows(layoutRows.map(r => 
      r.id === rowId ? { ...r, rotation: (r.rotation + delta) % 360 } : r
    ));
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

              {/* Visual preview thumbnail */}
              <div className="mb-4 bg-gray-50 dark:bg-gray-900 rounded-lg p-3 h-32 relative overflow-hidden border border-gray-200 dark:border-gray-700">
                {Array.isArray(layout.layout_data) && layout.layout_data.length > 0 ? (
                  <div className="flex flex-wrap gap-1 items-center justify-center h-full">
                    {layout.layout_data.slice(0, 6).map((row, idx) => (
                      <div key={idx} className="text-xs">
                        <TableComponent
                          row={{...row, total_seats: Math.min(row.total_seats, 6)}}
                          tableShape={row.table_shape || 'table-6'}
                          selectedSeats={[]}
                          pendingSeats={[]}
                          onToggleSeat={() => {}}
                          interactive={false}
                        />
                      </div>
                    ))}
                    {layout.layout_data.length > 6 && (
                      <div className="text-xs text-gray-400 ml-2">+{layout.layout_data.length - 6} more</div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                    Empty layout
                  </div>
                )}
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
                    <strong>Note:</strong> After creating this layout, click the <strong>Edit</strong> button 
                    to open the visual editor where you can drag and drop tables, configure seating arrangements, 
                    and position everything exactly how you want it.
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

            <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-6">
              <h4 className="font-semibold mb-4">Layout Preview:</h4>
              {Array.isArray(showPreview.layout_data) && showPreview.layout_data.length > 0 ? (
                <div className="relative bg-gray-50 dark:bg-gray-800 rounded-lg p-8 min-h-[400px] border-2 border-dashed border-gray-300 dark:border-gray-600">
                  {/* Stage indicator */}
                  <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 px-6 py-2 rounded-lg font-semibold text-sm shadow-md">
                    STAGE
                  </div>
                  
                  {/* Render all tables/rows */}
                  <div className="mt-16 space-y-6">
                    {showPreview.layout_data.map((row, idx) => (
                      <div 
                        key={idx} 
                        className="relative"
                        style={{
                          position: row.pos_x && row.pos_y ? 'absolute' : 'relative',
                          left: row.pos_x ? `${row.pos_x}%` : 'auto',
                          top: row.pos_y ? `${row.pos_y}%` : 'auto',
                          transform: row.rotation ? `rotate(${row.rotation}deg)` : 'none'
                        }}
                      >
                        <div className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                          {row.section_name || row.section} - Row {row.row_label}
                        </div>
                        <TableComponent
                          row={row}
                          tableShape={row.table_shape || 'table-6'}
                          selectedSeats={[]}
                          pendingSeats={[]}
                          onToggleSeat={() => {}}
                          interactive={false}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">No rows configured yet.</p>
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

      {/* Visual Editor Modal */}
      {showEditor && editingLayout && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-7xl h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-2xl font-bold">{editingLayout.name}</h3>
                <p className="text-gray-500 dark:text-gray-400">Drag tables to position them</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveLayout}
                  disabled={submitting}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> {submitting ? 'Saving...' : 'Save Layout'}
                </button>
                <button
                  onClick={() => setShowEditor(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Grid Controls */}
            <div className="flex items-center gap-4 px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded"
                />
                <span className="text-sm font-medium">Show Grid</span>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={(e) => setSnapToGrid(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded"
                />
                <span className="text-sm font-medium">Snap to Grid</span>
              </label>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Grid Size:</span>
                <input
                  type="range"
                  min="2"
                  max="20"
                  step="1"
                  value={gridSize}
                  onChange={(e) => setGridSize(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400 w-8">{gridSize}%</span>
              </div>
            </div>

            {/* Main Editor Area */}
            <div className="flex-1 flex overflow-hidden">
              {/* Canvas */}
              <div 
                ref={containerRef}
                className="flex-1 bg-gray-100 dark:bg-gray-900 relative overflow-auto"
                onDrop={handleCanvasDrop}
                onDragOver={handleCanvasDragOver}
                style={{
                  backgroundImage: showGrid ? `
                    linear-gradient(to right, rgba(156, 163, 175, 0.2) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(156, 163, 175, 0.2) 1px, transparent 1px)
                  ` : 'none',
                  backgroundSize: showGrid ? `${gridSize}% ${gridSize}%` : 'auto'
                }}
              >
                <div className="relative" style={{ minHeight: '1600px', minWidth: '100%', padding: '60px' }}>
                  {/* Stage Ghost Preview */}
                  {stageGhostPosition && draggingStage && (
                    <div
                      className="absolute pointer-events-none border-4 border-dashed border-amber-500 bg-amber-200/30 dark:bg-amber-900/30 rounded-lg z-10"
                      style={{
                        left: `${stageGhostPosition.x}%`,
                        top: `${stageGhostPosition.y}%`,
                        transform: 'translate(-50%, -50%)',
                        width: `${stageSize.width}px`,
                        height: `${stageSize.height}px`,
                        opacity: 0.6
                      }}
                    />
                  )}

                  {/* Stage */}
                  <div 
                    draggable
                    onDragStart={handleStageDragStart}
                    className="absolute bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100 rounded-lg font-bold shadow-lg cursor-move hover:ring-2 hover:ring-amber-500 z-10 flex items-center justify-center"
                    style={{
                      left: `${stagePosition.x}%`,
                      top: `${stagePosition.y}%`,
                      transform: 'translate(-50%, -50%)',
                      width: `${stageSize.width}px`,
                      height: `${stageSize.height}px`
                    }}
                    title="Drag to reposition stage"
                  >
                    STAGE
                    
                    {/* Resize Handles */}
                    <div
                      className="absolute -right-1 -bottom-1 w-4 h-4 bg-amber-600 rounded-full cursor-se-resize hover:scale-125 transition-transform"
                      onMouseDown={(e) => handleStageResize(e, 'right-bottom')}
                      title="Resize stage"
                    />
                    <div
                      className="absolute -left-1 -bottom-1 w-4 h-4 bg-amber-600 rounded-full cursor-sw-resize hover:scale-125 transition-transform"
                      onMouseDown={(e) => handleStageResize(e, 'left-bottom')}
                      title="Resize stage"
                    />
                    <div
                      className="absolute -right-1 -top-1 w-4 h-4 bg-amber-600 rounded-full cursor-ne-resize hover:scale-125 transition-transform"
                      onMouseDown={(e) => handleStageResize(e, 'right-top')}
                      title="Resize stage"
                    />
                    <div
                      className="absolute -left-1 -top-1 w-4 h-4 bg-amber-600 rounded-full cursor-nw-resize hover:scale-125 transition-transform"
                      onMouseDown={(e) => handleStageResize(e, 'left-top')}
                      title="Resize stage"
                    />
                  </div>

                  {/* Table Ghost Preview */}
                  {ghostPosition && draggingRow && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${ghostPosition.x}%`,
                        top: `${ghostPosition.y}%`,
                        transform: `translate(-50%, -50%)`,
                        opacity: 0.5
                      }}
                    >
                      <div className="mb-1 text-xs font-medium text-purple-600 dark:text-purple-400 text-center">
                        {draggingRow.section_name} - {draggingRow.row_label}
                      </div>
                      <div 
                        className="border-4 border-dashed border-purple-500 rounded-lg bg-purple-200 dark:bg-purple-900/30"
                        style={{ transform: `rotate(${draggingRow.rotation || 0}deg)` }}
                      >
                        <TableComponent
                          row={draggingRow}
                          tableShape={draggingRow.table_shape || 'table-6'}
                          selectedSeats={[]}
                          pendingSeats={[]}
                          onToggleSeat={() => {}}
                          interactive={false}
                        />
                      </div>
                    </div>
                  )}

                  {/* Tables */}
                  {layoutRows.map((row) => (
                    <div
                      key={row.id}
                      draggable
                      onDragStart={(e) => handleRowDragStart(e, row)}
                      className="absolute cursor-move hover:ring-2 hover:ring-purple-500 rounded"
                      style={{
                        left: `${row.pos_x}%`,
                        top: `${row.pos_y}%`,
                        transform: `translate(-50%, -50%)`,
                        padding: '40px 20px',
                        minWidth: '120px',
                        minHeight: '120px'
                      }}
                    >
                      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 text-xs font-medium text-gray-700 dark:text-gray-300 text-center whitespace-nowrap z-20">
                        {row.section_name} - {row.row_label}
                      </div>
                      <div className="flex items-center justify-center" style={{ minHeight: '60px' }}>
                        <div style={{ transform: `rotate(${row.rotation || 0}deg)` }}>
                          <TableComponent
                            row={row}
                            tableShape={row.table_shape || 'table-6'}
                            selectedSeats={[]}
                            pendingSeats={[]}
                            onToggleSeat={() => {}}
                            interactive={false}
                          />
                        </div>
                      </div>
                      <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1 z-20">
                        <button
                          onClick={() => handleRotateRow(row.id, -45)}
                          className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                        >
                          ↶
                        </button>
                        <button
                          onClick={() => handleRotateRow(row.id, 45)}
                          className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                        >
                          ↷
                        </button>
                        <button
                          onClick={() => handleDeleteRow(row.id)}
                          className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sidebar */}
              <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 p-6 overflow-y-auto">
                <h4 className="font-bold text-lg mb-4">Add Table/Seating</h4>
                
                <button
                  onClick={() => setShowAddRow(!showAddRow)}
                  className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center justify-center gap-2 mb-4"
                >
                  <Plus className="h-4 w-4" /> Add Row
                </button>

                {showAddRow && (
                  <div className="space-y-3 mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    <div>
                      <label className="block text-xs font-medium mb-1">Section</label>
                      <input
                        type="text"
                        value={rowForm.section_name}
                        onChange={(e) => setRowForm({...rowForm, section_name: e.target.value})}
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
                        placeholder="Main Floor"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Row Label</label>
                      <input
                        type="text"
                        value={rowForm.row_label}
                        onChange={(e) => setRowForm({...rowForm, row_label: e.target.value})}
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
                        placeholder="A"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Table Type</label>
                      <select
                        value={rowForm.table_shape}
                        onChange={(e) => {
                          const shape = tableShapes.find(s => s.value === e.target.value);
                          setRowForm({...rowForm, table_shape: e.target.value, total_seats: shape ? shape.seats : 6});
                        }}
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
                      >
                        {tableShapes.map(shape => (
                          <option key={shape.value} value={shape.value}>
                            {shape.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Seat Type</label>
                      <select
                        value={rowForm.seat_type}
                        onChange={(e) => setRowForm({...rowForm, seat_type: e.target.value})}
                        className="w-full px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-sm"
                      >
                        {seatTypes.map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={handleAddRow}
                      className="w-full px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                    >
                      Add to Layout
                    </button>
                  </div>
                )}

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h5 className="font-semibold text-sm mb-2">Current Tables ({layoutRows.length})</h5>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {layoutRows.map((row) => (
                      <div key={row.id} className="text-xs p-2 bg-gray-50 dark:bg-gray-900 rounded">
                        <div className="font-medium">{row.section_name} - {row.row_label}</div>
                        <div className="text-gray-500">{row.table_shape} ({row.total_seats} seats)</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
