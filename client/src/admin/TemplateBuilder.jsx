import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'email', 'phone', 'select', 'radio', 'checkbox'];

const emptyField = () => ({ label: '', fieldType: 'text', options: [], required: false, studentField: '', validation: {} });
const emptySection = (title = '') => ({ title, fields: [emptyField()] });

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
  const move = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };

  const save = async () => {
    setErr(''); setOk('');
    try {
      const { data } = await adminApi.post('/templates', { id: id || undefined, name, description, active, sections });
      setOk('Template saved');
      if (!id) navigate(`/admin/templates/${data.id}`);
    } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>{id ? 'Edit Template' : 'New Form Template'}</h1>
          <div className="muted">Add sections (e.g. Personal Details), then fields. Link fields to the student profile so an allotted applicant's data is inserted into the Students DB automatically.</div>
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
        <div className="card" key={i}>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <label className="fld" style={{ flex: 1, marginBottom: 0 }}>Section name
              <input type="text" value={sec.title} onChange={(e) => upSection(i, { title: e.target.value })} placeholder="e.g. Personal Details" />
            </label>
            <button className="btn small ghost" disabled={i === 0} onClick={() => setSections((s) => move(s, i, i - 1))}>↑</button>
            <button className="btn small ghost" disabled={i === sections.length - 1} onClick={() => setSections((s) => move(s, i, i + 1))}>↓</button>
            <button className="btn small danger" onClick={() => setSections((s) => s.filter((_, j) => j !== i))}>Remove section</button>
          </div>

          <div className="field-row" style={{ background: 'transparent', border: 'none', paddingTop: 0, paddingBottom: 0 }}>
            <div className="drag-note">Field label</div><div className="drag-note">Type</div><div className="drag-note">Link to student profile</div>
            <div className="drag-note">Required</div><div className="drag-note">Options / validation</div><div className="drag-note"></div>
          </div>

          {sec.fields.map((f, k) => (
            <div className="field-row" key={k}>
              <input type="text" value={f.label} onChange={(e) => upField(i, k, { label: e.target.value })} placeholder="e.g. Student Name" />
              <select value={f.fieldType} onChange={(e) => upField(i, k, { fieldType: e.target.value })}>
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={f.studentField} onChange={(e) => upField(i, k, { studentField: e.target.value })}>
                <option value="">— not linked —</option>
                {studentFields.map((sf) => <option key={sf.key} value={sf.key}>{sf.label}</option>)}
              </select>
              <label className="check" style={{ margin: 0 }}>
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
                    <input type="number" style={{ width: 80 }} placeholder="min len" value={f.validation.minLength || ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, minLength: e.target.value ? Number(e.target.value) : undefined } })} />
                    <input type="number" style={{ width: 80 }} placeholder="max len" value={f.validation.maxLength || ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, maxLength: e.target.value ? Number(e.target.value) : undefined } })} />
                  </div>
                )}
                {f.fieldType === 'number' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="number" style={{ width: 80 }} placeholder="min" value={f.validation.min ?? ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, min: e.target.value } })} />
                    <input type="number" style={{ width: 80 }} placeholder="max" value={f.validation.max ?? ''} onChange={(e) => upField(i, k, { validation: { ...f.validation, max: e.target.value } })} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn small ghost" disabled={k === 0} onClick={() => upSection(i, { fields: move(sec.fields, k, k - 1) })}>↑</button>
                <button className="btn small ghost" disabled={k === sec.fields.length - 1} onClick={() => upSection(i, { fields: move(sec.fields, k, k + 1) })}>↓</button>
                <button className="btn small danger" onClick={() => upSection(i, { fields: sec.fields.filter((_, l) => l !== k) })}>✕</button>
              </div>
            </div>
          ))}
          <button className="btn small ghost" onClick={() => upSection(i, { fields: [...sec.fields, emptyField()] })}>+ Add field</button>
        </div>
      ))}

      <button className="btn ghost" onClick={() => setSections((s) => [...s, emptySection()])}>+ Add section</button>{' '}
      <button className="btn green" onClick={save}>Save Template</button>
    </div>
  );
}
