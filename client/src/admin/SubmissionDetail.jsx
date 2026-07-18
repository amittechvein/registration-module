import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminApi, errMsg, downloadBlob } from '../lib/api.js';

export default function SubmissionDetail() {
  const { id } = useParams();
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [channel, setChannel] = useState('portal');

  const load = () => adminApi.get(`/submissions/${id}`).then((r) => setS(r.data)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  if (!s) return <div>{err ? <div className="alert err">{err}</div> : 'Loading…'}</div>;

  const data = JSON.parse(s.data || '{}');
  const sections = s.activation?.template?.sections || [];

  const updateStatus = async () => {
    if (!newStatus) return;
    try {
      await adminApi.post(`/submissions/${id}/status`, { statusId: newStatus, note });
      setNote(''); setNewStatus(''); load();
    } catch (e) { setErr(errMsg(e)); }
  };

  const sendMsg = async () => {
    if (!msg.trim()) return;
    try {
      await adminApi.post(`/submissions/${id}/communications`, { message: msg, channel });
      setMsg(''); load();
    } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Form {s.formNo || '(draft)'}</h1>
          <div className="muted">{s.activation?.title} · {s.activation?.session?.name} · {s.activation?.classRoom?.name}</div>
        </div>
        <div>
          <Link className="btn ghost" to="/admin/submissions">Back</Link>{' '}
          <button className="btn ghost" onClick={() => downloadBlob(`/api/admin/submissions/${id}/pdf`, `form-${s.formNo || id}.pdf`)}>⬇ PDF</button>
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="grid cols-3">
        <div className="stat"><div className="lbl">Status</div><div className="num">{s.status ? <span className="badge" style={{ background: s.status.color, fontSize: 15 }}>{s.status.name}</span> : (s.isDraft ? 'Draft' : '—')}</div></div>
        <div className="stat"><div className="lbl">Payment</div><div className="num" style={{ fontSize: 18 }}>{s.paymentStatus} {Number(s.amount) > 0 ? `· ₹${Number(s.amount).toFixed(0)}` : ''}</div></div>
        <div className="stat"><div className="lbl">Applicant</div><div className="num" style={{ fontSize: 18 }}>{s.applicant?.name || '—'}</div><div className="muted">{s.applicant?.phone} {s.applicant?.email ? '· ' + s.applicant.email : ''}</div></div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div>
          <div className="card">
            <h3>Form Data</h3>
            {sections.map((sec) => (
              <div key={sec.id}>
                <div className="section-title">{sec.title}</div>
                <table className="tbl">
                  <tbody>
                    {sec.fields.map((fld) => {
                      const v = data[fld.id];
                      return (
                        <tr key={fld.id}>
                          <td style={{ width: '45%' }} className="muted">{fld.label}{fld.studentField ? ' 🔗' : ''}</td>
                          <td>
                            {v && typeof v === 'object' && !Array.isArray(v) && v.attachmentId ? (
                              <button className="btn small ghost" onClick={() => downloadBlob(`/api/admin/attachments/${v.attachmentId}`, v.filename || 'document')}>
                                📎 {v.filename || 'Download file'}
                              </button>
                            ) : (
                              <b>{Array.isArray(v) ? v.join(', ') : (v ?? '—')}</b>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Status History</h3>
            <table className="tbl">
              <thead><tr><th>When</th><th>From</th><th>To</th><th>By</th><th>Note</th></tr></thead>
              <tbody>
                {(s.statusLogs || []).map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                    <td>{l.fromStatus || '—'}</td><td><b>{l.toStatus}</b></td><td>{l.changedBy}</td><td>{l.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Update Status</h3>
            <label className="fld">New status
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                <option value="">Select status…</option>
                {(s.activation?.statuses || []).map((st) => (
                  <option key={st.id} value={st.id}>{st.name}{st.isAllotted ? ' (inserts into Students DB)' : ''}</option>
                ))}
              </select>
            </label>
            <label className="fld">Note (optional)
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note for the log" />
            </label>
            <button className="btn" onClick={updateStatus} disabled={!newStatus || s.isDraft}>Update Status</button>
            {s.isDraft && <div className="muted" style={{ marginTop: 6 }}>Draft forms can't have a status until submitted.</div>}
          </div>

          <div className="card">
            <h3>Communication with Applicant</h3>
            <div className="thread">
              {(s.communications || []).map((c) => (
                <div key={c.id} className={`msg ${c.sender}`}>
                  {c.message}
                  <div className="meta">{c.sender} · {c.channel} · {new Date(c.createdAt).toLocaleString('en-IN')}</div>
                </div>
              ))}
              {!(s.communications || []).length && <div className="muted">No messages yet.</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 110 }}>
                <option value="portal">Portal</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </select>
              <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message to applicant…" onKeyDown={(e) => e.key === 'Enter' && sendMsg()} />
              <button className="btn" onClick={sendMsg}>Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
