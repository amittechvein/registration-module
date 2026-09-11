import React, { useEffect, useState } from 'react';
import { adminApi, errMsg, hasPerm } from '../lib/api.js';
import RichTextEditor from '../components/RichTextEditor.jsx';

const PLACEHOLDERS = [
  ['{{form_no}}', 'Form number, e.g. NUR-27-28/0292'],
  ['{{name}}', "Parent / applicant's name"],
  ['{{student_name}}', "Student's name (from the form)"],
  ['{{class}}', 'Class, e.g. Nursery'],
  ['{{session}}', 'Academic session, e.g. 2027-28'],
  ['{{form}}', 'Form title'],
  ['{{phone}}', 'Registered mobile'],
  ['{{school}}', 'School name'],
];

export default function MailTemplates() {
  const [list, setList] = useState([]);
  const [cur, setCur] = useState(0);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = hasPerm('settings');

  const load = () => adminApi.get('/mail-templates').then((r) => { setList(r.data); setCur((c) => Math.min(c, Math.max(0, r.data.length - 1))); });
  useEffect(() => { load().catch((e) => setMsg({ type: 'err', text: errMsg(e) })); }, []);

  const t = list[cur];
  const patch = (chg) => setList((l) => l.map((x, i) => (i === cur ? { ...x, ...chg } : x)));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data } = await adminApi.put('/mail-templates', { templates: list });
      setList(data);
      setMsg({ type: 'ok', text: 'Templates saved. Use them from Submissions → tick applicants → "Send Email".' });
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
    setBusy(false);
  };
  const add = () => {
    const id = `tpl-${Date.now().toString(36)}`;
    setList((l) => [...l, { id, name: 'New template', subject: 'Regarding your application — Form No {{form_no}}', html: '<p><b>Dear Parent,</b></p><p><b>FORM NO: {{form_no}}</b></p><p>…</p><p>Best Regards,<br>(Nirmala Convent School)</p>' }]);
    setCur(list.length);
  };
  const remove = () => {
    if (!t || !window.confirm(`Delete template "${t.name}"? (takes effect when you click Save)`)) return;
    setList((l) => l.filter((_, i) => i !== cur)); setCur(0);
  };
  const reset = async () => {
    if (!window.confirm('Replace ALL templates with the two built-in letters (Selected / Not selected)? Your edits will be lost.')) return;
    try { const { data } = await adminApi.post('/mail-templates/reset'); setList(data); setCur(0); setMsg({ type: 'ok', text: 'Templates reset to defaults.' }); }
    catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Email Templates</h1>
          <div className="muted">Letters sent to selected applicants from Submissions — e.g. provisional admission, not selected.</div>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={reset}>Reset to defaults</button>
            <button className="btn ghost" onClick={add}>+ New template</button>
            <button className="btn green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save All'}</button>
          </div>
        )}
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      {!canEdit && <div className="alert err">You can view templates but only users with the Settings permission can edit them.</div>}

      <div className="grid" style={{ gridTemplateColumns: '260px 1fr', gap: 12, alignItems: 'start' }}>
        <div className="card" style={{ padding: 8 }}>
          {list.map((x, i) => (
            <div key={x.id} onClick={() => setCur(i)} style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', background: i === cur ? '#e8f0fe' : 'transparent', fontWeight: i === cur ? 600 : 400 }}>
              ✉️ {x.name}
            </div>
          ))}
          {!list.length && <div className="muted" style={{ padding: 10 }}>No templates yet.</div>}
          <div className="muted" style={{ padding: '10px 10px 4px', fontSize: 11.5, borderTop: '1px solid var(--line)', marginTop: 6 }}>
            <b>Placeholders</b> — replaced per applicant:
            {PLACEHOLDERS.map(([k, d]) => <div key={k}><code>{k}</code> {d}</div>)}
          </div>
        </div>

        {t && (
          <div className="card">
            <div className="grid cols-2">
              <label className="fld">Template name (staff only)
                <input type="text" value={t.name} onChange={(e) => patch({ name: e.target.value })} disabled={!canEdit} />
              </label>
              <label className="fld">Email subject
                <input type="text" value={t.subject} onChange={(e) => patch({ subject: e.target.value })} disabled={!canEdit} />
              </label>
            </div>
            <label className="fld">Email body
              {canEdit
                ? <RichTextEditor value={t.html} onChange={(html) => patch({ html })} placeholder="Dear Parent, …" />
                : <div className="rte-body" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }} dangerouslySetInnerHTML={{ __html: t.html }} />}
            </label>
            <div className="muted" style={{ fontSize: 12 }}>
              Tip: select text and use <b>B</b> for bold, <b>Link</b> for the payment URL. Highlight/red colour from the original letters is kept when you edit around it.
              Applicants without an email address are skipped automatically and listed before you send.
            </div>
            {canEdit && (
              <div className="toolbar" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                <button className="btn small danger" onClick={remove}>Delete this template</button>
                <button className="btn green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save All'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
