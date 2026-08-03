import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, errMsg, downloadBlob, hasPerm } from '../lib/api.js';

export default function Submissions() {
  const [meta, setMeta] = useState({ sessions: [], classes: [] });
  const [activations, setActivations] = useState([]);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState([]);
  const [sortByScore, setSortByScore] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkMsg, setBulkMsg] = useState('');
  const [bulkCh, setBulkCh] = useState({ sms: false, email: false });
  const [bulkNote, setBulkNote] = useState('');
  const [recon, setRecon] = useState(null);
  const [reconResults, setReconResults] = useState(null);
  const [rowBusy, setRowBusy] = useState(null);        // submission id being checked
  const [chooseFor, setChooseFor] = useState(null);    // { row, attempts } when parent paid twice

  // Per-row reconcile: check ONE submission's payments against Razorpay
  const reconRow = async (r) => {
    setRowBusy(r.id); setChooseFor(null); setReconResults(null);
    try {
      const { data } = await adminApi.post(`/submissions/${r.id}/reconcile`);
      if (data.applied) {
        setReconResults({ checked: 1, fixed: 1, results: [{ ok: true, note: `${data.formNo} · payment found CAPTURED — marked paid & submitted` }] });
        load();
      } else if (data.capturedCount > 1) {
        setChooseFor({ row: r, attempts: data.attempts });
      } else {
        const last = data.attempts?.length ? data.attempts.map((a) => `${a.paymentId} → ${a.status}`).join(' · ') : 'no payment attempt';
        setReconResults({ checked: 1, fixed: 0, results: [{ ok: false, note: `${r.formNo || 'DRAFT #' + r.id} → ${data.alreadyPaid ? 'already paid' : 'Razorpay says: ' + last}` }] });
      }
    } catch (e) { setReconResults({ error: errMsg(e) }); }
    setRowBusy(null);
  };

  const applyChosen = async (paymentId) => {
    try {
      const { data } = await adminApi.post(`/submissions/${chooseFor.row.id}/apply-payment`, { paymentId });
      setReconResults({ checked: 1, fixed: 1, results: [{ ok: true, note: `${data.formNo} · payment ${paymentId} attached — REFUND the other captured payment(s) from the Razorpay dashboard` }] });
      setChooseFor(null);
      load();
    } catch (e) { setReconResults({ error: errMsg(e) }); }
  };
  const [err, setErr] = useState('');
  const [f, setF] = useState(() => ({
    activationId: new URLSearchParams(window.location.search).get('activationId') || '',
    sessionId: '', classId: '', statusId: '', paymentStatus: '', formNo: '', search: '', from: '', to: '', includeDrafts: 'false',
  }));

  useEffect(() => {
    adminApi.get('/meta').then((r) => setMeta(r.data));
    adminApi.get('/activations').then((r) => setActivations(r.data));
  }, []);

  const qs = useMemo(() => new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v))).toString(), [f]);
  const load = () => adminApi.get(`/submissions?${qs}`).then((r) => { setRows(r.data); setSel([]); }).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, [qs]); // eslint-disable-line

  const chosenActivation = activations.find((a) => String(a.id) === String(f.activationId));
  const statusOptions = chosenActivation ? chosenActivation.statuses : [...new Map(activations.flatMap((a) => a.statuses).map((s) => [s.name, s])).values()];

  const applyBulk = async () => {
    if (!bulkStatus || !sel.length) return;
    try {
      await adminApi.post('/submissions/bulk-status', { ids: sel, statusId: bulkStatus });
      load();
    } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Submitted Forms</h1>
          <div className="muted">{rows.length} result(s)</div>
        </div>
        <div>
          {hasPerm('status') && (
            <button
              className="btn ghost"
              disabled={recon === 'running'}
              title="Ask Razorpay for the real status of every pending payment — forms whose money was actually received are marked paid and submitted automatically"
              onClick={async () => {
                setRecon('running'); setReconResults(null);
                try {
                  const { data } = await adminApi.post('/payments/reconcile');
                  setReconResults(data);
                  setRecon(null);
                  load();
                } catch (e) { setRecon(null); setReconResults({ error: errMsg(e) }); }
              }}
            >
              {recon === 'running' ? '⏳ Checking Razorpay…' : '🔄 Reconcile Payments'}
            </button>
          )}{' '}
          {hasPerm('export') && (
            <>
              <button className="btn ghost" onClick={() => downloadBlob(`/api/admin/export/excel?${qs}`, 'submissions.xlsx')}>⬇ Excel</button>{' '}
              <button className="btn ghost" onClick={() => downloadBlob(`/api/admin/export/pdf?${qs}`, 'all-submissions.pdf')}>⬇ PDF (all)</button>
            </>
          )}
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}
      {chooseFor && (
        <div className="card" style={{ borderLeft: '4px solid #d97706' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>⚠ {chooseFor.row.applicant?.name || 'This parent'} paid MORE THAN ONCE for {chooseFor.row.formNo || 'DRAFT #' + chooseFor.row.id} — choose which payment to attach to the form.</b>
            <button className="btn small ghost" onClick={() => setChooseFor(null)}>✕ Cancel</button>
          </div>
          <div className="muted" style={{ margin: '4px 0 10px' }}>The payment you don't choose must be refunded from the Razorpay dashboard (copy its Payment ID).</div>
          <table className="tbl">
            <thead><tr><th>Payment ID</th><th>Status</th><th>Method</th><th>Amount</th><th>Time</th><th></th></tr></thead>
            <tbody>
              {chooseFor.attempts.map((a) => (
                <tr key={a.paymentId}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{a.paymentId}</td>
                  <td><span className="badge" style={{ background: a.status === 'captured' ? '#16a34a' : '#64748b' }}>{a.status}</span></td>
                  <td>{a.method || '—'}</td>
                  <td>₹{Number(a.amount || 0).toFixed(0)}</td>
                  <td className="muted">{a.at ? new Date(a.at).toLocaleString('en-IN') : '—'}</td>
                  <td>{a.status === 'captured' && <button className="btn small green" onClick={() => applyChosen(a.paymentId)}>✔ Use this payment</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reconResults && (
        <div className={`card`} style={{ borderLeft: `4px solid ${reconResults.error ? '#dc2626' : reconResults.fixed ? '#16a34a' : '#64748b'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>
              {reconResults.error
                ? `Reconciliation failed: ${reconResults.error}`
                : `Payment reconciliation — ${reconResults.checked} pending order(s) checked, ${reconResults.fixed} payment(s) recovered`}
            </b>
            <button className="btn small ghost" onClick={() => setReconResults(null)}>✕ Close</button>
          </div>
          {(reconResults.results || []).map((x, i) => (
            <div key={i} className="muted" style={{ marginTop: 4, color: x.ok ? '#16a34a' : undefined }}>
              {x.ok ? '✅' : '·'} {x.note}
            </div>
          ))}
          {!reconResults.error && !(reconResults.results || []).length && <div className="muted" style={{ marginTop: 6 }}>No pending payment orders found — everything is already in sync.</div>}
        </div>
      )}

      <div className="card">
        <div className="toolbar">
          <label className="fld">Form
            <select value={f.activationId} onChange={(e) => setF({ ...f, activationId: e.target.value, statusId: '' })}>
              <option value="">All forms</option>
              {activations.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </label>
          <label className="fld">Session
            <select value={f.sessionId} onChange={(e) => setF({ ...f, sessionId: e.target.value })}>
              <option value="">All</option>
              {meta.sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="fld">Class
            <select value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}>
              <option value="">All</option>
              {meta.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="fld">Status
            <select value={f.statusId} onChange={(e) => setF({ ...f, statusId: e.target.value })}>
              <option value="">All</option>
              {statusOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="fld">Payment
            <select value={f.paymentStatus} onChange={(e) => setF({ ...f, paymentStatus: e.target.value })}>
              <option value="">All</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="na">N/A (free)</option>
            </select>
          </label>
          <label className="fld">From
            <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </label>
          <label className="fld">To
            <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </label>
          <label className="fld">Form No
            <input type="text" value={f.formNo} onChange={(e) => setF({ ...f, formNo: e.target.value })} placeholder="REG-0001" />
          </label>
          <label className="fld">Search
            <input type="text" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="name / phone / any answer" />
          </label>
          <label className="check" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={f.includeDrafts === 'true'} onChange={(e) => setF({ ...f, includeDrafts: e.target.checked ? 'true' : 'false' })} />
            Include drafts
          </label>
        </div>
      </div>

      {sel.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>{sel.length} selected</b>
            {hasPerm('status') && (
              <>
                <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ width: 220 }}>
                  <option value="">Change status to…</option>
                  {(chosenActivation ? chosenActivation.statuses : []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button className="btn" onClick={applyBulk} disabled={!bulkStatus}>Apply Status</button>
                {!chosenActivation && <span className="muted">Select a specific Form in the filter to enable bulk status change</span>}
              </>
            )}
            {/* Delete button hidden after test-data cleanup (change false → hasPerm('edit') to re-enable) */}
            {false && (
              <button
                className="btn danger"
                style={{ marginLeft: 'auto' }}
                title="Permanently delete the selected submissions (for cleaning up test entries)"
                onClick={async () => {
                  const first = window.confirm(`Delete ${sel.length} submission(s) PERMANENTLY?\n\nThis removes their form data, payments, attachments and messages. This cannot be undone.`);
                  if (!first) return;
                  const second = window.confirm('Are you really sure? Real applicant submissions should never be deleted.');
                  if (!second) return;
                  try {
                    const { data } = await adminApi.post('/submissions/bulk-delete', { ids: sel });
                    setBulkNote(`🗑 Deleted ${data.count} submission(s)`);
                    setSel([]);
                    load();
                  } catch (e) { setBulkNote('❌ ' + errMsg(e)); }
                }}
              >
                🗑 Delete {sel.length}
              </button>
            )}
          </div>
          {hasPerm('communicate') && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <input type="text" value={bulkMsg} onChange={(e) => setBulkMsg(e.target.value)} placeholder="Message to all selected applicants…" style={{ flex: 1, minWidth: 260 }} />
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={bulkCh.sms} onChange={(e) => setBulkCh({ ...bulkCh, sms: e.target.checked })} /> SMS
              </label>
              <label className="check" style={{ margin: 0 }}>
                <input type="checkbox" checked={bulkCh.email} onChange={(e) => setBulkCh({ ...bulkCh, email: e.target.checked })} /> Email
              </label>
              <button
                className="btn green"
                disabled={!bulkMsg.trim()}
                onClick={async () => {
                  setBulkNote('Sending…');
                  try {
                    const channels = ['portal', ...(bulkCh.sms ? ['sms'] : []), ...(bulkCh.email ? ['email'] : [])];
                    const { data } = await adminApi.post('/submissions/bulk-communications', { ids: sel, message: bulkMsg, channels });
                    setBulkNote(`✅ Sent to ${data.count} applicant(s)`);
                    setBulkMsg('');
                  } catch (e) { setBulkNote('❌ ' + errMsg(e)); }
                }}
              >
                Send to {sel.length} applicant(s)
              </button>
              {bulkNote && <span className="muted">{bulkNote}</span>}
              <span className="muted" style={{ width: '100%' }}>Always appears in each applicant's portal thread; tick SMS/Email to also deliver there.</span>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th><input type="checkbox" checked={sel.length === rows.length && rows.length > 0} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /></th>
              <th>Form No</th><th>Student</th><th>Applicant</th><th>Form</th><th>Class</th>
              <th style={{ cursor: 'pointer' }} onClick={() => setSortByScore(!sortByScore)} title="Auto-computed admission priority — click to sort">
                Score {sortByScore ? '▼' : '⇅'}
              </th>
              <th>Status</th><th>Payment</th><th>Submitted</th><th></th>
            </tr>
          </thead>
          <tbody>
            {(sortByScore ? [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)) : rows).map((r) => (
              <tr key={r.id}>
                <td><input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /></td>
                <td><Link to={`/admin/submissions/${r.id}`}><b>{r.formNo || (r.isDraft ? 'DRAFT' : '—')}</b></Link></td>
                <td><b>{r.studentName || '—'}</b></td>
                <td>{r.applicant?.name || '—'}<div className="muted">{r.applicant?.phone}</div></td>
                <td>{r.activation?.title}</td>
                <td>{r.activation?.classRoom?.name}</td>
                <td>
                  {r.score != null ? (
                    <b style={{ color: r.score >= 50 ? '#16a34a' : r.score >= 25 ? '#d97706' : '#64748b' }}>{r.score}</b>
                  ) : <span className="muted">—</span>}
                  {(() => { try { return JSON.parse(r.flags || '[]').length ? <span title="Possible duplicate — open for details"> ⚠️</span> : null; } catch { return null; } })()}
                </td>
                <td>{r.status ? <span className="badge" style={{ background: r.status.color }}>{r.status.name}</span> : <span className="pill">{r.isDraft ? 'Draft' : '—'}</span>}</td>
                <td>{r.paymentStatus === 'paid' ? <span className="pill on">₹{Number(r.amount).toFixed(0)} paid</span> : <span className="pill">{r.paymentStatus}</span>}</td>
                <td className="muted">{r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-IN') : '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {hasPerm('status') && Number(r.amount) > 0 && ['pending', 'failed'].includes(r.paymentStatus) && (
                    <button className="btn small ghost" title="Check this payment with Razorpay" disabled={rowBusy === r.id} onClick={() => reconRow(r)}>
                      {rowBusy === r.id ? '⏳' : '🔄'}
                    </button>
                  )}{' '}
                  {hasPerm('export') && <button className="btn small ghost" onClick={() => downloadBlob(`/api/admin/submissions/${r.id}/pdf`, `form-${r.formNo || r.id}.pdf`)}>PDF</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="muted">No submissions match the filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
