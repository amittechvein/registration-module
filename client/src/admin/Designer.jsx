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
  const [settings, setSettings] = useState({ showHeader: true, topSpace: 100, header: {} });
  const [selId, setSelId] = useState(null); // element id or '__header'
  const [logoVer, setLogoVer] = useState(0); // cache-buster after logo upload
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
        setElements(layout.elements.map((e) => ({
          id: uid(), ...e,
          // migrate old boolean label props to the 3-way labelStyle
          ...(e.kind === 'group' ? { labelStyle: e.labelStyle || (e.showLabels === false ? 'hidden' : 'above') } : {}),
          ...(e.kind === 'field' ? { labelStyle: e.labelStyle || (e.showLabel === false ? 'hidden' : 'above') } : {}),
        })));
        setSettings({ showHeader: true, topSpace: 100, header: {}, ...(layout.settings || {}) });
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
  /** Ungroup: turn a section block into freely-adjustable individual elements. */
  const ungroup = () => {
    const g = elsRef.current.find((e) => e.id === selId && e.kind === 'group');
    if (!g) return;
    const sec = sections.find((s) => s.id === g.sectionId);
    if (!sec) return;
    pushHist();
    const fields = (sec.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const fs = Math.max(6, g.fontSize);
    const titleH = fs + 8;
    const cols = Math.max(1, Math.min(3, Number(g.cols) || 1));
    const rows = Math.ceil(Math.max(1, fields.length) / cols);
    const rowH = Math.max(9, (g.h - titleH) / rows);
    const cellW = g.w / cols;
    const newEls = [
      { id: uid(), kind: 'text', text: g.title || sec.title, x: g.x, y: g.y, w: g.w, h: titleH, fontSize: fs + 1, bold: true, color: g.color, align: g.align || 'left' },
      ...fields.map((f, idx) => {
        const col = Math.floor(idx / rows), row = idx % rows;
        return {
          id: uid(), kind: 'field', fieldId: f.id,
          x: Math.round(g.x + col * cellW), y: Math.round(g.y + titleH + row * rowH),
          w: Math.round(cellW - 8), h: Math.round(rowH),
          fontSize: fs, bold: !!g.bold, color: '#111827', align: 'left',
          labelStyle: g.labelStyle || 'above', underline: g.underline !== false,
        };
      }),
    ];
    setElements((els) => [...els.filter((e) => e.id !== g.id), ...newEls]);
    setSelId(null);
    setMsg({ type: 'ok', text: `Ungrouped "${sec.title}" — every field is now individually adjustable.` });
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      await adminApi.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setLogoVer((v) => v + 1);
      setMsg({ type: 'ok', text: 'Logo updated — it now prints on all PDFs and shows in the header.' });
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };
  const upHeader = (patch) => setSettings((s) => ({ ...s, header: { ...(s.header || {}), ...patch } }));

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
          {fields.map((f) => {
            const ls = el.labelStyle || 'above';
            return (
              <div key={f.id} style={{ height: rowH, overflow: 'hidden', borderBottom: el.underline !== false ? '1px solid #e2e8f0' : 'none' }}>
                {ls === 'above' && rowH >= 14 && <div style={{ fontSize: Math.max(5, fs * 0.7), color: '#6b7280', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{f.label}</div>}
                <div style={{ fontSize: fs, color: '#111827', fontWeight: el.bold ? 700 : 400, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {ls === 'inline' && <span style={{ color: '#6b7280', fontWeight: 400 }}>{f.label}: </span>}
                  value…
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const SIDEBAR_TABS = [
    { key: 'sections', icon: '▤', label: 'Sections' },
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

      {selId === '__header' && settings.showHeader && (
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', padding: '12px 16px', borderLeft: '4px solid #b91c1c' }}>
          <b style={{ alignSelf: 'center' }}>✏ School Header</b>
          <label className="fld" style={{ margin: 0, width: 220 }}>School name (line 1)
            <input type="text" value={settings.header?.name || ''} placeholder="(default from server settings)" onChange={(e) => upHeader({ name: e.target.value })} />
          </label>
          <label className="fld" style={{ margin: 0, width: 260 }}>Address (line 2)
            <input type="text" value={settings.header?.address || ''} placeholder="(default from server settings)" onChange={(e) => upHeader({ address: e.target.value })} />
          </label>
          <label className="fld" style={{ margin: 0, width: 240 }}>Extra line 3 (phone / affiliation — optional)
            <input type="text" value={settings.header?.line3 || ''} placeholder="e.g. Ph: 0353-2545678 · Affiliated to ICSE" onChange={(e) => upHeader({ line3: e.target.value })} />
          </label>
          <label className="fld" style={{ margin: 0, width: 110 }}>Alignment
            <select value={settings.header?.align || 'left'} onChange={(e) => upHeader({ align: e.target.value })}>
              <option value="left">Left</option><option value="center">Center</option>
            </select>
          </label>
          <label className="fld" style={{ margin: 0 }}>Name color
            <input type="color" value={settings.header?.nameColor || '#b91c1c'} style={{ width: 46, height: 32, padding: 2 }} onChange={(e) => upHeader({ nameColor: e.target.value })} />
          </label>
          <label className="check" style={{ margin: '0 0 6px' }}>
            <input type="checkbox" checked={settings.header?.showLogo !== false} onChange={(e) => upHeader({ showLogo: e.target.checked })} /> logo
          </label>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            ⬆ Upload logo<input type="file" accept=".png,.jpg,.jpeg" hidden onChange={(e) => uploadLogo(e.target.files?.[0])} />
          </label>
          <button className="btn small ghost" onClick={() => setSelId(null)}>Done</button>
        </div>
      )}

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
          {tab === 'sections' && (
            <div className="cv-hint" style={{ marginTop: 10 }}>Tip: to adjust fields individually, place a section block and press ⛓✂ Ungroup in its toolbar.</div>
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
                <div
                  className={`cv-header ${selId === '__header' ? 'sel' : ''}`}
                  style={{ textAlign: settings.header?.align === 'center' ? 'center' : 'left' }}
                  onMouseDown={(e) => { e.stopPropagation(); setSelId('__header'); }}
                  title="Click to edit the header"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: settings.header?.align === 'center' ? 'center' : 'flex-start' }}>
                    {settings.header?.showLogo !== false && (
                      <img src={`/api/public/logo?v=${logoVer}`} alt="" style={{ height: 40 }} onError={(e) => { e.target.style.display = 'none'; }} />
                    )}
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: settings.header?.nameColor || '#b91c1c' }}>
                        {settings.header?.name || 'School name (from settings)'}
                      </div>
                      <div style={{ fontSize: 8.5, color: '#6b7280' }}>{settings.header?.address || 'Address line'}</div>
                      {settings.header?.line3 && <div style={{ fontSize: 8.5, color: '#6b7280' }}>{settings.header.line3}</div>}
                    </div>
                  </div>
                  <div style={{ borderTop: `2px solid ${settings.header?.nameColor || '#b91c1c'}`, marginTop: 5 }} />
                  <div className="cv-header-hint">✏ click to edit header</div>
                </div>
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
                      {(el.labelStyle || 'above') === 'above' && <div className="dc-label">{fieldLabel(el)}</div>}
                      <div className="dc-value" style={{ borderBottom: el.underline ? '1px solid #9ca3af' : 'none' }}>
                        {el.labelStyle === 'inline' && <span style={{ color: '#6b7280', fontWeight: 400 }}>{fieldLabel(el)}: </span>}
                        value…
                      </div>
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
                {(sel.kind === 'group' || sel.kind === 'field') && (
                  <select value={sel.labelStyle || 'above'} title="Label style" onChange={(e) => update({ labelStyle: e.target.value })}>
                    <option value="above">Label above</option>
                    <option value="inline">Label: value</option>
                    <option value="hidden">Value only</option>
                  </select>
                )}
                {sel.kind === 'group' && <button onClick={ungroup} title="Ungroup — make every field adjustable">⛓✂</button>}
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
