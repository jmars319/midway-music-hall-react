// LayoutsModule: admin UI to create and manage seating layout templates with visual editor
import React, { useEffect, useState, useRef } from 'react';
import { Plus, Edit, Trash2, Star, Eye, Copy, Save, X, ZoomIn, ZoomOut, RotateCcw, Move, Shapes } from 'lucide-react';
import { API_BASE } from '../apiConfig';
import TableComponent from '../components/TableComponent';
import SeatingChart from '../components/SeatingChart';
import { buildSeatLabel, normalizeSeatLabels, resolveRowHeaderLabels } from '../utils/seatLabelUtils';

const isDevBuild = process.env.NODE_ENV !== 'production';

const initialForm = {
  name: '',
  description: '',
  is_default: false,
  layout_data: []
};

const seatTypes = ['general', 'premium', 'vip', 'accessible'];
const tableShapes = [
  { value: 'table-2', label: '2-Top Table', seats: 2 },
  { value: 'high-top-2', label: '2-Seat High-Top', seats: 2 },
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

const TABLE_SHAPE_ALIASES = {
  'table-8-rect': 'table-8',
};

const normalizeTableShapeValue = (shape) => {
  if (!shape) return shape;
  return TABLE_SHAPE_ALIASES[shape] || shape;
};

const canvasPresets = [
  { key: 'standard', label: 'Standard (120′ × 80′)', width: 1200, height: 800 },
  { key: 'wide', label: 'Wide Room (150′ × 90′)', width: 1500, height: 900 },
  { key: 'deep', label: 'Deep Room (100′ × 140′)', width: 1000, height: 1400 }
];

const quickObjects = [
  { key: 'rect-6', label: 'Rect Table (6)', element_type: 'table', table_shape: 'table-6', total_seats: 6, seat_type: 'general' },
  { key: 'high-top-2', label: 'High-Top Table (2)', element_type: 'table', table_shape: 'high-top-2', total_seats: 2, seat_type: 'general', width: 110, height: 90 },
  { key: 'rect-8', label: 'Rect Table (8)', element_type: 'table', table_shape: 'table-8', total_seats: 8, seat_type: 'general' },
  { key: 'round-8', label: 'Round Table (8)', element_type: 'table', table_shape: 'round-8', total_seats: 8, seat_type: 'general' },
  { key: 'chair', label: 'Single Chair', element_type: 'chair', table_shape: 'chair', total_seats: 1, seat_type: 'general' },
  { key: 'dance-floor', label: 'Dance Floor', element_type: 'area', width: 320, height: 220, color: '#f97316' },
  { key: 'concessions', label: 'Concessions', element_type: 'marker', width: 220, height: 110, color: '#fbbf24' },
  { key: 'door', label: 'Door', element_type: 'marker', width: 80, height: 24, color: '#60a5fa' },
  { key: 'pole', label: 'Pole / Column', element_type: 'marker', width: 30, height: 30, color: '#9ca3af' }
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
  const [editingMeta, setEditingMeta] = useState({ name: '', description: '' });
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
  const canvasInnerRef = useRef(null);
  const [draggingRow, setDraggingRow] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(5); // percentage
  const [ghostPosition, setGhostPosition] = useState(null);
  const [stagePosition, setStagePosition] = useState({ x: 50, y: 10 });
  const [draggingStage, setDraggingStage] = useState(false);
  const [stageGhostPosition, setStageGhostPosition] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 200, height: 80 });
  const [, setResizingStage] = useState(false);
  const [canvasSettings, setCanvasSettings] = useState({
    preset: canvasPresets[0].key,
    width: canvasPresets[0].width,
    height: canvasPresets[0].height
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ startX: 0, startY: 0, startPan: { x: 0, y: 0 } });
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [, setResizingMarker] = useState(null);
  const [debugOverlay, setDebugOverlay] = useState(null);

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
  useEffect(() => {
    if (!showEditor) {
      setPanMode(false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setSelectedRowId(null);
      if (isDevBuild) {
        setDebugOverlay(null);
      }
    }
  }, [showEditor]);

  const openAdd = () => {
    setEditing(null);
    setFormData(initialForm);
    setShowForm(true);
    setError('');
  };

  const openEdit = (layout) => {
    setEditingLayout(layout);
    const rows = Array.isArray(layout.layout_data)
      ? layout.layout_data.map((r, idx) => ({
          ...r,
          id: r.id || `temp-${idx}`,
          element_type: r.element_type || (r.table_shape || r.total_seats ? 'table' : 'marker'),
          width: r.width || r.marker_width || r.size || (r.element_type === 'chair' ? 60 : 160),
          height: r.height || r.marker_height || r.size || 120,
          label: r.label || r.marker_label || r.section_name || '',
          seat_labels: normalizeSeatLabels(r.seat_labels || r.seatLabels || null),
          table_shape: normalizeTableShapeValue(r.table_shape || null)
        }))
      : [];
    setLayoutRows(rows);
    setEditingMeta({
      name: layout.name || '',
      description: layout.description || '',
    });
    const incomingStagePosition = layout.stage_position ? layout.stage_position : { x: 50, y: 10 };
    const incomingStageSize = layout.stage_size ? layout.stage_size : { width: 200, height: 80 };
    setStagePosition(incomingStagePosition);
    setStageSize(incomingStageSize);
    setCanvasSettings(layout.canvas_settings ? {
      preset: layout.canvas_settings.preset || canvasPresets[0].key,
      width: layout.canvas_settings.width || canvasPresets[0].width,
      height: layout.canvas_settings.height || canvasPresets[0].height
    } : {
      preset: canvasPresets[0].key,
      width: canvasPresets[0].width,
      height: canvasPresets[0].height
    });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedRowId(null);
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
        layout_data: formData.layout_data,
        stage_position: editing?.stage_position || null,
        stage_size: editing?.stage_size || null,
        canvas_settings: editing?.canvas_settings || null
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
      id: createRowId(),
      element_type: 'table',
      section_name: rowForm.section_name || 'Main Floor',
      row_label: rowForm.row_label || `Row ${layoutRows.length + 1}`,
      seat_type: rowForm.seat_type,
      table_shape: rowForm.table_shape,
      total_seats: shape ? shape.seats : rowForm.total_seats,
      pos_x: rowForm.pos_x,
      pos_y: rowForm.pos_y,
      rotation: rowForm.rotation,
      seat_labels: {}
    };
    setLayoutRows([...layoutRows, newRow]);
    setSelectedRowId(newRow.id);
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

  const handleAddObject = (template) => {
    const newRow = {
      id: createRowId(),
      element_type: template.element_type || 'marker',
      section_name: template.element_type === 'table' ? template.label : template.label,
      row_label: template.element_type === 'table' ? `Row ${layoutRows.length + 1}` : '',
      seat_type: template.seat_type || 'general',
      table_shape: normalizeTableShapeValue(template.table_shape || null),
      total_seats: typeof template.total_seats === 'number' ? template.total_seats : 0,
      pos_x: 50,
      pos_y: 50,
      rotation: 0,
      label: template.label,
      color: template.color || '#4b5563',
      width: template.width || 140,
      height: template.height || 120,
      seat_labels: template.element_type === 'table' ? {} : undefined
    };
    setLayoutRows([...layoutRows, newRow]);
    setSelectedRowId(newRow.id);
    setShowAddRow(false);
  };

  const handleDeleteRow = (rowId) => {
    setLayoutRows(layoutRows.filter(r => r.id !== rowId));
    if (selectedRowId === rowId) {
      setSelectedRowId(null);
    }
  };

  const updateRow = (rowId, updates) => {
    setLayoutRows(prev => prev.map(row => (
      row.id === rowId ? { ...row, ...updates } : row
    )));
  };

  const updateSeatLabel = (rowId, seatNumber, value) => {
    setLayoutRows((prev) => prev.map((row) => {
      if (row.id !== rowId) return row;
      const labels = { ...(row.seat_labels || {}) };
      const key = String(seatNumber);
      if (!value || !value.trim()) {
        delete labels[key];
      } else {
        labels[key] = value;
      }
      return { ...row, seat_labels: labels };
    }));
  };

  const handleRowDragStart = (e, row) => {
    setDraggingRow(row);
    setSelectedRowId(row.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const snapToGridValue = (value) => {
    if (!snapToGrid) return value;
    return Math.round(value / gridSize) * gridSize;
  };

  const clampPercent = (value) => Math.max(0, Math.min(100, value));

  const createRowId = () => `row-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const getCanvasRect = () => {
    if (!canvasInnerRef.current) return null;
    return canvasInnerRef.current.getBoundingClientRect();
  };

  const calculatePositionFromEvent = (e) => {
    const rect = getCanvasRect();
    if (!rect) return { x: 0, y: 0 };
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    if (snapToGrid) {
      x = snapToGridValue(x);
      y = snapToGridValue(y);
    }
    return { x: clampPercent(x), y: clampPercent(y) };
  };

  const updateDebugOverlay = (coords, clientX, clientY) => {
    if (!isDevBuild) return;
    setDebugOverlay({
      pointer: coords,
      client: { x: Math.round(clientX), y: Math.round(clientY) },
      zoom,
      pan
    });
  };

  const handleCanvasPresetChange = (presetKey) => {
    const preset = canvasPresets.find(p => p.key === presetKey);
    if (!preset) return;
    setCanvasSettings({
      preset: preset.key,
      width: preset.width,
      height: preset.height
    });
  };

  const handleCanvasDragOver = (e) => {
    e.preventDefault();
    if (!canvasInnerRef.current) return;
    const coords = calculatePositionFromEvent(e);
    updateDebugOverlay(coords, e.clientX, e.clientY);

    if (draggingStage) {
      setStageGhostPosition(coords);
      return;
    }
    
    if (draggingRow) {
      setGhostPosition(coords);
    }
  };

  const handleCanvasDrop = (e) => {
    e.preventDefault();
    
    if (draggingStage) {
      handleStageDrop(e);
      return;
    }
    
    if (!draggingRow || !canvasInnerRef.current) return;

    const { x, y } = calculatePositionFromEvent(e);
    setLayoutRows(layoutRows.map(r => 
      r.id === draggingRow.id 
        ? { ...r, pos_x: clampPercent(x), pos_y: clampPercent(y) }
        : r
    ));
    setDraggingRow(null);
    setGhostPosition(null);
  };

  const handleWheel = (e) => {
    if (!showEditor) return;
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom(prev => {
      const next = Math.max(0.5, Math.min(2, parseFloat((prev + delta).toFixed(2))));
      return next;
    });
  };

  const handlePanMouseDown = (e) => {
    if (!panMode || draggingRow || draggingStage) return;
    e.preventDefault();
    setIsPanning(true);
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPan: pan
    };
  };

  const handlePanMouseMove = (e) => {
    if (!isPanning) return;
    e.preventDefault();
    const { startX, startY, startPan } = panRef.current;
    setPan({
      x: startPan.x + (e.clientX - startX),
      y: startPan.y + (e.clientY - startY)
    });
  };

  const handlePanMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
  };

  const handleSaveLayout = async () => {
    if (!editingLayout) return;
    if (!editingMeta.name || editingMeta.name.trim() === '') {
      alert('Layout name is required before saving.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: editingMeta.name.trim(),
        description: editingMeta.description || '',
        is_default: editingLayout.is_default ? 1 : 0,
        layout_data: layoutRows,
        stage_position: stagePosition,
        stage_size: stageSize,
        canvas_settings: canvasSettings,
      };
      const res = await fetch(`${API_BASE}/seating-layouts/${editingLayout.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      const data = await res.json();
      if (data && data.success) {
        setShowEditor(false);
        setEditingLayout(null);
        setEditingMeta({ name: '', description: '' });
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
    if (!draggingStage) return;

    const { x, y } = calculatePositionFromEvent(e);
    setStagePosition({ x: clampPercent(x), y: clampPercent(y) });
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

  const handleMarkerResizeStart = (e, rowId) => {
    e.stopPropagation();
    e.preventDefault();
    const targetRow = layoutRows.find(r => r.id === rowId);
    if (!targetRow) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = targetRow.width || 140;
    const startHeight = targetRow.height || 120;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      setLayoutRows(prev => prev.map(r => (
        r.id === rowId
          ? { ...r, width: Math.max(30, startWidth + deltaX), height: Math.max(30, startHeight + deltaY) }
          : r
      )));
    };

    const handleMouseUp = () => {
      setResizingMarker(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    setResizingMarker(rowId);
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
              <SeatingChart
                seatingConfig={Array.isArray(showPreview.layout_data) ? showPreview.layout_data : []}
                interactive={false}
                autoFetch={false}
                showLegend={false}
                showHeader={false}
                stagePosition={showPreview.stage_position || null}
                stageSize={showPreview.stage_size || null}
                canvasSettings={showPreview.canvas_settings || null}
              />
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
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex-1 flex flex-col gap-3">
                <div>
                  <label className="block text-sm font-semibold mb-1">Layout name</label>
                  <input
                    value={editingMeta.name}
                    onChange={(e) => setEditingMeta((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500"
                    placeholder="Main Floor Layout"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Description</label>
                  <textarea
                    value={editingMeta.description}
                    onChange={(e) => setEditingMeta((prev) => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-purple-500 resize-none"
                    rows={2}
                    placeholder="Visible in admin lists to differentiate templates"
                  />
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Drag tables and markers to the correct positions, then save to update this layout everywhere.</p>
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
                  onClick={() => {
                    setShowEditor(false);
                    setEditingLayout(null);
                    setEditingMeta({ name: '', description: '' });
                  }}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Grid Controls */}
            <div className="flex flex-wrap items-center gap-4 px-6 py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
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

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Canvas:</span>
                <select
                  value={canvasSettings.preset}
                  onChange={(e) => handleCanvasPresetChange(e.target.value)}
                  className="px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                >
                  {canvasPresets.map((preset) => (
                    <option key={preset.key} value={preset.key}>{preset.label}</option>
                  ))}
                </select>
                <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                  <span>{Math.round(canvasSettings.width)}px</span>
                  <span>×</span>
                  <span>{Math.round(canvasSettings.height)}px</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Zoom:</span>
                <button
                  onClick={() => setZoom((prev) => Math.max(0.5, parseFloat((prev - 0.1).toFixed(2))))}
                  className="p-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                  title="Zoom out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => setZoom((prev) => Math.min(2, parseFloat((prev + 0.1).toFixed(2))))}
                  className="p-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                  title="Zoom in"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                  className="p-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                  title="Reset view"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>

              <button
                onClick={() => setPanMode(!panMode)}
                className={`px-3 py-1.5 rounded text-sm flex items-center gap-2 ${panMode ? 'bg-purple-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}
              >
                <Move className="h-4 w-4" />
                {panMode ? 'Panning Enabled' : 'Pan View'}
              </button>
            </div>

            {/* Main Editor Area */}
            <div className="flex-1 flex overflow-hidden">
              {/* Canvas */}
              <div 
                ref={containerRef}
                className={`flex-1 bg-gray-100 dark:bg-gray-900 relative overflow-hidden ${panMode ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
                onDrop={handleCanvasDrop}
                onDragOver={handleCanvasDragOver}
                onWheel={handleWheel}
                onMouseDown={handlePanMouseDown}
                onMouseMove={handlePanMouseMove}
                onMouseUp={handlePanMouseUp}
                onMouseLeave={handlePanMouseUp}
                style={{
                  backgroundImage: showGrid ? `
                    linear-gradient(to right, rgba(156, 163, 175, 0.2) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(156, 163, 175, 0.2) 1px, transparent 1px)
                  ` : 'none',
                  backgroundSize: showGrid ? `${gridSize}% ${gridSize}%` : 'auto'
                }}
              >
                {isDevBuild && debugOverlay && (
                  <div className="absolute top-3 left-3 bg-black/70 text-white text-xs px-3 py-2 rounded z-40 pointer-events-none space-y-1">
                    <div>Zoom: {Math.round((debugOverlay.zoom || 0) * 100)}%</div>
                    <div>Pan: {Math.round(debugOverlay.pan?.x || 0)}px, {Math.round(debugOverlay.pan?.y || 0)}px</div>
                    {debugOverlay.pointer && (
                      <div>
                        Pointer: {debugOverlay.pointer.x.toFixed(1)}%, {debugOverlay.pointer.y.toFixed(1)}%
                      </div>
                    )}
                  </div>
                )}
                <div
                  ref={canvasInnerRef}
                  className="relative"
                  style={{
                    width: `${canvasSettings.width}px`,
                    height: `${canvasSettings.height}px`,
                    padding: '60px',
                    transformOrigin: '0 0',
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
                  }}
                >
                  <div
                    className="absolute inset-0 rounded-[40px] border border-purple-500/30 pointer-events-none"
                    style={{ boxShadow: 'inset 0 0 50px rgba(0,0,0,0.6)' }}
                    aria-hidden="true"
                  />
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
                      <div className="mb-1 text-xs font-medium text-purple-600 dark:text-purple-400 text-center flex flex-col gap-0.5">
                        {(() => {
                          const ghostLabels = resolveRowHeaderLabels(draggingRow);
                          return (
                            <>
                              {ghostLabels.sectionLabel && <span>{ghostLabels.sectionLabel}</span>}
                              {ghostLabels.rowLabel && <span className="font-semibold text-purple-700 dark:text-purple-100">{ghostLabels.rowLabel}</span>}
                            </>
                          );
                        })()}
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

                  {/* Tables & Objects */}
                  {layoutRows.map((row) => {
                    const type = row.element_type || 'table';
                    const isSelected = selectedRowId === row.id;
                    const baseStyle = {
                      left: `${row.pos_x}%`,
                      top: `${row.pos_y}%`,
                    };

                    if (type !== 'table' && type !== 'chair') {
                      const markerWidth = row.width || 160;
                      const markerHeight = row.height || 120;
                      const rotation = row.rotation || 0;
                      return (
                        <div
                          key={row.id}
                          draggable
                          onDragStart={(e) => handleRowDragStart(e, row)}
                          onClick={() => setSelectedRowId(row.id)}
                          className={`absolute cursor-move ${isSelected ? 'ring-2 ring-purple-400' : 'hover:ring-2 hover:ring-purple-500'} rounded-lg`}
                          style={{ ...baseStyle, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
                        >
                          <div
                            className="rounded-lg shadow-lg flex items-center justify-center text-xs font-semibold text-gray-900 dark:text-white"
                            style={{
                              width: markerWidth,
                              height: markerHeight,
                              backgroundColor: row.color || '#4b5563',
                              position: 'relative',
                              opacity: 0.9
                            }}
                          >
                            <span>{row.label || row.section_name || 'Marker'}</span>
                            <div
                              onMouseDown={(e) => handleMarkerResizeStart(e, row.id)}
                              className="absolute -bottom-2 -right-2 w-4 h-4 bg-white dark:bg-gray-900 border border-gray-400 rounded-full cursor-se-resize"
                              title="Resize"
                            />
                          </div>
                          <div className="mt-1 flex justify-center gap-1">
                            <button
                              onClick={() => handleRotateRow(row.id, -15)}
                              className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                              title="Rotate -15°"
                            >
                              ↶
                            </button>
                            <button
                              onClick={() => handleRotateRow(row.id, 15)}
                              className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                              title="Rotate +15°"
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
                      );
                    }

                    const isChairRow = type === 'chair';
                    const containerWidth = row.width || (isChairRow ? 60 : 120);
                    const containerHeight = row.height || (isChairRow ? 60 : 120);
                    return (
                      <div
                        key={row.id}
                        draggable
                        onDragStart={(e) => handleRowDragStart(e, row)}
                        onClick={() => setSelectedRowId(row.id)}
                        className={`absolute cursor-move rounded ${isSelected ? 'ring-2 ring-purple-400' : 'hover:ring-2 hover:ring-purple-500'}`}
                        style={{
                          ...baseStyle,
                          transform: 'translate(-50%, -50%)',
                          padding: isChairRow ? '16px 10px' : '40px 20px',
                          minWidth: `${containerWidth}px`,
                          minHeight: `${containerHeight}px`,
                        }}
                      >
                        {(() => {
                          const headerLabels = resolveRowHeaderLabels(row);
                          if (!headerLabels.sectionLabel && !headerLabels.rowLabel) {
                            return null;
                          }
                          return (
                            <div className="absolute -top-6 left-1/2 flex flex-col items-center gap-0.5 -translate-x-1/2 text-center text-white pointer-events-none z-20">
                              {headerLabels.sectionLabel && (
                                <span className="text-[10px] tracking-[0.2em] text-gray-200 bg-black/30 px-2 py-0.5 rounded-full">
                                  {headerLabels.sectionLabel.toUpperCase()}
                                </span>
                              )}
                              {headerLabels.rowLabel && (
                                <span className="text-xs font-semibold bg-black/70 px-2 py-0.5 rounded-full shadow">
                                  {headerLabels.rowLabel}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <div className="flex items-center justify-center" style={{ minHeight: '60px' }}>
                          <div style={{ transform: `rotate(${row.rotation || 0}deg)` }}>
                            <TableComponent
                              row={row}
                              tableShape={row.table_shape || (type === 'chair' ? 'chair' : 'table-6')}
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
                    );
                  })}
                </div>
              </div>

              {/* Sidebar */}
              <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 p-6 overflow-y-auto">
                <h4 className="font-bold text-lg mb-4">Quick Add Objects</h4>
                <div className="grid grid-cols-1 gap-2 mb-6">
                  {quickObjects.map((obj) => (
                    <button
                      key={obj.key}
                      onClick={() => handleAddObject(obj)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-between text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <span className="flex items-center gap-2">
                        <Shapes className="h-4 w-4 text-purple-400" />
                        {obj.label}
                      </span>
                      <span className="text-xs text-gray-400">{obj.element_type === 'table' ? `${obj.total_seats} seats` : 'marker'}</span>
                    </button>
                  ))}
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h4 className="font-bold text-lg mb-3">Add Table/Seating</h4>
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
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h5 className="font-semibold text-sm mb-2">Current Items ({layoutRows.length})</h5>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {layoutRows.map((row) => (
                      <button
                        key={row.id}
                        onClick={() => setSelectedRowId(row.id)}
                        className={`w-full text-left text-xs p-2 rounded border ${selectedRowId === row.id ? 'border-purple-500 bg-purple-500/10' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'}`}
                      >
                        <div className="font-medium flex justify-between">
                          <span>{row.section_name || row.label || 'Object'}</span>
                          <span className="text-[10px] uppercase text-gray-400">{(row.element_type || 'table')}</span>
                        </div>
                        {row.element_type === 'table' ? (
                          <div className="text-gray-500">{row.table_shape} ({row.total_seats} seats)</div>
                        ) : (
                          <div className="text-gray-500">{row.label || row.row_label || 'Marker'}</div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {selectedRowId && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                    <h5 className="font-semibold text-sm mb-2">Selected Object Details</h5>
                    {(() => {
                      const row = layoutRows.find(r => r.id === selectedRowId);
                      if (!row) return null;
                      const type = row.element_type || 'table';
                      return (
                        <div className="space-y-3 text-sm">
                          {type === 'table' && (
                            <>
                              <div>
                                <label className="block text-xs mb-1">Section</label>
                                <input
                                  value={row.section_name || ''}
                                  onChange={(e) => updateRow(row.id, { section_name: e.target.value })}
                                  className="w-full px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded"
                                />
                              </div>
                              <div>
                                <label className="block text-xs mb-1">Row Label</label>
                                <input
                                  value={row.row_label || ''}
                                  onChange={(e) => updateRow(row.id, { row_label: e.target.value })}
                                  className="w-full px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded"
                                />
                              </div>
                              {row.total_seats ? (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <label className="block text-xs">Seat Labels</label>
                                    <button
                                      type="button"
                                      onClick={() => updateRow(row.id, { seat_labels: {} })}
                                      className="text-[11px] text-purple-400 hover:text-purple-200"
                                    >
                                      Reset
                                    </button>
                                  </div>
                                  <div className="max-h-40 overflow-y-auto border border-gray-700 rounded-lg p-2 space-y-2 bg-gray-900">
                                    {Array.from({ length: row.total_seats }, (_, idx) => {
                                      const seatNumber = idx + 1;
                                      const labels = row.seat_labels || {};
                                      const current = labels[seatNumber] || labels[String(seatNumber)] || '';
                                      return (
                                        <div key={`${row.id}-seat-${seatNumber}`} className="flex items-center gap-2">
                                          <span className="w-16 text-xs text-gray-400">Seat {seatNumber}</span>
                                          <input
                                            value={current}
                                            placeholder={buildSeatLabel(row, seatNumber)}
                                            onChange={(e) => updateSeatLabel(row.id, seatNumber, e.target.value)}
                                            className="flex-1 px-2 py-1 bg-gray-800 text-white border border-gray-700 rounded text-xs"
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </>
                          )}
                          {type !== 'table' && (
                            <>
                              <div>
                                <label className="block text-xs mb-1">Label</label>
                                <input
                                  value={row.label || ''}
                                  onChange={(e) => updateRow(row.id, { label: e.target.value })}
                                  className="w-full px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-xs mb-1">Width</label>
                                  <input
                                    type="number"
                                    value={Math.round(row.width || 120)}
                                    onChange={(e) => updateRow(row.id, { width: Math.max(20, Number(e.target.value) || 20) })}
                                    className="w-full px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs mb-1">Height</label>
                                  <input
                                    type="number"
                                    value={Math.round(row.height || 120)}
                                    onChange={(e) => updateRow(row.id, { height: Math.max(20, Number(e.target.value) || 20) })}
                                    className="w-full px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs mb-1">Color</label>
                                <input
                                  type="color"
                                  value={row.color || '#4b5563'}
                                  onChange={(e) => updateRow(row.id, { color: e.target.value })}
                                  className="w-full h-10 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
