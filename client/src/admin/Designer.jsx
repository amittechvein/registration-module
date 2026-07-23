import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

/**
 * Visual PDF layout designer. Canvas is A4 at 1:1 PDF points (595 × 842).
 * Drag boxes to move, drag the corner square to resize, click to select and
 * style (font size, alignment, color, bold). Saved layout powers the
 * "Custom" PDF template.
 */
const A4W = 595, A4H = 842;
const GRID = 5;
const snap = (v) => Math.round(v / GRID) * GRID;
const uid = () => 'e' + Math.random().toString(36).slice(2, 9);

const defaultsFor = (kind) => ({
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
  const [msg, setMsg] = useState(null);
  const dragRef = useRef(null);
  const canvasRef = useRef(null);

  const allFields = (template?.sections || []).flatMap((s) => (s.fields || []).map((f) => ({ ...f, sectionTitle: s.title })));
  const usedFieldIds = new Set(elements.filter((e) => e.kind === 'field').map((e) => e.fieldId));
  const sel = elements.find((e) => e.id === selId);

  useEffect(() => {
    adminApi.get(`/templates/${id}`).then((r) => {
      setTemplate(r.data);
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

  /** Sensible starting point: all fields in two columns below the header. */
  const autoLayout = (t) => {
    const els = [];
    let col = 0, y = [115, 115];
    const colX = [25, 310], colW = 260;
    for (const s of (t.sections || []).sort((a, b) => a.sortOrder - b.sortOrder)) {
      const fields = (s.fields || []).sort((a, b) => a.sortOrder - b.sortOrder);
      col = y[0] <= y[1] ? 0 : 1;
      els.push({ id: uid(), kind: 'text', text: s.title, x: colX[col], y: y[col], w: colW, h: 14, fontSize: 9, bold: true, color: '#1e3a8a', align: 'left' });
      y[col] += 18;
      for (const f of fields) {
        if (y[col] > 780) { col = col === 0 ? 1 : 0; }
        if (y[col] > 780) break;
        els.push({ id: uid(), kind: 'field', fieldId: f.id, x: colX[col], y: y[col], w: colW, h: 24, fontSize: 8, showLabel: true, align: 'left', color: '#111827', underline: true });
        y[col] += 28;
      }
      y[col] += 6;
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
        return { ...el, w: Math.max(20, Math.min(A4W - el.x, snap(d.origW + dx))), h: Math.max(8, Math.min(815 - el.y, snap(d.origH + dy))) };
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
    const el = { id: uid(), kind, x: at?.x ?? 40, y: at?.y ?? Math.min(760, 120 + elements.length * 6), align: 'left', color: kind === 'text' ? '#111827' : '#111827', bold: false, ...defaultsFor(kind), ...extra };
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

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>PDF Layout Designer</h1>
          <div className="muted">{template.name} — drag boxes on the A4 page, resize from the corner, style from the toolbar. 1 canvas unit = 1 print point.</div>
        </div>
        <div>
          <button className="btn ghost" onClick={() => navigate('/admin/templates')}>Back</button>{' '}
          <button className="btn ghost" onClick={() => autoLayout(template)}>Reset Auto-Layout</button>{' '}
          <button className="btn green" onClick={save}>Save Layout</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      {/* page settings */}
      <div className="card" style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px' }}>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={settings.showHeader} onChange={(e) => setSettings({ ...settings, showHeader: e.target.checked })} />
          <b>Show school header</b> (logo + name)
        </label>
        {!settings.showHeader && (
          <label className="check" style={{ margin: 0 }}>
            Top space to leave (for pre-printed letterhead):
            <input type="number" value={settings.topSpace} min="0" max="300" style={{ width: 80, marginTop: 0 }}
              onChange={(e) => setSettings({ ...settings, topSpace: Number(e.target.value) })} /> pt
          </label>
        )}
        <span className="muted">Elements placed in the header / reserved area will print over it — keep them below the shaded zone.</span>
      </div>

      {/* selected element toolbar */}
      {sel && (
        <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px' }}>
          <b style={{ fontSize: 13 }}>{sel.kind === 'field' ? `🔤 ${fieldLabel(sel)}` : `▣ ${sel.kind}`}</b>
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
        {/* palette */}
        <div className="card" style={{ width: 230, flexShrink: 0, maxHeight: 700, overflowY: 'auto' }}>
          <h3 style={{ fontSize: 14 }}>Elements</h3>
          <div className="muted" style={{ marginBottom: 8 }}>Drag onto the page (or click to add)</div>
          {[['text', '📝 Text / heading'], ['line', '━ Line'], ['box', '▭ Box / border'], ['photo', '🖼 Student photo'], ['signature', '✍ Signature']].map(([k, label]) => (
            <div key={k} className="pal-item" draggable onDragStart={paletteDrag(k)} onClick={() => addElement(k)}>{label}</div>
          ))}
          <h3 style={{ fontSize: 14, marginTop: 14 }}>Form Fields</h3>
          {allFields.map((f) => (
            <div key={f.id} className={`pal-item ${usedFieldIds.has(f.id) ? 'used' : ''}`} draggable
              onDragStart={paletteDrag('field', { fieldId: f.id })}
              onClick={() => addElement('field', { fieldId: f.id })}
              title={f.sectionTitle}>
              {usedFieldIds.has(f.id) ? '✓ ' : ''}{f.label}
            </div>
          ))}
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
                color: el.color, fontWeight: el.bold ? 700 : 400,
              }}
              onMouseDown={startMove(el)}
            >
              {el.kind === 'field' && (
                <>
                  {el.showLabel !== false && <div className="dc-label">{fieldLabel(el)}</div>}
                  <div className="dc-value" style={{ borderBottom: el.underline ? '1px solid #9ca3af' : 'none' }}>value…</div>
                </>
              )}
              {el.kind === 'text' && <div>{el.text || 'Text…'}</div>}
              {el.kind === 'line' && <div style={{ borderTop: `2px solid ${el.color}`, marginTop: 3 }} />}
              {el.kind === 'box' && null}
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
