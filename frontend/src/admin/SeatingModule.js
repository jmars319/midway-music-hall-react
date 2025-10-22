import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Edit } from 'lucide-react';
import Table6 from '../components/Table6';
import { API_BASE } from '../App';

const seatTypes = ['general', 'premium', 'vip', 'accessible', 'standing', 'table-6'];

export default function SeatingModule(){
  const [seating, setSeating] = useState([]);
  const [showLayout, setShowLayout] = useState(false);
  const [layoutRows, setLayoutRows] = useState([]);
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ section_name: '', row_letter: '', total_seats: 1, seat_type: 'general' });
  const [editing, setEditing] = useState(null);

  const fetchSeating = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/seating`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.seating)) {
        setSeating(data.seating);
      } else {
        setSeating([]);
      }
    } catch (err) {
      console.error('Failed to fetch seating', err);
      setSeating([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSeating(); }, []);

  // when seating changes, initialize layout rows for editor
  useEffect(() => {
    setLayoutRows(seating.map(r => ({ ...r })));
  }, [seating]);

  const openLayout = () => {
    setLayoutRows(seating.map(r => ({ ...r })));
    // load stage settings then show; also fetch server-side history
    fetchStageSettings().then(async ()=>{
      try{
        const res = await fetch(`${API_BASE}/layout-history?limit=200`);
        const json = await res.json();
        if (json && json.success && Array.isArray(json.history) && json.history.length>0) {
          // server returns most-recent-first; convert to chronological array
          historyRef.current = json.history.map(h => h.snapshot).reverse();
          historyIndexRef.current = historyRef.current.length - 1;
          setHistoryTick(t => t + 1);
        } else {
          pushHistory({ layoutRows: seating.map(r=>({...r})), stage: { ...stage, stage_lock: stageLock ? '1' : '0' } });
        }
      }catch(e){ console.error('Failed to load history', e); pushHistory({ layoutRows: seating.map(r=>({...r})), stage: { ...stage, stage_lock: stageLock ? '1' : '0' } }); }
      setShowLayout(true);
    });
  };

  // stage settings: pos_x, pos_y, size (percent of width)
  const [stage, setStage] = useState({ pos_x: 5, pos_y: 5, size: 20 });
  const [stageLock, setStageLock] = useState(false);
  const [stageHover, setStageHover] = useState(false);
  const [gridEnabled, setGridEnabled] = useState(false);
  const [gridSize, setGridSize] = useState(5); // percent grid size
  // undo/redo history (store snapshots of { layoutRows, stage })
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const [, setHistoryTick] = useState(0); // force update for buttons
  const pushHistory = (snapshot) => {
    try{
      if (!snapshot) return;
      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      }
      historyRef.current.push(JSON.parse(JSON.stringify(snapshot)));
      if (historyRef.current.length > 200) historyRef.current.shift();
      historyIndexRef.current = historyRef.current.length - 1;
      setHistoryTick(t => t + 1);
      // persist server-side
      (async ()=>{
        try{ await fetch(`${API_BASE}/layout-history`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ snapshot }) }); }catch(e){ console.error('Failed to persist history', e); }
      })();
    }catch(e){ console.error('pushHistory error', e); }
  };
  const canUndo = () => historyIndexRef.current > 0;
  const canRedo = () => historyIndexRef.current < historyRef.current.length - 1;
  const applySnapshot = async (snap, persist = true) => {
    if (!snap) return;
    try{
      setLayoutRows((snap.layoutRows || []).map(r => ({ ...r })));
      if (snap.stage) setStage({ pos_x: parseFloat(snap.stage.pos_x) || 5, pos_y: parseFloat(snap.stage.pos_y) || 5, size: parseFloat(snap.stage.size) || 20 });
      if (snap.stage && typeof snap.stage.stage_lock !== 'undefined') setStageLock(snap.stage.stage_lock === '1' || snap.stage.stage_lock === 'true');
      if (persist) {
        try { await saveStageSettings({ stage_pos_x: String(snap.stage.pos_x), stage_pos_y: String(snap.stage.pos_y), stage_size: String(snap.stage.size), stage_lock: snap.stage.stage_lock ? String(snap.stage.stage_lock) : (stageLock ? '1' : '0') }, { skipHistory: true }); }catch(e){}
        await Promise.all((snap.layoutRows || []).map(async (r) => {
          try{
            await fetch(`${API_BASE}/seating/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pos_x: parseFloat(r.pos_x), pos_y: parseFloat(r.pos_y), rotation: parseInt(r.rotation || 0, 10) }) });
          }catch(e){ console.error('persist row during snapshot apply', e); }
        }));
      }
    }catch(e){ console.error('applySnapshot error', e); }
  };
  const undo = async () => { if (!canUndo()) return; historyIndexRef.current = Math.max(0, historyIndexRef.current - 1); const snap = historyRef.current[historyIndexRef.current]; await applySnapshot(snap, true); setHistoryTick(t => t + 1); };
  const redo = async () => { if (!canRedo()) return; historyIndexRef.current = Math.min(historyRef.current.length - 1, historyIndexRef.current + 1); const snap = historyRef.current[historyIndexRef.current]; await applySnapshot(snap, true); setHistoryTick(t => t + 1); };
  // expose to window for nested draggable items to read
  useEffect(()=>{ try{ window.__STAGE_LOCK__ = !!stageLock; }catch(e){} 
    // persist lock state so it survives reloads
    try{ saveStageSettings({ stage_lock: stageLock ? '1' : '0' }); }catch(e){}
  }, [stageLock]);

  const fetchStageSettings = async () => {
    try{
      const res = await fetch(`${API_BASE}/stage-settings`);
      const json = await res.json();
      if(json && json.success && json.settings){
        const s = json.settings;
        setStage({ pos_x: parseFloat(s.stage_pos_x) || 5, pos_y: parseFloat(s.stage_pos_y) || 5, size: parseFloat(s.stage_size) || 20 });
        // restore lock if persisted
        const lockVal = s.stage_lock;
        setStageLock(lockVal === '1' || lockVal === 'true');
      }
    }catch(err){ console.error('Failed to fetch stage settings', err); }
  };

  const saveStageSettings = async (newStage, opts = {}) => {
    const skipHistory = opts.skipHistory;
    let payload = {};
    if (!newStage) return;
    if (newStage.stage_pos_x || newStage.stage_pos_y || newStage.stage_size || newStage.stage_lock) payload = newStage;
    else if (newStage.pos_x !== undefined || newStage.pos_y !== undefined || newStage.size !== undefined) payload = { stage_pos_x: String(newStage.pos_x), stage_pos_y: String(newStage.pos_y), stage_size: String(newStage.size) };
    try{
      if (Object.keys(payload).length === 0) return;
      await fetch(`${API_BASE}/stage-settings`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!skipHistory) {
        try{ pushHistory({ layoutRows: layoutRows.map(r => ({ ...r })), stage: { pos_x: parseFloat(payload.stage_pos_x || stage.pos_x), pos_y: parseFloat(payload.stage_pos_y || stage.pos_y), size: parseFloat(payload.stage_size || stage.size), stage_lock: (payload.stage_lock !== undefined ? String(payload.stage_lock) : (stageLock ? '1' : '0')) } }); }catch(e){}
      }
    }catch(err){ console.error('Failed to save stage settings', err); }
  };

  // debounce helper for stage saves
  const stageSaveTimer = useRef(null);
  const debouncedSaveStage = (s) => {
    if (stageSaveTimer.current) clearTimeout(stageSaveTimer.current);
    stageSaveTimer.current = setTimeout(()=>{ saveStageSettings(s); stageSaveTimer.current = null; }, 200);
  };

  const grouped = useMemo(() => seating.reduce((acc, row) => {
    const sec = row.section_name || row.section || 'Uncategorized';
    if (!acc[sec]) acc[sec] = [];
    acc[sec].push(row);
    return acc;
  }, {}), [seating]);

  const openAdd = (section = '') => {
    setEditing(null);
    setFormData({ section_name: section, row_letter: '', total_seats: 1, seat_type: 'general', is_active: true, pos_x: '', pos_y: '', rotation: 0 });
    setShowForm(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setFormData({ section_name: row.section_name || row.section, row_letter: row.row_label || row.row_letter, total_seats: row.total_seats, seat_type: row.seat_type, is_active: !!row.is_active, pos_x: row.pos_x, pos_y: row.pos_y, rotation: row.rotation || 0 });
    setShowForm(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: name === 'total_seats' || name === 'rotation' ? parseInt(value || 0, 10) : (name === 'is_active' ? !!checked : value) }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        section: formData.section_name,
        row_label: formData.row_letter
      };
      let url = `${API_BASE}/seating`;
      let method = 'POST';
      if (editing && editing.id) {
        url = `${API_BASE}/seating/${editing.id}`;
        method = 'PATCH';
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data && data.success) {
        setShowForm(false);
        fetchSeating();
      } else {
        alert('Failed to save seating row');
      }
    } catch (err) {
      console.error('Save seating error', err);
      alert('Failed to save seating row');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this seating row?')) return;
    try {
      const res = await fetch(`${API_BASE}/seating/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data && data.success) fetchSeating();
      else alert('Failed to delete');
    } catch (err) {
      console.error('Delete seating error', err);
      alert('Delete failed');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Seating Configuration</h1>
        <div>
          <button onClick={() => openAdd('')} className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded"><Plus className="h-4 w-4" /> Add Row</button>
          <button onClick={openLayout} className="ml-3 inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded">Open Layout Editor</button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.keys(grouped).length === 0 && (
            <div className="p-6 bg-gray-800 rounded">No seating rows configured yet.</div>
          )}

          {Object.entries(grouped).map(([section, rows]) => (
            <div key={section} className="bg-gray-800 rounded-xl p-4 border border-purple-500/30">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">{section}</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => openAdd(section)} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded">Add Row</button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-gray-300">
                      <th className="px-3 py-2">Row</th>
                      <th className="px-3 py-2">Total Seats</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="border-t border-gray-700 hover:bg-gray-700/30">
                        <td className="px-3 py-2">{r.row_label || r.row_letter}</td>
                        <td className="px-3 py-2">{r.total_seats}</td>
                        <td className="px-3 py-2">{r.seat_type}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-2">
                            <button onClick={() => openEdit(r)} className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded"><Edit className="h-4 w-4" /></button>
                            <button onClick={() => handleDelete(r.id)} className="p-2 bg-red-600 hover:bg-red-700 text-white rounded"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-50 overflow-auto">
          <div className="bg-gray-800 rounded-xl max-w-2xl w-full p-6 border border-purple-500/30">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold">{editing ? 'Edit Row' : 'Add Seating Row'}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">Close</button>
            </div>

            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Section Name*</label>
                <input name="section_name" value={formData.section_name} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Row Letter/Number*</label>
                <input name="row_letter" value={formData.row_letter} onChange={handleChange} required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Total Seats*</label>
                <input name="total_seats" value={formData.total_seats} onChange={handleChange} type="number" min="1" required className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Seat Type</label>
                <select name="seat_type" value={formData.seat_type} onChange={handleChange} className="w-full px-4 py-2 bg-gray-700 text-white rounded">
                  {seatTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Active</label>
                <div className="flex items-center gap-2">
                  <input name="is_active" checked={!!formData.is_active} onChange={handleChange} type="checkbox" />
                  <span className="text-sm text-gray-300">Show on public seating chart</span>
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Position X (%)</label>
                <input name="pos_x" value={formData.pos_x || ''} onChange={handleChange} type="number" step="0.1" min="0" max="100" className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Position Y (%)</label>
                <input name="pos_y" value={formData.pos_y || ''} onChange={handleChange} type="number" step="0.1" min="0" max="100" className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-300 mb-1">Rotation (deg)</label>
                <input name="rotation" value={formData.rotation || 0} onChange={handleChange} type="number" step="1" className="w-full px-4 py-2 bg-gray-700 text-white rounded" />
              </div>

              <div className="md:col-span-2 flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">Save Row</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Layout editor modal */}
      {showLayout && (
        <div className="fixed inset-0 bg-black/70 z-50 p-4 flex items-center justify-center">
          <div className="bg-gray-900 rounded-lg w-full max-w-6xl h-[80vh] p-4 border border-purple-500/30 relative">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Layout Editor</h3>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                  <input type="checkbox" checked={stageLock} onChange={(e)=>setStageLock(!!e.target.checked)} />
                  Lock layout
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-200">
                  <input type="checkbox" checked={gridEnabled} onChange={(e)=>setGridEnabled(!!e.target.checked)} />
                  Snap to grid
                </label>
                <div className="inline-flex items-center gap-2 text-sm text-gray-200">
                  <input type="number" min="1" max="20" value={gridSize} onChange={(e)=>setGridSize(Math.max(1, Math.min(20, parseInt(e.target.value||5,10))))} className="w-16 px-2 py-1 bg-gray-700 text-white rounded" />
                  <div className="text-xs text-gray-300">% grid</div>
                </div>
                <button onClick={undo} disabled={!canUndo()} className={`px-3 py-1 ${canUndo()? 'bg-yellow-600 hover:bg-yellow-700 text-black':'bg-gray-600 text-gray-400'} rounded`}>Undo</button>
                <button onClick={redo} disabled={!canRedo()} className={`px-3 py-1 ${canRedo()? 'bg-yellow-600 hover:bg-yellow-700 text-black':'bg-gray-600 text-gray-400'} rounded`}>Redo</button>
                <button onClick={() => { setShowLayout(false); fetchSeating(); }} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">Close</button>
                <button onClick={() => { setShowLayout(false); fetchSeating(); }} className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded">Done</button>
              </div>
            </div>

            <div ref={containerRef} className="relative bg-gray-800 w-full h-full rounded overflow-hidden border border-gray-700" style={{ touchAction: 'none' }}>
              {/* grid overlay when enabled */}
              {gridEnabled && (
                <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'none' }}>
                  {/* compute lines based on gridSize percentage */}
                  {Array.from({ length: Math.ceil(100 / gridSize) }).map((_, i) => {
                    const pct = (i+1) * gridSize;
                    return (
                      <g key={`g-${i}`}>
                        <line x1={`${pct}%`} y1="0%" x2={`${pct}%`} y2="100%" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                        <line x1="0%" y1={`${pct}%`} x2="100%" y2={`${pct}%`} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      </g>
                    );
                  })}
                </svg>
              )}
              {/* render square stage */}
              <div
                className="absolute bg-yellow-400/90 border border-yellow-600 text-black flex items-center justify-center font-semibold"
                style={{
                  left: `${stage.pos_x}%`,
                  top: `${stage.pos_y}%`,
                  width: `${stage.size}%`,
                  height: `${stage.size}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 5,
                }}
                onPointerDown={(e)=>{
                  if (stageLock) return;
                  // begin dragging stage
                  const startX = e.clientX;
                  const startY = e.clientY;
                  const rect = containerRef.current.getBoundingClientRect();
                  const orig = { x: stage.pos_x, y: stage.pos_y };
                  function onMove(ev){
                    const dx = ev.clientX - startX;
                    const dy = ev.clientY - startY;
                    const nx = Math.max(0, Math.min(100, ((orig.x/100)*rect.width + dx)/rect.width*100));
                    const ny = Math.max(0, Math.min(100, ((orig.y/100)*rect.height + dy)/rect.height*100));
                    const newS = { ...stage, pos_x: parseFloat(nx.toFixed(2)), pos_y: parseFloat(ny.toFixed(2)) };
                    setStage(newS);
                    debouncedSaveStage(newS);
                  }
                  function onUp(ev){
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    // final save
                    saveStageSettings(stage);
                  }
                  window.addEventListener('pointermove', onMove);
                  window.addEventListener('pointerup', onUp);
                }}
                onPointerEnter={()=>setStageHover(true)}
                onPointerLeave={()=>setStageHover(false)}
              >
                <div style={{position:'relative', width:'100%', height:'100%'}}>
                  Stage
                  {/* resize handle bottom-right */}
                  {!stageLock && (
                    <div
                      onPointerDown={(e)=>{
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const rect = containerRef.current.getBoundingClientRect();
                        const startSize = stage.size;
                        function onMove(ev){
                          const dx = ev.clientX - startX;
                          const pct = (dx / rect.width) * 100;
                          const ns = Math.max(5, Math.min(80, startSize + pct));
                          const newS = { ...stage, size: Math.round(ns*100)/100 };
                          setStage(newS);
                          debouncedSaveStage(newS);
                        }
                        function onUp(ev){
                          window.removeEventListener('pointermove', onMove);
                          window.removeEventListener('pointerup', onUp);
                          saveStageSettings(stage);
                        }
                        window.addEventListener('pointermove', onMove);
                        window.addEventListener('pointerup', onUp);
                      }}
                      title="Drag to resize"
                      style={{ position:'absolute', right:6, bottom:6, width:16, height:16, background:'#111827', borderRadius:2, cursor:'nwse-resize' }}
                    />
                  )}
                  {/* hover hint for resize */}
                  {stageHover && !stageLock && (
                    <div style={{ position: 'absolute', right: 8, bottom: 26, background: 'rgba(0,0,0,0.7)', color:'#fff', padding:'4px 6px', borderRadius:4, fontSize:11, zIndex:20 }}>
                      Drag corner to resize
                    </div>
                  )}
                </div>
              </div>

              {/* render rows as draggable items */}
              {layoutRows.map(row => {
                // default to center if no pos
                const leftPct = (row.pos_x !== null && row.pos_x !== undefined && row.pos_x !== '') ? parseFloat(row.pos_x) : 50;
                const topPct = (row.pos_y !== null && row.pos_y !== undefined && row.pos_y !== '') ? parseFloat(row.pos_y) : 50;
                const rotate = row.rotation || 0;
                const style = {
                  position: 'absolute',
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
                  cursor: 'grab'
                };

                return (
                  <LayoutDraggable key={row.id} row={row} style={style} containerRef={containerRef} gridEnabled={gridEnabled} gridSize={gridSize} onUpdate={(r) => {
                    // update local state
                    setLayoutRows(prev => {
                      const next = prev.map(p => p.id === r.id ? { ...p, pos_x: r.pos_x, pos_y: r.pos_y, rotation: r.rotation } : p);
                      try{ pushHistory({ layoutRows: next.map(x=>({...x})), stage: { ...stage, stage_lock: stageLock ? '1' : '0' } }); }catch(e){}
                      return next;
                    });
                    // persist to server
                    (async () => {
                      try {
                        await fetch(`${API_BASE}/seating/${r.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ pos_x: parseFloat(r.pos_x), pos_y: parseFloat(r.pos_y), rotation: parseInt(r.rotation || 0, 10) })
                        });
                      } catch (err) { console.error('Persist layout error', err); }
                    })();
                  }} />
                );
              })}

              {/* top-left inspector removed; resizing via corner and header lock are sufficient */}
            </div>
          </div>
        
              {/* legend bottom-right */}
              <div style={{ position: 'absolute', right: 12, bottom: 12, width: 220, zIndex: 15 }} className="p-2 bg-white rounded shadow">
                <div className="text-xs text-gray-600">
                  <div className="font-semibold mb-1">Legend</div>
                  <div className="flex items-center gap-2"><div className="w-4 h-4 bg-yellow-400 border border-yellow-600" /> <div>Stage</div></div>
                  <div className="flex items-center gap-2 mt-1"><div className="w-4 h-4 bg-purple-700" /> <div>Seating row/table</div></div>
                </div>
              </div>
        </div>
      )}
    </div>
  );
}

// Draggable item used inside the layout editor. Uses pointer events for drag support and has a rotate button.
function LayoutDraggable({ row, style, containerRef, onUpdate, gridEnabled, gridSize }){
  const elRef = useRef();
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(row.rotation || 0);
  const [hover, setHover] = useState(false);
  // read lock from outer scope by window-level variable fallback
  const [stageLockLocal, setStageLockLocal] = useState(false);
  useEffect(()=>{
    // try to read global stageLock injected on window by parent (not ideal but simple)
    try{ setStageLockLocal(window.__STAGE_LOCK__ ? true : false); }catch(e){}
  }, []);

  useEffect(() => {
    return () => { dragging.current = false; };
  }, []);

  const onPointerDown = (e) => {
    e.preventDefault();
    // if locked, prevent dragging
    if (window.__STAGE_LOCK__) return;
    const rect = elRef.current.getBoundingClientRect();
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragging.current = true;
    // attach global handlers so moves outside the element still track
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    elRef.current.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const container = containerRef.current;
    if (!container) return;
    const crect = container.getBoundingClientRect();
    // compute center-based percent
    const x = e.clientX - crect.left - (offset.current.x - elRef.current.offsetWidth/2);
    const y = e.clientY - crect.top - (offset.current.y - elRef.current.offsetHeight/2);
    let pctX = Math.max(0, Math.min(100, (x / crect.width) * 100));
    let pctY = Math.max(0, Math.min(100, (y / crect.height) * 100));
    // snap live if grid enabled
    if (gridEnabled && gridSize > 0) {
      const gx = gridSize;
      pctX = Math.round(pctX / gx) * gx;
      pctY = Math.round(pctY / gx) * gx;
    }
    // apply live position
    elRef.current.style.left = `${pctX}%`;
    elRef.current.style.top = `${pctY}%`;
  };

  const onPointerUp = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    elRef.current.releasePointerCapture?.(e.pointerId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    // persist final position
    const container = containerRef.current;
    if (!container) return;
    const crect = container.getBoundingClientRect();
    const rect = elRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width/2 - crect.left;
    const centerY = rect.top + rect.height/2 - crect.top;
    let pctX = Math.max(0, Math.min(100, (centerX / crect.width) * 100));
    let pctY = Math.max(0, Math.min(100, (centerY / crect.height) * 100));
    if (gridEnabled && gridSize > 0) {
      const gx = gridSize;
      pctX = Math.round(pctX / gx) * gx;
      pctY = Math.round(pctY / gx) * gx;
    }
    onUpdate({ ...row, pos_x: parseFloat(pctX.toFixed(2)), pos_y: parseFloat(pctY.toFixed(2)), rotation });
  };

  const rotate = (delta = 45) => {
    const newRotation = ((rotation || 0) + delta + 360) % 360;
    setRotation(newRotation);
    // update visual rotation
    if (elRef.current) elRef.current.style.transform = `translate(-50%, -50%) rotate(${newRotation}deg)`;
    onUpdate({ ...row, pos_x: row.pos_x, pos_y: row.pos_y, rotation: newRotation });
  };

  return (
    <div
      ref={elRef}
      onPointerDown={onPointerDown}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={style}
      className={`flex flex-col items-center gap-1 px-2 py-1 ${hover ? 'ring-2 ring-purple-400' : ''} bg-purple-700/80 text-white rounded shadow-lg select-none transition-all`}
    >
      <div className="text-xs font-semibold">{row.section_name || row.section} {row.row_label || row.row_letter}</div>
      <div className="flex items-center gap-2">
        {row.seat_type === 'table-6' ? (
          <div className="flex items-center gap-2">
            <Table6
              row={row}
              size={96}
              selectedSeats={(function(){ try{ return Array.isArray(row.selected_seats) ? row.selected_seats : (row.selected_seats ? JSON.parse(row.selected_seats) : []); }catch(e){ return []; } })()}
              interactive={true}
              onToggleSeat={async (seatId) => {
                try{
                  // compute new selected array
                  const current = Array.isArray(row.selected_seats) ? row.selected_seats : (row.selected_seats ? JSON.parse(row.selected_seats) : []);
                  const next = current.includes(seatId) ? current.filter(s=>s!==seatId) : [...current, seatId];
                  // optimistic update locally
                  setLayoutRows(prev => prev.map(p => p.id === row.id ? { ...p, selected_seats: next } : p));
                  // persist to server
                  await fetch(`${API_BASE}/seating/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected_seats: next }) });
                }catch(e){ console.error('Failed to toggle seat', e); }
              }}
            />
            <div className={`${hover ? 'inline-flex' : 'hidden'} flex-col gap-1`}> 
              <button type="button" onClick={() => rotate(-45)} title="Rotate -45°" className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded">⟲</button>
              <button type="button" onClick={() => rotate(45)} title="Rotate +45°" className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded">⟳</button>
            </div>
          </div>
        ) : (
          <>
            <div className="w-8 h-6 bg-gray-800 rounded flex items-center justify-center text-xs">{row.total_seats}</div>
            <button type="button" onClick={() => rotate(-45)} className="px-1 py-0.5 bg-gray-600 rounded">⟲</button>
            <button type="button" onClick={() => rotate(45)} className="px-1 py-0.5 bg-gray-600 rounded">⟳</button>
          </>
        )}
      </div>
    </div>
  );
}
 