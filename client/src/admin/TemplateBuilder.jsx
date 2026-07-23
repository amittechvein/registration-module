import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'email', 'phone', 'select', 'radio', 'checkbox', 'file'];

const emptyField = () => ({ label: '', fieldType: 'text', options: [], required: false, studentField: '', validation: {} });
const emptySection = (title = '') => ({ title, collapsed: false, fields: [emptyField()] });

export default function TemplateBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [sections, setSections] = useState([emptySection('Personal Details')]);
  const [studentFields, setStudentFields] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  // drag & drop state
  const drag = useRef(null); // { type:'section', si } | { type:'field', si, fi }
  const [over, setOver] = useState(null); // same shape + { type:'field-end', si }

  useEffect(() => {
    adminApi.get('/meta').then((r) => setStudentFields(r.data.studentFields));
    if (id) {
      adminApi.get(`/templates/${id}`).then((r) => {
        const t = r.data;
        setName(t.name); setDescription(t.description || ''); setActive(t.active);
        setSections(
          t.sections
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s) => ({
              title: s.title,
              collapsed: false,
              fields: s.fields
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((f) => ({
                  label: f.label, fieldType: f.fieldType,
                  options: JSON.parse(f.options || '[]'),
                  required: f.required, studentField: f.studentField || '',
                  validation: JSON.parse(f.validation || '{}'),
                })),
            }))
        );
      }).catch((e) => setErr(errMsg(e)));
    }
  }, [id]);

  const upSection = (i, patch) => setSections((s) => s.map((sec, j) => (j === i ? { ...sec, ...patch } : sec)));
  const upField = (i, k, patch) =>
    setSections((s) => s.map((sec, j) => (j === i ? { ...sec, fields: sec.fields.map((f, l) => (l === k ? { ...f, ...patch } : f)) } : sec)));

  /* ---------- drag & drop ---------- */
  const startSectionDrag = (si) => (e) => { drag.current = { type: 'section', si }; e.dataTransfer.effectAllowed = 'move'; };
  const startFieldDrag = (si, fi) => (e) => { drag.current = { type: 'field', si, fi }; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); };
  const clearDrag = () => { drag.current = null; setOver(null); };

  const onSectionOver = (si) => (e) => {
    if (drag.current?.type === 'section' && drag.current.si !== si) { e.preventDefault(); setOver({ type: 'section', si }); }
  };
  const dropSection = (si) => (e) => {
    e.preventDefault();
    if (drag.current?.type !== 'section') return clearDrag();
    setSections((s) => {
      const a = [...s];
      const [moved] = a.splice(drag.current.si, 1);
      a.splice(si > drag.current.si ? si - 1 : si, 0, moved);
      return a;
    });
    clearDrag();
  };

  const moveField = (dstSi, dstFi) => {
    const src = drag.current;
    if (!src || src.type !== 'field') return;
    setSections((s) => {
      const a = s.map((sec) => ({ ...sec, fields: [...sec.fields] }));
      const [moved] = a[src.si].fields.splice(src.fi, 1);
      let target = dstFi;
      if (src.si === dstSi && src.fi < dstFi) target -= 1; // account for removal
      if (target < 0 || target > a[dstSi].fields.length) target = a[dstSi].fields.length;
      a[dstSi].fields.splice(target, 0, moved);
      return a;
    });
  };
  const onFieldOver = (si, fi) => (e) => {
    if (drag.current?.type === 'field') { e.preventDefault(); e.stopPropagation(); setOver({ type: 'field', si, fi }); }
  };
  const dropField = (si, fi) => (e) => {
    e.preventDefault(); e.stopPropagation();
    moveField(si, fi);
    clearDrag();
  };
  const onFieldEndOver = (si) => (e) => {
    if (drag.current?.type === 'field') { e.preventDefault(); setOver({ type: 'field-end', si }); }
  };
  const dropFieldEnd = (si) => (e) => {
    e.preventDefault();
    moveField(si, sections[si].fields.length);
    clearDrag();
  };

  const save = async () => {
    setErr(''); setOk('');
    try {
      const payload = { id: id || undefined, name, description, active, sections: sections.map(({ collapsed, ...s }) => s) };
      const { data } = await adminApi.post('/templates', payload);
      setOk('Template saved');
      if (!id) navigate(`/admin/templates/${data.id}`);
    } catch (e) { setErr(errMsg(e)); }
  };

  const isOver = (t, si, fi) => over && over.type === t && over.si === si && (fi === undefined || over.fi === fi);

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>{id ? 'Edit Template' : 'New Form Template'}</h1>
          <div className="muted">Drag <b>⠿</b> to reorder sections and fields — fields can even be dragged into another section. Link fields to the student profile so allotted applicants flow into the Students DB.</div>
        </div>
        <div>
          <button className="btn ghost" onClick={() => navigate('/admin/templates')}>Back</button>{' '}
          <button className="btn green" onClick={save}>Save Template</button>
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}
      {ok && <div className="alert ok">{ok}</div>}

      <div className="card">
        <div className="grid cols-2">
          <label className="fld">Form name <span className="req">*</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Registration Form 2026-27" />
          </label>
          <label className="fld">Description
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Internal note" />
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Template active (available when activating forms)</label>
      </div>

      {sections.map((sec, i) => (
        <div
          key={i}
          className={`tb-section ${drag.current?.type === 'section' && drag.current.si === i ? 'dragging' : ''} ${isOver('section', i) ? 'drop-target' : ''}`}
          onDragOver={onSectionOver(i)}
          onDrop={dropSection(i)}
        >
          <div className="tb-section-header">
            <span className="handle" title="Drag to reorder section" draggable onDragStart={startSectionDrag(i)} onDragEnd={clearDrag}>⠿</span>
            <button className="btn small ghost" style={{ background: 'transparent', color: '#dbe4f8', border: '1px solid rgba(255,255,255,.3)' }}
              onClick={() => upSection(i, { collapsed: !sec.collapsed })} title={sec.collapsed ? 'Expand' : 'Collapse'}>
              {sec.collapsed ? '▸' : '▾'}
            </button>
            <input type="text" value={sec.title} onChange={(e) => upSection(i, { title: e.target.value })} placeholder="Section name (e.g. Personal Details)" />
            <span className="count">{sec.fields.length} field{sec.fields.length === 1 ? '' : 's'}</span>
            <span style={{ flex: 1 }} />
            <button className="btn small danger" onClick={() => setSections((s) => s.filter((_, j) => j !== i))}>Remove</button>
          </div>

          {!sec.collapsed && (
            <div className="tb-section-body">
              <div className="tb-cols-note">
                <span />
                <span className="drag-note">Field label</span>
                <span className="drag-note">Type</span>
                <span className="drag-note">Link to student profile</span>
                <span className="drag-note">Req.</span>
                <span className="drag-note">Options / validation</span>
                <span />
              </div>

              {sec.fields.map((f, k) => (
                <div
                  key={k}
                  className={`tb-field ${drag.current?.type === 'field' && drag.current.si === i && drag.current.fi === k ? 'dragging' : ''} ${isOver('field', i, k) ? 'drop-target' : ''}`}
                  onDragOver={onFieldOver(i, k)}
                  onDrop={dropField(i, k)}
                >
                  <span className="handle" title="Drag to reorder / move to another section" draggable onDragStart={startFieldDrag(i, k)} onDragEnd={clearDrag}>⠿</span>
                  <div>
                    <input type="text" value={f.label} onChange={(e) => upField(i, k, { label: e.target.value })} placeholder="e.g. Student Name" />
                    {f.studentField && <div className="link-chip">🔗 fills “{(studentFields.find((sf) => sf.key === f.studentField) || {}).label}” on allotment</div>}
                  </div>
                  <select value={f.fieldType} onChange={(e) => upField(i, k, { fieldType: e.target.value })}>
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select value={f.studentField} onChange={(e) => upField(i, k, { studentField: e.target.value })}>
                    <option value="">— not linked —</option>
                    {studentFields.map((sf) => <option key={sf.key} value={sf.key}>{sf.label}</option>)}
                  </select>
                  <label className="check" style={{ margin: 0, justifyContent: 'center' }}>
                    <input type="checkbox" checked={f.required} onChange={(e) => upField(i, k, { required: e.target.checked })} />
                  </label>
                  <div>
                    {['select', 'radio', 'checkbox'].includes(f.fieldType) && (
                      <input
                        type="text"
                        value={(f.options || []).join(', ')}
                        onChange={(e) => upField(i, k, { options: e.target.value.split(',').map((x) => x.trimStart()) })}
                        placeholder="Options, comma separated"
                      />
                    )}
                    {['text', 'textarea'].includes(f.fieldType) && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input type="number" style={{ width: 74 }} placeholder="min len" value={f.validation.minLength || ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, minLength: e.target.value ? Number(e.target.value) : undefined } })} />
                        <input type="number" style={{ width: 74 }} placeholder="max len" value={f.validation.maxLength || ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, maxLength: e.target.value ? Number(e.target.value) : undefined } })} />
                      </div>
                    )}
                    {f.fieldType === 'number' && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input type="number" style={{ width: 74 }} placeholder="min" value={f.validation.min ?? ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, min: e.target.value } })} />
                        <input type="number" style={{ width: 74 }} placeholder="max" value={f.validation.max ?? ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, max: e.target.value } })} />
                      </div>
                    )}
                    {f.fieldType === 'file' && <span className="muted" style={{ fontSize: 11.5 }}>JPG / PNG / PDF · max 5 MB</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn small ghost" title="Duplicate field"
                      onClick={() => upSection(i, { fields: [...sec.fields.slice(0, k + 1), JSON.parse(JSON.stringify(f)), ...sec.fields.slice(k + 1)] })}>⧉</button>
                    <button className="btn small danger" title="Delete field" onClick={() => upSection(i, { fields: sec.fields.filter((_, l) => l !== k) })}>✕</button>
                  </div>
                </div>
              ))}

              <div
                className={`tb-drop-end ${isOver('field-end', i) ? 'drop-target' : ''}`}
                onDragOver={onFieldEndOver(i)}
                onDrop={dropFieldEnd(i)}
              >
                <button className="btn small ghost" onClick={() => upSection(i, { fields: [...sec.fields, emptyField()] })}>+ Add field</button>
                <span className="muted" style={{ marginLeft: 10, fontSize: 11.5 }}>…or drop a field here to move it to the end of this section</span>
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <button className="btn ghost" onClick={() => setSections((s) => [...s, emptySection()])}>+ Add section</button>
        <button className="btn green" onClick={save}>Save Template</button>
      </div>
    </div>
  );
}
