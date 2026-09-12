import React, { useEffect, useState } from 'react';
import { adminApi, errMsg, hasPerm, blobUrl } from '../lib/api.js';
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
  ['{{portal_url}}', 'Link to the parent Track page'],
];

export default function MailTemplates() {
  const [list, setList] = useState([]);
  const [statusNames, setStatusNames] = useState([]);
  const [cur, setCur] = useState(0);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = hasPerm('settings');

  const load = () => adminApi.get('/mail-templates').then((r) => { setList(r.data); setCur((c) => Math.min(c, Math.max(0, r.data.length - 1))); });
  useEffect(() => {
    load().catch((e) => setMsg({ type: 'err', text: errMsg(e) }));
    // every status name used by any form, for the "applies to statuses" picker
    adminApi.get('/activations').then((r) => setStatusNames([...new Set(r.data.flatMap((a) => (a.statuses || []).map((st) => st.name)))].sort())).catch(() => {});
  }, []);
  const [fileLabel, setFileLabel] = useState('');
  const uploadFile = async (file) => {
    if (!file || !t) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('label', fileLabel || '');
      const { data } = await adminApi.post(`/mail-templates/${t.id}/file`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setList((l) => l.map((x, i) => (i === cur ? { ...x, fileName: data.fileName, fileLabel: data.fileLabel } : x)));
      setMsg({ type: 'ok', text: `Attached "${data.fileName}" — parents with this status will see a "${data.fileLabel}" download next to the notice.` });
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
    setBusy(false);
  };
  const removeFile = async () => {
    if (!t?.fileName || !window.confirm(`Remove "${t.fileName}" from this template?`)) return;
    try { await adminApi.delete(`/mail-templates/${t.id}/file`); setList((l) => l.map((x, i) => (i === cur ? { ...x, fileName: '', fileLabel: '' } : x))); }
    catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };
  const toggleStatus = (name) => {
    const cur = t?.statuses || [];
    patch({ statuses: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] });
  };

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
    setList((l) => [...l, { id, name: 'New template', title: 'Notice', statuses: [], portal: false, tone: 'info', portalHeading: '', portalMessage: '', subject: 'Regarding your application — Form No {{form_no}}', html: '<p><b>Dear Parent,</b></p><p><b>FORM NO: {{form_no}}</b></p><p>…</p><p>Best Regards,<br>(Nirmala Convent School)</p>' }]);
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
          <div className="muted">Letters for applicants — emailed from Submissions, downloaded as per-student Notice PDFs, and (if published) shown to parents on the Track page.</div>
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
            <div className="grid cols-2">
              <label className="fld">Notice PDF heading
                <input type="text" value={t.title || ''} onChange={(e) => patch({ title: e.target.value })} disabled={!canEdit} placeholder="e.g. Provisional Admission Notice" />
              </label>
              <label className="fld" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22 }}>
                <input type="checkbox" checked={!!t.portal} onChange={(e) => patch({ portal: e.target.checked })} disabled={!canEdit} />
                Show on parent Track page as a downloadable Notice (PDF) when their status matches
              </label>
            </div>
            <div className="card" style={{ background: '#f8fafc', marginTop: 4 }}>
              <b>Parent Track page popup</b> <span className="muted">— shown when "Show on parent Track page" is on and the status matches. Placeholders work here too.</span>
              <div className="grid cols-3" style={{ marginTop: 8 }}>
                <label className="fld">Popup heading
                  <input type="text" value={t.portalHeading || ''} onChange={(e) => patch({ portalHeading: e.target.value })} disabled={!canEdit} placeholder="🎉 Congratulations!" />
                </label>
                <label className="fld">Tone (colour)
                  <select value={t.tone || 'info'} onChange={(e) => patch({ tone: e.target.value })} disabled={!canEdit}>
                    <option value="success">Success — green (selected)</option>
                    <option value="regret">Regret — grey/red (not selected)</option>
                    <option value="info">Neutral — blue</option>
                  </select>
                </label>
              </div>
              <label className="fld">Popup message
                <textarea rows={3} value={t.portalMessage || ''} onChange={(e) => patch({ portalMessage: e.target.value })} disabled={!canEdit} placeholder="Your child has been selected … Click below to download the notice." />
              </label>
            </div>
            <div className="card" style={{ background: '#f8fafc' }}>
              <b>📎 Extra PDF given with this notice</b> <span className="muted">— e.g. the fee structure. Shown as a second download on the parent's Track page and included in the Notices ZIP. (Emails cannot carry attachments; the email links parents to the portal instead.)</span>
              <div className="toolbar" style={{ marginTop: 8, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {t.fileName
                  ? <>
                      <span className="pill on">{t.fileLabel || t.fileName}</span>
                      <button className="btn small ghost" onClick={async () => { try { window.open(await blobUrl(`/api/admin/mail-templates/${t.id}/file`), '_blank'); } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); } }}>View</button>
                      {canEdit && <button className="btn small danger" onClick={removeFile}>Remove</button>}
                      {canEdit && <span className="muted">Replace: choose another file below.</span>}
                    </>
                  : <span className="muted">No file attached.</span>}
              </div>
              {canEdit && (
                <div className="toolbar" style={{ marginTop: 6, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label className="fld" style={{ marginBottom: 0 }}>Button label for parents
                    <input type="text" value={fileLabel} onChange={(e) => setFileLabel(e.target.value)} placeholder="Fee Structure" style={{ width: 200 }} />
                  </label>
                  <label className="fld" style={{ marginBottom: 0 }}>PDF file (max 5 MB)
                    <input type="file" accept="application/pdf" disabled={busy} onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                </div>
              )}
            </div>
            <div className="fld">
              <span>Applies to statuses — used for "Notices PDF (by status)" and the parent Track page</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {[...new Set([...statusNames, ...(t.statuses || [])])].map((name) => (
                  <label key={name} className={`pill ${(t.statuses || []).includes(name) ? 'on' : ''}`} style={{ cursor: canEdit ? 'pointer' : 'default', padding: '5px 10px' }}>
                    <input type="checkbox" style={{ marginRight: 6 }} checked={(t.statuses || []).includes(name)} onChange={() => toggleStatus(name)} disabled={!canEdit} />{name}
                  </label>
                ))}
                {!statusNames.length && <span className="muted">No statuses found — define statuses under Active Forms first.</span>}
              </div>
            </div>
            <label className="fld">Email body / notice text
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
