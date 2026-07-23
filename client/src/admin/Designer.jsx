import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

/**
 * Visual PDF layout designer. Canvas is A4 at 1:1 PDF points (595 × 842).
 * - Whole sections are draggable, resizable blocks (fields reflow inside).
 * - Individual fields / text / photo / signature elements can also be placed.
 * - Palette: sections on the left → click one to see its fields on the right.
 */
const A4W = 595, A4H = 842;
const GRID = 5;
const snap = (v) => Math.round(v / GRID) * GRID;
const uid = () => 'e' + Math.random().toString(36).slice(2, 9);

const defaultsFor = (kind) => ({
  group: { w: 265, h: 180, fontSize: 8, cols: 1, showLabels: true, underline: true, color: '#1e3a8a' },
  field: { w: 160, h: 26, fontSize: 8, showLabel: true },
  text: { w: 180, h: 16, fontSize: 10, text: 'Text…' },
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
  const [palSec, setPalSec] = useState(null); // selected section in the palette
  const [msg, setMsg] = useState(null);
  const dragRef = useRef(null);
  const canvasRef = useRef(null);

  const sections = (template?.sections || []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const allFields = sections.flatMap((s) => (s.fields || []).map((f) => ({ ...f, sectionTitle: s.title })));
  const usedFieldIds = new Set(elements.filter((e) => e.kind === 'field').map((e) => e.fieldId));
  const usedSectionIds = new Set(elements.filter((e) => e.kind === 'group').map((e) => e.sectionId));
  const sel = elements.find((e) => e.id === selId);
  const palSection = sections.find((s) => s.id === palSec);

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

  /** Default: every section as a resizable block, flowing down two columns. */
  const autoLayout = (t) => {
    const els = [];
    const colX = [22, 305], colW = 268;
    const y = [112, 112];
    for (const s of (t.sections || []).slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
      const n = (s.fields || []).length;
      const h = 20 + Math.max(1, n) * 22;
      const col = y[0] <= y[1] ? 0 : 1;
      if (y[col] + h > 815) continue; // beyond one page — user can rearrange
      els.push({ id: uid(), kind: 'group', sectionId: s.id, x: colX[col], y: y[col], w: colW, h, fontSize: 8, cols: 1, showLabels: true, underline: true, color: '#1e3a8a', align: 'left' });
      y[col] += h + 10;
    }
    setElements(els);
  };

  /* ---------- move / resize ---------- */
  useEffect(() => {
    const move = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
      setElements((els) => els.map((el) => {
        if (el.id !== d.id) return el;
        if (d.mode === 'move') {
          return { ...el, x: Math.max(0, Math.min(A4W - el.w, snap(d.origX + dx))), y: Math.max(0, Math.min(810 - el.h, snap(d.origY + dy))) };
        }
        return { ...el, w: Math.max(30, Math.min(A4W - el.x, snap(d.origW + dx))), h: Math.max(12, Math.min(818 - el.y, snap(d.origH + dy))) };
      }));
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const startMove = (el) => (e) => {
    e.preventDefault(); e.stopPropagation();
    setSelId(el.id);
    dragRef.current = { id: el.id, mode: 'move', startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y };
  };
  const startResize = (el) => (e) => {
    e.preventDefault(); e.stopPropagation();
    setSelId(el.id);
    dragRef.current = { id: el.id, mode: 'resize', startX: e.clientX, startY: e.clientY, origW: el.w, origH: el.h };
  };

  /* ---------- palette ---------- */
  const addElement = (kind, extra = {}, at) => {
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
    const { kind, extra } = JSON.parse(raw);
    const rect = canvasRef.current.getBoundingClientRect();
    addElement(kind, extra, { x: snap(Math.max(0, e.clientX - rect.left - 60)), y: snap(Math.max(0, e.clientY - rect.top - 8)) });
  };

  const update = (patch) => setElements((els) => els.map((el) => (el.id === selId ? { ...el, ...patch } : el)));
  const removeSel = () => { setElements((els) => els.filter((el) => el.id !== selId)); setSelId(null); };

  const save = async () => {
    setMsg(null);
    try {
      const layout = { settings, elements: elements.map(({ id: _id, ...el }) => el) };
      await adminApi.post(`/templates/${id}/layout`, { layout });
      setMsg({ type: 'ok', text: 'Layout saved. Set a form\'s PDF Design to "Custom" (Active Forms page) to use it.' });
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };

  if (!template) return <div>{msg ? <div className={`alert ${msg.type}`}>{msg.text}</div> : 'Loading…'}</div>;

  const fieldLabel = (el) => (allFields.find((f) => f.id === el.fieldId)?.label || 'field');
  const isOverEl = null;

  /* ---------- group preview geometry (mirrors the PDF renderer) ---------- */
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

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>PDF Layout Designer</h1>
          <div className="muted">{template.name} — drag section blocks or single elements on the A4 page; resize from the corner; style from the toolbar.</div>
        </div>
        <div>
          <button className="btn ghost" onClick={() => navigate('/admin/templates')}>Back</button>{' '}
          <button className="btn ghost" onClick={() => autoLayout(template)}>Reset Auto-Layout</button>{' '}
          <button className="btn green" onClick={save}>Save Layout</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="card" style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px' }}>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={settings.showHeader} onChange={(e) => setSettings({ ...settings, showHeader: e.target.checked })} />
          <b>Show school header</b> (logo + name)
        </label>
        {!settings.showHeader && (
          <label className="check" style={{ margin: 0 }}>
            Top space to leave (pre-printed letterhead):
            <input type="number" value={settings.topSpace} min="0" max="300" style={{ width: 80, marginTop: 0 }}
              onChange={(e) => setSettings({ ...settings, topSpace: Number(e.target.value) })} /> pt
          </label>
        )}
      </div>

      {sel && (
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px' }}>
          <b style={{ fontSize: 13 }}>
            {sel.kind === 'group' ? `▤ Section: ${(sections.find((s) => s.id === sel.sectionId) || {}).title}`
              : sel.kind === 'field' ? `🔤 ${fieldLabel(sel)}` : `▣ ${sel.kind}`}
          </b>
          <label className="check" style={{ margin: 0 }}>Font
            <input type="number" min="5" max="30" value={sel.fontSize} style={{ width: 62, marginTop: 0 }} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
          </label>
          <div style={{ display: 'flex', gap: 2 }}>
            {['left', 'center', 'right'].map((a) => (
              <button key={a} className={`btn small ${sel.align === a ? '' : 'ghost'}`} onClick={() => update({ align: a })} title={`Align ${a}`}>
                {a === 'left' ? '⬅' : a === 'center' ? '↔' : '➡'}
              </button>
            ))}
          </div>
          <button className={`btn small ${sel.bold ? '' : 'ghost'}`} onClick={() => update({ bold: !sel.bold })}><b>B</b></button>
          <label className="check" style={{ margin: 0 }}>Color
            <input type="color" value={sel.color || '#111827'} style={{ marginTop: 0, width: 42, height: 30, padding: 2 }} onChange={(e) => update({ color: e.target.value })} />
          </label>
          {sel.kind === 'group' && (
            <>
              <label className="check" style={{ margin: 0 }}>Columns
                <select value={sel.cols || 1} style={{ width: 60, marginTop: 0 }} onChange={(e) => update({ cols: Number(e.target.value) })}>
                  <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                </select>
              </label>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={sel.showLabels !== false} onChange={(e) => update({ showLabels: e.target.checked })} /> labels
              </label>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={sel.underline !== false} onChange={(e) => update({ underline: e.target.checked })} /> row lines
              </label>
              <input type="text" value={sel.title || ''} style={{ marginTop: 0, width: 200 }} placeholder="Custom section heading (optional)" onChange={(e) => update({ title: e.target.value })} />
            </>
          )}
          {sel.kind === 'field' && (
            <>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={sel.showLabel !== false} onChange={(e) => update({ showLabel: e.target.checked })} /> label
              </label>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={!!sel.underline} onChange={(e) => update({ underline: e.target.checked })} /> underline
              </label>
            </>
          )}
          {(sel.kind === 'text' || sel.kind === 'signature') && (
            <input type="text" value={sel.text || ''} style={{ marginTop: 0, width: 280 }} placeholder={sel.kind === 'text' ? 'Text — supports {{form_no}} {{class}} {{session}} {{date}}' : 'Caption'} onChange={(e) => update({ text: e.target.value })} />
          )}
          <span className="muted">x{sel.x} y{sel.y} · {sel.w}×{sel.h}</span>
          <button className="btn small danger" onClick={removeSel}>Delete</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {/* two-pane palette: sections left, fields of selected section right */}
        <div className="card" style={{ width: 330, flexShrink: 0, padding: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ width: 150, flexShrink: 0 }}>
              <div className="drag-note" style={{ margin: '2px 0 6px' }}>SECTIONS — drag whole block</div>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {sections.map((s) => (
                  <div
                    key={s.id}
                    className={`pal-item ${palSec === s.id ? 'pal-active' : ''} ${usedSectionIds.has(s.id) ? 'used' : ''}`}
                    draggable
                    onDragStart={paletteDrag('group', { sectionId: s.id })}
                    onClick={() => setPalSec(s.id)}
                    onDoubleClick={() => addElement('group', { sectionId: s.id })}
                  >
                    {usedSectionIds.has(s.id) ? '✓ ' : ''}{s.title}
                    <div className="drag-note">{s.fields.length} fields</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="drag-note" style={{ margin: '2px 0 6px' }}>
                {palSection ? `FIELDS IN “${palSection.title}”` : 'FIELDS'}
              </div>
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                {(palSection?.fields || []).slice().sort((a, b) => a.sortOrder - b.sortOrder).map((f) => (
                  <div key={f.id} className={`pal-item ${usedFieldIds.has(f.id) ? 'used' : ''}`} draggable
                    onDragStart={paletteDrag('field', { fieldId: f.id })}
                    onClick={() => addElement('field', { fieldId: f.id })}>
                    {usedFieldIds.has(f.id) ? '✓ ' : ''}{f.label}
                  </div>
                ))}
                {palSection && (
                  <button className="btn small ghost" style={{ width: '100%', marginTop: 4 }} onClick={() => addElement('group', { sectionId: palSection.id })}>
                    + Add whole section as block
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="drag-note" style={{ margin: '10px 0 6px' }}>OTHER ELEMENTS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[['text', '📝 Text'], ['line', '━ Line'], ['box', '▭ Box'], ['photo', '🖼 Photo'], ['signature', '✍ Signature']].map(([k, label]) => (
              <div key={k} className="pal-item" style={{ marginBottom: 0 }} draggable onDragStart={paletteDrag(k)} onClick={() => addElement(k)}>{label}</div>
            ))}
          </div>
        </div>

        {/* canvas */}
        <div
          ref={canvasRef}
          className="design-canvas"
          style={{ width: A4W, height: A4H }}
          onMouseDown={() => setSelId(null)}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-el')) e.preventDefault(); }}
          onDrop={canvasDrop}
        >
          {settings.showHeader ? (
            <div className="dc-header">SCHOOL HEADER (logo + name prints here)</div>
          ) : settings.topSpace > 0 ? (
            <div className="dc-reserved" style={{ height: settings.topSpace }}>reserved top space — {settings.topSpace}pt (pre-printed letterhead)</div>
          ) : null}

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
            >
              {el.kind === 'group' && <GroupPreview el={el} />}
              {el.kind === 'field' && (
                <>
                  {el.showLabel !== false && <div className="dc-label">{fieldLabel(el)}</div>}
                  <div className="dc-value" style={{ borderBottom: el.underline ? '1px solid #9ca3af' : 'none' }}>value…</div>
                </>
              )}
              {el.kind === 'text' && <div>{el.text || 'Text…'}</div>}
              {el.kind === 'line' && <div style={{ borderTop: `2px solid ${el.color}`, marginTop: 3 }} />}
              {el.kind === 'photo' && <div className="dc-center muted">PHOTO</div>}
              {el.kind === 'signature' && <div className="dc-center muted" style={{ borderBottom: '1px solid #111' }}>{el.text || 'Signature'}</div>}
              {selId === el.id && <div className="dc-resize" onMouseDown={startResize(el)} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
