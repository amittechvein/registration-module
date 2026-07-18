import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';
import RichTextEditor from '../components/RichTextEditor.jsx';

const defaultStatuses = [
  { name: 'Submitted', color: '#2563eb', isFirst: true, isAllotted: false, sendNotification: true, notifySms: true, notifyEmail: true, notifyWhatsapp: false, messageTemplate: 'Dear {{name}}, your form {{form_no}} for {{class}} has been submitted successfully.' },
  { name: 'Under Review', color: '#d97706', isFirst: false, isAllotted: false, sendNotification: false, notifySms: false, notifyEmail: false, notifyWhatsapp: false, messageTemplate: '' },
  { name: 'Shortlisted', color: '#7c3aed', isFirst: false, isAllotted: false, sendNotification: true, notifySms: true, notifyEmail: true, notifyWhatsapp: false, messageTemplate: 'Dear {{name}}, form {{form_no}}: you are shortlisted for {{class}}.' },
  { name: 'Allotted', color: '#16a34a', isFirst: false, isAllotted: true, sendNotification: true, notifySms: true, notifyEmail: true, notifyWhatsapp: false, messageTemplate: 'Congratulations {{name}}! Form {{form_no}}: seat allotted in {{class}}. Details will follow.' },
  { name: 'Rejected', color: '#dc2626', isFirst: false, isAllotted: false, sendNotification: false, notifySms: false, notifyEmail: false, notifyWhatsapp: false, messageTemplate: '' },
];

export default function ActivationForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState({ sessions: [], classes: [], templates: [] });
  const [form, setForm] = useState({
    title: '', templateId: '', sessionId: '', classId: '', price: 0,
    onlinePaymentEnabled: true, dobValidationEnabled: false, dobMin: '', dobMax: '',
    formNoPrefix: 'REG-', formNoSuffix: '', formNoPad: 4,
    instructionsHtml: '', startDate: '', endDate: '', active: false,
  });
  const [statuses, setStatuses] = useState(defaultStatuses);
  const [slug, setSlug] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    adminApi.get('/meta').then((r) => setMeta(r.data));
    if (id) {
      adminApi.get(`/activations/${id}`).then((r) => {
        const a = r.data;
        setForm({
          title: a.title, templateId: a.templateId, sessionId: a.sessionId, classId: a.classId,
          price: Number(a.price), onlinePaymentEnabled: a.onlinePaymentEnabled,
          dobValidationEnabled: a.dobValidationEnabled, dobMin: a.dobMin || '', dobMax: a.dobMax || '',
          formNoPrefix: a.formNoPrefix || '', formNoSuffix: a.formNoSuffix || '', formNoPad: a.formNoPad || 4,
          instructionsHtml: a.instructionsHtml || '', startDate: a.startDate || '', endDate: a.endDate || '',
          active: a.active,
        });
        setSlug(a.slug);
        setStatuses(a.statuses.sort((x, y) => x.sortOrder - y.sortOrder));
      }).catch((e) => setErr(errMsg(e)));
    }
  }, [id]);

  const up = (patch) => setForm((f) => ({ ...f, ...patch }));
  const upStatus = (i, patch) =>
    setStatuses((s) => s.map((st, j) => {
      if (j !== i) return st;
      const next = { ...st, ...patch };
      return next;
    }).map((st, j) => (patch.isFirst && j !== i ? { ...st, isFirst: false } : st)));

  const save = async () => {
    setErr(''); setOk('');
    try {
      const payload = { ...form, id: id || undefined, statuses };
      ['dobMin', 'dobMax', 'startDate', 'endDate'].forEach((k) => { if (!payload[k]) payload[k] = null; });
      const { data } = await adminApi.post('/activations', payload);
      setOk('Saved. Public URL: /form/' + data.slug);
      setSlug(data.slug);
      if (!id) navigate(`/admin/activations/${data.id}`);
    } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>{id ? 'Edit Active Form' : 'Activate Form for Class'}</h1>
          {slug && <div className="muted">Public URL: <code className="url">{window.location.origin}/form/{slug}</code></div>}
        </div>
        <div>
          <button className="btn ghost" onClick={() => navigate('/admin/activations')}>Back</button>{' '}
          <button className="btn green" onClick={save}>Save</button>
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}
      {ok && <div className="alert ok">{ok}</div>}

      <div className="card">
        <h3>Form Setup</h3>
        <div className="grid cols-2">
          <label className="fld">Title <span className="req">*</span>
            <input type="text" value={form.title} onChange={(e) => up({ title: e.target.value })} placeholder="e.g. Class 1 Registration 2026-27" />
          </label>
          <label className="fld">Academic session <span className="req">*</span>
            <select value={form.sessionId} onChange={(e) => up({ sessionId: e.target.value })}>
              <option value="">Select session</option>
              {meta.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="fld">Class <span className="req">*</span>
            <select value={form.classId} onChange={(e) => up({ classId: e.target.value })}>
              <option value="">Select class</option>
              {meta.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="fld">Form template <span className="req">*</span>
            <select value={form.templateId} onChange={(e) => up({ templateId: e.target.value })}>
              <option value="">Select template</option>
              {meta.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Fees & Payment</h3>
        <div className="grid cols-3">
          <label className="fld">Form price (₹)
            <input type="number" value={form.price} onChange={(e) => up({ price: Number(e.target.value) })} min="0" />
          </label>
          <label className="check" style={{ marginTop: 26 }}>
            <input type="checkbox" checked={form.onlinePaymentEnabled} onChange={(e) => up({ onlinePaymentEnabled: e.target.checked })} />
            Enable online payment (Razorpay)
          </label>
        </div>
        <div className="muted">Price 0 = free form. With online payment off, submissions are accepted with payment marked "pending" (collect offline).</div>
      </div>

      <div className="card">
        <h3>Validations & Window</h3>
        <label className="check">
          <input type="checkbox" checked={form.dobValidationEnabled} onChange={(e) => up({ dobValidationEnabled: e.target.checked })} />
          Enable Date-of-Birth validation (applies to the field linked to "Date of Birth")
        </label>
        {form.dobValidationEnabled && (
          <div className="grid cols-2" style={{ marginTop: 8 }}>
            <label className="fld">DOB from (earliest allowed)
              <input type="date" value={form.dobMin} onChange={(e) => up({ dobMin: e.target.value })} />
            </label>
            <label className="fld">DOB to (latest allowed)
              <input type="date" value={form.dobMax} onChange={(e) => up({ dobMax: e.target.value })} />
            </label>
          </div>
        )}
        <div className="grid cols-2" style={{ marginTop: 8 }}>
          <label className="fld">Form open from
            <input type="date" value={form.startDate} onChange={(e) => up({ startDate: e.target.value })} />
          </label>
          <label className="fld">Form open until
            <input type="date" value={form.endDate} onChange={(e) => up({ endDate: e.target.value })} />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Form Number</h3>
        <div className="grid cols-3">
          <label className="fld">Prefix
            <input type="text" value={form.formNoPrefix} onChange={(e) => up({ formNoPrefix: e.target.value })} placeholder="e.g. REG-" />
          </label>
          <label className="fld">Digits (zero padded)
            <input type="number" value={form.formNoPad} min="1" max="8" onChange={(e) => up({ formNoPad: Number(e.target.value) })} />
          </label>
          <label className="fld">Suffix
            <input type="text" value={form.formNoSuffix} onChange={(e) => up({ formNoSuffix: e.target.value })} placeholder="e.g. /26" />
          </label>
        </div>
        <div className="muted">Example: {form.formNoPrefix}{String(1).padStart(form.formNoPad || 4, '0')}{form.formNoSuffix}</div>
      </div>

      <div className="card">
        <h3>Form Instructions</h3>
        <div className="muted" style={{ marginBottom: 6 }}>Shown to applicants before they fill the form (rich text)</div>
        <RichTextEditor value={form.instructionsHtml} onChange={(html) => up({ instructionsHtml: html })} placeholder="Instructions for applicants…" />
      </div>

      <div className="card">
        <h3>Statuses</h3>
        <div className="muted" style={{ marginBottom: 10 }}>
          Define the workflow. Exactly one <b>First Status</b> (assigned on submission). The predefined <b>Allotted</b> status inserts the applicant into the Students DB using linked fields. Notifications fire on every change to a status with "Notify" enabled — template variables: {'{{name}} {{form_no}} {{status}} {{class}} {{form}}'}
        </div>
        <table className="tbl">
          <thead>
            <tr><th>Status name</th><th>Color</th><th>First</th><th>Allotted</th><th>Notify</th><th>SMS</th><th>Email</th><th>WhatsApp</th><th>Message template</th><th></th></tr>
          </thead>
          <tbody>
            {statuses.map((s, i) => (
              <tr key={i}>
                <td><input type="text" value={s.name} onChange={(e) => upStatus(i, { name: e.target.value })} style={{ minWidth: 110 }} /></td>
                <td><input type="color" value={s.color} onChange={(e) => upStatus(i, { color: e.target.value })} /></td>
                <td><input type="radio" name="firstStatus" checked={!!s.isFirst} onChange={() => upStatus(i, { isFirst: true })} /></td>
                <td><input type="checkbox" checked={!!s.isAllotted} onChange={(e) => upStatus(i, { isAllotted: e.target.checked })} /></td>
                <td><input type="checkbox" checked={!!s.sendNotification} onChange={(e) => upStatus(i, { sendNotification: e.target.checked })} /></td>
                <td><input type="checkbox" checked={!!s.notifySms} onChange={(e) => upStatus(i, { notifySms: e.target.checked })} disabled={!s.sendNotification} /></td>
                <td><input type="checkbox" checked={!!s.notifyEmail} onChange={(e) => upStatus(i, { notifyEmail: e.target.checked })} disabled={!s.sendNotification} /></td>
                <td><input type="checkbox" checked={!!s.notifyWhatsapp} onChange={(e) => upStatus(i, { notifyWhatsapp: e.target.checked })} disabled={!s.sendNotification} /></td>
                <td><input type="text" value={s.messageTemplate || ''} onChange={(e) => upStatus(i, { messageTemplate: e.target.value })} style={{ minWidth: 220 }} placeholder="Dear {{name}}, form {{form_no}}…" /></td>
                <td><button className="btn small danger" onClick={() => setStatuses((x) => x.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn small ghost" style={{ marginTop: 8 }}
          onClick={() => setStatuses((s) => [...s, { name: '', color: '#2563eb', isFirst: false, isAllotted: false, sendNotification: false, notifySms: false, notifyEmail: false, notifyWhatsapp: false, messageTemplate: '' }])}>
          + Add status
        </button>
      </div>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label className="check">
          <input type="checkbox" checked={form.active} onChange={(e) => up({ active: e.target.checked })} />
          <b>Form is active</b> (visible & accepting submissions on the public URL)
        </label>
        <button className="btn green" onClick={save}>Save</button>
      </div>
    </div>
  );
}
