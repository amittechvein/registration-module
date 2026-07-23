import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

/**
 * Canva-style PDF layout designer (A4 · 1 canvas unit = 1 print point).
 * 8-handle resize, smart alignment guides, floating context toolbar,
 * double-click inline text editing, dark sidebar, zoom, undo, live preview.
 */
const A4W = 595, A4H = 842, MAXY = 820;
const uid = () => 'e' + Math.random().toString(36).slice(2, 9);
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const defaultsFor = (kind) => ({
  group: { w: 265, h: 180, fontSize: 8, cols: 1, showLabels: true, underline: true, color: '#1e3a8a' },
  field: { w: 160, h: 26, fontSize: 8, showLabel: true },
  text: { w: 180, h: 18, fontSize: 11, text: 'Add your text' },
  line: { w: 200, h: 8, fontSize: 8 },
  box: { w: 120, h: 60, fontSize: 8 },
  photo: { w: 70, h: 85, fontSize: 8 },
  signature: { w: 130, h: 45, fontSize: 8, text: "Parent's Signature" },
}[kind]);

export default function Designer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(null);
  const [elements, setElements] = useState([]);
  const [settings, setSettings] = useState({ showHeader: true, topSpace: 100 });
  const [selId, setSelId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [tab, setTab] = useState('sections');
  const [palSec, setPalSec] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [snapOn, setSnapOn] = useState(true);
  const [guides, setGuides] = useState({ v: [], h: [] });
  const [msg, setMsg] = useState(null);
  const dragRef = useRef(null);
  const canvasRef = useRef(null);
  const histRef = useRef([]);
  const elsRef = useRef(elements);
  elsRef.current = elements;

  const GRID = 5;
  const gsnap = (v) => (snapOn ? Math.round(v / GRID) * GRID : Math.round(v));

  const sections = (template?.sections || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const allFields = sections.flatMap((s) => (s.fields || []).map((f) => ({ ...f, sectionTitle: s.title })));
  const usedFieldIds = new Set(elements.filter((e) => e.kind === 'field').map((e) => e.fieldId));
  const usedSectionIds = new Set(elements.filter((e) => e.kind === 'group').map((e) => e.sectionId));
  const sel = elements.find((e) => e.id === selId);
  const palSection = sections.find((s) => s.id === palSec) || sections[0];

  const pushHist = () => {
    histRef.current.push(JSON.stringify(elsRef.current));
    if (histRef.current.length > 60) histRef.current.shift();
  };
  const undo = () => {
    const prev = histRef.current.pop();
    if (prev) { setElements(JSON.parse(prev)); setSelId(null); }
  };

  useEffect(() => {
    adminApi.get(`/templates/${id}`).then((r) => {
      setTemplate(r.data);
      const secs = (r.data.sections || []).sort((a, b) => a.sortOrder - b.sortOrder);
      if (secs.length) setPalSec(secs[0].id);
      let layout = null;
      try { layout = JSON.parse(r.data.layout || 'null'); } catch {}
      if (layout?.elements?.length) {
        setElements(layout.elements.map((e) => ({ id: uid(), ...e })));
        setSettings({ showHeader: true, topSpace: 100, ...(layout.settings || {}) });
      } else {
        autoLayout(r.data);
      }
    }).catch((e) => setMsg({ type: 'err', text: errMsg(e) }));
  }, [id]); // eslint-disable-line

  const autoLayout = (t) => {
    const els = [];
    const colX = [22, 305], colW = 268;
    const y = [112, 112];
    for (const s of (t.sections || []).slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
      const n = (s.fields || []).length;
      const h = 20 + Math.max(1, n) * 22;
      const col = y[0] <= y[1] ? 0 : 1;
      if (y[col] + h > 815) continue;
      els.push({ id: uid(), kind: 'group', sectionId: s.id, x: colX[col], y: y[col], w: colW, h, fontSize: 8, cols: 1, showLabels: true, underline: true, color: '#1e3a8a', align: 'left' });
      y[col] += h + 10;
    }
    setElements(els);
  };

  /* ------------------- move / resize with smart guides ------------------- */
  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / d.zoom, dy = (e.clientY - d.startY) / d.zoom;
      const others = elsRef.current.filter((o) => o.id !== d.id);
      const el = elsRef.current.find((o) => o.id === d.id);
      if (!el) return;

      if (d.mode === 'move') {
        let nx = d.origX + dx, ny = d.origY + dy;
        // smart guides: snap edges/centers to page + other elements (Canva style)
        const TH = 4;
        const vCand = [0, A4W, A4W / 2, ...others.flatMap((o) => [o.x, o.x + o.w, o.x + o.w / 2])];
        const hCand = [0, MAXY, ...others.flatMap((o) => [o.y, o.y + o.h, o.y + o.h / 2])];
        let gv = null, gh = null, bestV = TH + 1, bestH = TH + 1;
        for (const c of vCand) for (const off of [0, el.w / 2, el.w]) {
          const diff = c - (nx + off);
          if (Math.abs(diff) < bestV) { bestV = Math.abs(diff); if (bestV <= TH) { nx += diff; gv = c; } }
        }
        for (const c of hCand) for (const off of [0, el.h / 2, el.h]) {
          const diff = c - (ny + off);
          if (Math.abs(diff) < bestH) { bestH = Math.abs(diff); if (bestH <= TH) { ny += diff; gh = c; } }
        }
        if (gv == null) nx = gsnap(nx);
        if (gh == null) ny = gsnap(ny);
        nx = Math.max(0, Math.min(A4W - el.w, Math.round(nx)));
        ny = Math.max(0, Math.min(MAXY - el.h, Math.round(ny)));
        setGuides({ v: gv != null ? [gv] : [], h: gh != null ? [gh] : [] });
        setElements((els) => els.map((o) => (o.id === d.id ? { ...o, x: nx, y: ny } : o)));
      } else {
        // 8-handle resize
        let x = d.origX, y = d.origY, w = d.origW, h = d.origH;
        if (d.handle.includes('e')) w = d.origW + dx;
        if (d.handle.includes('w')) { x = d.origX + dx; w = d.origW - dx; }
        if (d.handle.includes('s')) h = d.origH + dy;
        if (d.handle.includes('n')) { y = d.origY + dy; h = d.origH - dy; }
        if (w < 20) { if (d.handle.includes('w')) x = d.origX + d.origW - 20; w = 20; }
        if (h < 10) { if (d.handle.includes('n')) y = d.origY + d.origH - 10; h = 10; }
        if (x < 0) { w += x; x = 0; }
        if (y < 0) { h += y; y = 0; }
        w = Math.min(w, A4W - x); h = Math.min(h, MAXY - y);
        x = gsnap(x); y = gsnap(y); w = gsnap(w); h = gsnap(h);
        setElements((els) => els.map((o) => (o.id === d.id ? { ...o, x, y, w: Math.max(20, w), h: Math.max(10, h) } : o)));
      }
    };
    const up = () => { dragRef.current = null; setGuides({ v: [], h: [] }); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [snapOn]); // eslint-disable-line

  const startMove = (el) => (e) => {
    if (editingId === el.id) return;
    e.preventDefault(); e.stopPropagation();
    setSelId(el.id); setEditingId(null);
    pushHist();
    dragRef.current = { id: el.id, mode: 'move', startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y, zoom };
  };
  const startResize = (el, handle) => (e) => {
    e.preventDefault(); e.stopPropagation();
    setSelId(el.id);
    pushHist();
    dragRef.current = { id: el.id, mode: 'resize', handle, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y, origW: el.w, origH: el.h, zoom };
  };

  /* ---------------------------- keyboard ---------------------------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
      if (!selId) return;
      const step = e.shiftKey ? 10 : 1;
      const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (nudge) {
        e.preventDefault();
        setElements((els) => els.map((el) => (el.id === selId
          ? { ...el, x: Math.max(0, Math.min(A4W - el.w, el.x + nudge[0])), y: Math.max(0, Math.min(MAXY - el.h, el.y + nudge[1])) }
          : el)));
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); }
      if (e.key === 'Escape') setSelId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selId]); // eslint-disable-line

  /* ---------------------------- palette ---------------------------- */
  const addElement = (kind, extra = {}, at) => {
    pushHist();
    const el = { id: uid(), kind, x: at?.x ?? 40, y: at?.y ?? Math.min(740, 120 + elements.length * 8), align: 'left', color: kind === 'group' ? '#1e3a8a' : '#111827', bold: false, ...defaultsFor(kind), ...extra };
    if (kind === 'group') {
      const sec = sections.find((s) => s.id === extra.sectionId);
      if (sec) el.h = at?.h ?? 20 + Math.max(1, sec.fields.length) * 22;
    }
    setElements((els) => [...els, el]);
    setSelId(el.id);
  };
  const paletteDrag = (kind, extra) => (e) => {
    e.dataTransfer.setData('application/x-el', JSON.stringify({ kind, extra }));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const canvasDrop = (e) => {
    const raw = e.dataTransfer.getData('application/x-el');
    if (!raw) return;
    e.preventDefault();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { return; }
    const rect = canvasRef.current.getBoundingClientRect();
    addElement(parsed.kind, parsed.extra || {}, {
      x: gsnap(Math.max(0, (e.clientX - rect.left) / zoom - 60)),
      y: gsnap(Math.max(0, (e.clientY - rect.top) / zoom - 8)),
    });
  };

  const update = (patch) => setElements((els) => els.map((el) => (el.id === selId ? { ...el, ...patch } : el)));
  const removeSel = () => { pushHist(); setElements((els) => els.filter((el) => el.id !== selId)); setSelId(null); };
  const duplicateSel = () => {
    const s = elsRef.current.find((e) => e.id === selId);
    if (!s) return;
    pushHist();
    const copy = { ...s, id: uid(), x: Math.min(A4W - s.w, s.x + 12), y: Math.min(MAXY - s.h, s.y + 12) };
    setElements((els) => [...els, copy]);
    setSelId(copy.id);
  };
  const reorder = (dir) => {
    pushHist();
    setElements((els) => {
      const i = els.findIndex((e) => e.id === selId);
      if (i < 0) return els;
      const a = [...els];
      const [el] = a.splice(i, 1);
      if (dir === 'front') a.push(el); else a.unshift(el);
      return a;
    });
  };

  const save = async () => {
    setMsg(null);
    try {
      const layout = { settings, elements: elements.map(({ id: _id, ...el }) => el) };
      await adminApi.post(`/templates/${id}/layout`, { layout });
      setMsg({ type: 'ok', text: 'Layout saved.' });
      return true;
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); return false; }
  };
  const preview = async () => {
    if (!(await save())) return;
    try {
      const t = sessionStorage.getItem('adminToken');
      const r = await fetch(`/api/admin/templates/${id}/preview-pdf`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) throw new Error('Preview failed');
      window.open(URL.createObjectURL(await r.blob()), '_blank');
    } catch (e) { setMsg({ type: 'err', text: e.message }); }
  };

  if (!template) return <div>{msg ? <div className={`alert ${msg.type}`}>{msg.text}</div> : 'Loading…'}</div>;

  const fieldLabel = (el) => (allFields.find((f) => f.id === el.fieldId)?.label || 'field');

  const GroupPreview = ({ el }) => {
    const sec = sections.find((s) => s.id === el.sectionId);
    if (!sec) return <div className="muted">missing section</div>;
    const fields = (sec.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const fs = Math.max(6, el.fontSize);
    const titleH = fs + 8;
    const cols = Math.max(1, Math.min(3, Number(el.cols) || 1));
    const rows = Math.ceil(Math.max(1, fields.length) / cols);
    const rowH = Math.max(9, (el.h - titleH) / rows);
    return (
      <>
        <div style={{ height: titleH, fontSize: fs + 1, fontWeight: 700, color: el.color, borderBottom: `1px solid ${el.color}`, textAlign: el.align, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {el.title || sec.title}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gridAutoFlow: 'column', gridTemplateRows: `repeat(${rows}, ${rowH}px)`, columnGap: 6 }}>
          {fields.map((f) => (
            <div key={f.id} style={{ height: rowH, overflow: 'hidden', borderBottom: el.underline !== false ? '1px solid #e2e8f0' : 'none' }}>
              {el.showLabels !== false && rowH >= 14 && <div style={{ fontSize: Math.max(5, fs * 0.7), color: '#6b7280', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{f.label}</div>}
              <div style={{ fontSize: fs, color: '#111827', fontWeight: el.bold ? 700 : 400, lineHeight: 1.1 }}>value…</div>
            </div>
          ))}
        </div>
      </>
    );
  };

  const SIDEBAR_TABS = [
    { key: 'sections', icon: '▤', label: 'Sections' },
    { key: 'fields', icon: '🔤', label: 'Fields' },
    { key: 'elements', icon: '✚', label: 'Elements' },
  ];

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>PDF Layout Designer</h1>
          <div className="muted">{template.name} · double-click text to edit · arrows nudge · Ctrl+Z undo · Ctrl+D duplicate</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => navigate('/admin/templates')}>Back</button>
          <button className="btn ghost" onClick={undo}>↩ Undo</button>
          <button className="btn ghost" onClick={() => { pushHist(); autoLayout(template); }}>Auto-Layout</button>
          <button className="btn ghost" onClick={preview}>👁 Preview</button>
          <button className="btn green" onClick={save}>Save</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="card dz-toolbar">
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={settings.showHeader} onChange={(e) => setSettings({ ...settings, showHeader: e.target.checked })} />
          <b>School header</b>
        </label>
        {!settings.showHeader && (
          <label className="check" style={{ margin: 0 }}>
            Top space:
            <input type="number" value={settings.topSpace} min="0" max="300" style={{ width: 74, marginTop: 0 }}
              onChange={(e) => setSettings({ ...settings, topSpace: Number(e.target.value) })} /> pt
          </label>
        )}
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> snap
        </label>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          {sel ? `Selected: ${sel.kind === 'group' ? (sections.find((s) => s.id === sel.sectionId) || {}).title : sel.kind === 'field' ? fieldLabel(sel) : sel.kind} · x${sel.x} y${sel.y} · ${sel.w}×${sel.h}` : 'Click an element to style it — a toolbar appears above it'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
        {/* Canva-style dark sidebar */}
        <div className="cv-rail">
          {SIDEBAR_TABS.map((t) => (
            <div key={t.key} className={`cv-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
              <div className="cv-ico">{t.icon}</div>
              <div className="cv-lbl">{t.label}</div>
            </div>
          ))}
        </div>
        <div className="cv-panel">
          {tab === 'sections' && (
            <>
              <div className="cv-title">Section blocks</div>
              <div className="cv-hint">Drag a whole section onto the page — resize it and the fields reflow inside.</div>
              {sections.map((s) => (
                <div key={s.id} className={`cv-item ${usedSectionIds.has(s.id) ? 'used' : ''}`} draggable
                  onDragStart={paletteDrag('group', { sectionId: s.id })}
                  onClick={() => addElement('group', { sectionId: s.id })}>
                  <b>{s.title}</b>
                  <span>{s.fields.length} fields {usedSectionIds.has(s.id) ? '· on page ✓' : ''}</span>
                </div>
              ))}
            </>
          )}
          {tab === 'fields' && (
            <>
              <div className="cv-title">Single fields</div>
              <select value={palSection?.id || ''} style={{ marginBottom: 8 }} onChange={(e) => setPalSec(Number(e.target.value))}>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              {(palSection?.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((f) => (
                <div key={f.id} className={`cv-item ${usedFieldIds.has(f.id) ? 'used' : ''}`} draggable
                  onDragStart={paletteDrag('field', { fieldId: f.id })}
                  onClick={() => addElement('field', { fieldId: f.id })}>
                  <b>{f.label}</b>
                  <span>{f.fieldType}{usedFieldIds.has(f.id) ? ' · on page ✓' : ''}</span>
                </div>
              ))}
            </>
          )}
          {tab === 'elements' && (
            <>
              <div className="cv-title">Design elements</div>
              {[['text', '📝', 'Text / heading'], ['line', '━', 'Divider line'], ['box', '▭', 'Box / border'], ['photo', '🖼', 'Student photo'], ['signature', '✍', 'Signature']].map(([k, ico, label]) => (
                <div key={k} className="cv-item" draggable onDragStart={paletteDrag(k)} onClick={() => addElement(k)}>
                  <b>{ico} {label}</b>
                  <span>drag or click to add</span>
                </div>
              ))}
              <div className="cv-hint" style={{ marginTop: 8 }}>Text supports {'{{form_no}} {{class}} {{session}} {{date}}'}</div>
            </>
          )}
        </div>

        {/* workspace */}
        <div className="dz-workspace cv-workspace">
          <div style={{ width: A4W * zoom, height: A4H * zoom, margin: '0 auto', position: 'relative' }}>
            <div
              ref={canvasRef}
              className="design-canvas"
              style={{ width: A4W, height: A4H, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
              onMouseDown={() => { setSelId(null); setEditingId(null); }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-el')) e.preventDefault(); }}
              onDrop={canvasDrop}
            >
              {settings.showHeader ? (
                <div className="dc-header">SCHOOL HEADER (logo + name prints here)</div>
              ) : settings.topSpace > 0 ? (
                <div className="dc-reserved" style={{ height: settings.topSpace }}>reserved top space — {settings.topSpace}pt</div>
              ) : null}

              {guides.v.map((g, i) => <div key={'v' + i} className="cv-guide-v" style={{ left: g }} />)}
              {guides.h.map((g, i) => <div key={'h' + i} className="cv-guide-h" style={{ top: g }} />)}

              {elements.map((el) => (
                <div
                  key={el.id}
                  className={`dc-el dc-${el.kind} ${selId === el.id ? 'sel' : ''}`}
                  style={{
                    left: el.x, top: el.y, width: el.w, height: el.h,
                    fontSize: Math.max(6, el.fontSize), textAlign: el.align,
                    color: el.color, fontWeight: el.bold && el.kind !== 'group' ? 700 : 400,
                  }}
                  onMouseDown={startMove(el)}
                  onDoubleClick={(e) => { if (el.kind === 'text' || el.kind === 'signature') { e.stopPropagation(); setEditingId(el.id); setSelId(el.id); } }}
                >
                  {el.kind === 'group' && <GroupPreview el={el} />}
                  {el.kind === 'field' && (
                    <>
                      {el.showLabel !== false && <div className="dc-label">{fieldLabel(el)}</div>}
                      <div className="dc-value" style={{ borderBottom: el.underline ? '1px solid #9ca3af' : 'none' }}>value…</div>
                    </>
                  )}
                  {(el.kind === 'text' || el.kind === 'signature') && (
                    editingId === el.id ? (
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        autoFocus
                        className="cv-editing"
                        onMouseDown={(e) => e.stopPropagation()}
                        onBlur={(e) => { update({ text: e.target.textContent }); setEditingId(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
                      >
                        {el.text}
                      </div>
                    ) : el.kind === 'text' ? (
                      <div>{el.text || 'Add your text'}</div>
                    ) : (
                      <div className="dc-center muted" style={{ borderBottom: '1px solid #111' }}>{el.text || 'Signature'}</div>
                    )
                  )}
                  {el.kind === 'line' && <div style={{ borderTop: `2px solid ${el.color}`, marginTop: 3 }} />}
                  {el.kind === 'photo' && <div className="dc-center muted">PHOTO</div>}
                  {selId === el.id && HANDLES.map((h) => (
                    <div key={h} className={`cv-h cv-h-${h}`} onMouseDown={startResize(el, h)} />
                  ))}
                </div>
              ))}
            </div>

            {/* floating context toolbar (Canva-style) */}
            {sel && !editingId && (
              <div
                className="cv-float"
                style={{
                  left: Math.max(120, Math.min(A4W * zoom - 120, (sel.x + sel.w / 2) * zoom)),
                  top: Math.max(4, sel.y * zoom - 46),
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button onClick={() => update({ fontSize: Math.max(5, sel.fontSize - 1) })} title="Smaller">A−</button>
                <span className="cv-fs">{sel.fontSize}</span>
                <button onClick={() => update({ fontSize: Math.min(30, sel.fontSize + 1) })} title="Bigger">A+</button>
                <button className={sel.bold ? 'on' : ''} onClick={() => update({ bold: !sel.bold })}><b>B</b></button>
                <button onClick={() => update({ align: sel.align === 'left' ? 'center' : sel.align === 'center' ? 'right' : 'left' })} title="Alignment">
                  {sel.align === 'center' ? '↔' : sel.align === 'right' ? '➡' : '⬅'}
                </button>
                <label className="cv-color" title="Color">
                  <span style={{ background: sel.color }} />
                  <input type="color" value={sel.color || '#111827'} onChange={(e) => update({ color: e.target.value })} />
                </label>
                {sel.kind === 'group' && (
                  <select value={sel.cols || 1} onChange={(e) => update({ cols: Number(e.target.value) })}>
                    <option value={1}>1 col</option><option value={2}>2 col</option><option value={3}>3 col</option>
                  </select>
                )}
                {sel.kind === 'group' && <button className={sel.showLabels !== false ? 'on' : ''} onClick={() => update({ showLabels: sel.showLabels === false })} title="Field labels">🏷</button>}
                {sel.kind === 'field' && <button className={sel.showLabel !== false ? 'on' : ''} onClick={() => update({ showLabel: sel.showLabel === false })} title="Label">🏷</button>}
                <button onClick={duplicateSel} title="Duplicate (Ctrl+D)">⧉</button>
                <button onClick={() => reorder('front')} title="Bring to front">▲</button>
                <button onClick={() => reorder('back')} title="Send to back">▼</button>
                <button onClick={() => update({ x: Math.round((A4W - sel.w) / 2) })} title="Center on page">⇔</button>
                <button className="danger" onClick={removeSel} title="Delete">🗑</button>
              </div>
            )}
          </div>

          {/* floating zoom control */}
          <div className="cv-zoom">
            <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.25) * 100) / 100))}>+</button>
          </div>
        </div>
      </div>
    </div>
  );
}
