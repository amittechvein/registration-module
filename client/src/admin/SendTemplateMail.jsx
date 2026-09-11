import React, { useEffect, useState } from 'react';
import { adminApi, errMsg, downloadBlob, hasPerm } from '../lib/api.js';

/**
 * "Send Email" panel for the Submissions page. Flow — deliberately slow:
 *   1. choose a template  →  2. server renders the EXACT email for every ticked
 *   applicant (nothing sent)  →  3. staff reads the recipient list + preview,
 *   ticks "I have verified"  →  4. Send, only to those ids.
 */
export default function SendTemplateMail({ ids, onClose, onSent }) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState(null);
  const [show, setShow] = useState(null);         // recipient id whose email is shown in full
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    adminApi.get('/mail-templates').then((r) => { setTemplates(r.data); if (r.data[0]) setTemplateId(r.data[0].id); }).catch((e) => setErr(errMsg(e)));
  }, []);

  useEffect(() => {
    setPreview(null); setVerified(false); setResult(null); setShow(null);
    if (!templateId || !ids.length) return;
    setBusy(true); setErr('');
    adminApi.post('/submissions/mail-preview', { ids, templateId })
      .then((r) => { setPreview(r.data); setShow(r.data.recipients.find((x) => x.canSend)?.id ?? null); })
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setBusy(false));
  }, [templateId, ids.join(',')]); // eslint-disable-line

  const send = async () => {
    if (!verified || !preview) return;
    const n = preview.sendable;
    if (!window.confirm(`Send "${preview.template.name}" to ${n} applicant(s) now? This cannot be undone.`)) return;
    setBusy(true); setErr('');
    try {
      const { data } = await adminApi.post('/submissions/mail-send', { ids, templateId, confirmed: true });
      setResult(data);
      onSent && onSent(data);
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const shown = preview?.recipients.find((r) => r.id === show);
  const problems = preview ? preview.recipients.filter((r) => !r.canSend) : [];
  const unresolved = preview ? [...new Set(preview.recipients.flatMap((r) => r.unresolved))] : [];

  return (
    <div className="card" style={{ borderLeft: '4px solid #1a73e8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b>📧 Send email to the {ids.length} selected applicant(s) — only they will receive it</b>
        <button className="btn small ghost" onClick={onClose}>✕ Close</button>
      </div>

      {result ? (
        <div style={{ marginTop: 10 }}>
          <div className={`alert ${result.sent === result.total ? 'ok' : 'err'}`}>
            ✅ Sent {result.sent} of {result.total}. {result.total - result.sent > 0 && `${result.total - result.sent} not sent — see below.`}
          </div>
          <table className="tbl">
            <thead><tr><th>Form No</th><th>Email</th><th>Result</th></tr></thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.id}>
                  <td>{r.formNo || '#' + r.id}</td>
                  <td>{r.email || '—'}</td>
                  <td>{r.ok ? <span className="pill on">sent</span> : <span className="pill off">{r.skipped ? `skipped: ${r.skipped}` : `failed: ${r.error}`}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ marginTop: 6 }}>Each email is also recorded in the applicant's message thread and the audit log.</div>
        </div>
      ) : (
        <>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <label className="fld" style={{ marginBottom: 0 }}>Step 1 — Template
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: 360 }}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <span className="muted">Edit templates under <b>Email Templates</b> in the menu.</span>
          </div>
          {err && <div className="alert err" style={{ marginTop: 8 }}>{err}</div>}
          {busy && !preview && <div className="muted" style={{ marginTop: 8 }}>Preparing preview…</div>}

          {preview && (
            <>
              <div className="section-title" style={{ marginTop: 12 }}>Step 2 — Verify recipients ({preview.sendable} will receive it{problems.length ? `, ${problems.length} will be skipped` : ''})</div>
              {unresolved.length > 0 && (
                <div className="alert err">⚠ The template contains unknown placeholder(s): {unresolved.map((u) => `{{${u}}}`).join(', ')} — they would be sent as-is. Fix the template first.</div>
              )}
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                <table className="tbl">
                  <thead><tr><th>Form No</th><th>Student</th><th>Parent</th><th>Email</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {preview.recipients.map((r) => (
                      <tr key={r.id} style={{ background: r.id === show ? '#e8f0fe' : undefined, opacity: r.canSend ? 1 : 0.6 }}>
                        <td><b>{r.formNo || '#' + r.id}</b></td>
                        <td>{r.studentName || '—'}</td>
                        <td>{r.parentName || '—'}<div className="muted">{r.phone}</div></td>
                        <td>{r.email || <i className="muted">none</i>}</td>
                        <td>{r.canSend ? <span className="pill on">will send</span> : <span className="pill off">skip — {r.reason}</span>}</td>
                        <td><button className="btn small ghost" onClick={() => setShow(r.id)}>Preview</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {shown && (
                <>
                  <div className="section-title" style={{ marginTop: 12 }}>Step 3 — Exact email for {shown.formNo || '#' + shown.id} ({shown.email || 'no email'})</div>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', background: '#fff' }}>
                    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6, marginBottom: 10 }}><span className="muted">Subject:</span> <b>{shown.subject}</b></div>
                    <div dangerouslySetInnerHTML={{ __html: shown.html }} />
                  </div>
                </>
              )}

              <div className="toolbar" style={{ marginTop: 14, alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} disabled={!preview.sendable || unresolved.length > 0} />
                  <span>I have verified the template, the form numbers and the recipient list above</span>
                </label>
                <button className="btn green" onClick={send} disabled={!verified || busy || !preview.sendable || unresolved.length > 0}>
                  {busy ? 'Sending…' : `Send to ${preview.sendable} applicant(s)`}
                </button>
                {!preview.sendable && <span className="muted">Nobody in this selection can receive the email (no email addresses).</span>}
                {hasPerm('export') && (
                  <button className="btn ghost" disabled={busy} onClick={() => downloadBlob(`/api/admin/export/notices.zip?ids=${ids.join(',')}&templateId=${encodeURIComponent(templateId)}`, `notices-${templateId}.zip`)} title="One PDF per student using this template, zipped">
                    ⬇ Download as PDF notices (ZIP)
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
