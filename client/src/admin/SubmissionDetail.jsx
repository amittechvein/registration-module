import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminApi, errMsg, downloadBlob, hasPerm } from '../lib/api.js';

/** Inline editor for one field, matching its configured type. */
function EditInput({ fld, value, onChange }) {
  let opts = []; try { opts = JSON.parse(fld.options || '[]').filter(Boolean); } catch {}
  switch (fld.fieldType) {
    case 'textarea':
      return <textarea rows={2} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
    case 'radio':
      return (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'checkbox':
      return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {opts.map((o) => {
            const arr = Array.isArray(value) ? value : [];
            return (
              <label className="check" key={o} style={{ margin: 0 }}>
                <input type="checkbox" checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} /> {o}
              </label>
            );
          })}
        </div>
      );
    case 'date':
      return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))} />;
    default:
      return <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function SubmissionDetail() {
  const { id } = useParams();
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [channel, setChannel] = useState('portal');
  const [showEmpty, setShowEmpty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);

  const load = () => adminApi.get(`/submissions/${id}`).then((r) => setS(r.data)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  if (!s) return <div>{err ? <div className="alert err">{err}</div> : 'Loading…'}</div>;

  const data = JSON.parse(s.data || '{}');
  // Sections & fields in their designed order (sortOrder), same as the form itself
  const sections = [...(s.activation?.template?.sections || [])]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((sec) => ({ ...sec, fields: [...(sec.fields || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)) }));

  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  const isFileVal = (v) => v && typeof v === 'object' && !Array.isArray(v) && v.attachmentId;

  const startEdit = () => { setEditData({ ...data }); setEditing(true); setOk(''); setErr(''); };
  const cancelEdit = () => { setEditing(false); setEditData({}); };
  const saveEdit = async () => {
    setSaving(true); setErr(''); setOk('');
    try {
      const { data: r } = await adminApi.post(`/submissions/${id}/data`, { data: editData });
      setOk(r.changed ? `Saved — ${r.changed} field${r.changed > 1 ? 's' : ''} updated. The change is recorded in the audit log.` : 'No changes to save.');
      setEditing(false);
      load();
    } catch (e) { setErr(errMsg(e)); }
    setSaving(false);
  };

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
          {hasPerm('export') && <button className="btn ghost" onClick={() => downloadBlob(`/api/admin/submissions/${id}/pdf`, `form-${s.formNo || id}.pdf`)}>⬇ PDF</button>}
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}
      {ok && <div className="alert ok">{ok}</div>}

      <div className="grid cols-4">
        <div className="stat"><div className="lbl">Status</div><div className="num">{s.status ? <span className="badge" style={{ background: s.status.color, fontSize: 15 }}>{s.status.name}</span> : (s.isDraft ? 'Draft' : '—')}</div></div>
        <div className="stat"><div className="lbl">Payment</div><div className="num" style={{ fontSize: 18 }}>{s.paymentStatus} {Number(s.amount) > 0 ? `· ₹${Number(s.amount).toFixed(0)}` : ''}</div></div>
        <div className="stat"><div className="lbl">Applicant</div><div className="num" style={{ fontSize: 18 }}>{s.applicant?.name || '—'}</div><div className="muted">{s.applicant?.phone} {s.applicant?.email ? '· ' + s.applicant.email : ''}</div></div>
        <div className="stat">
          <div className="lbl">Auto Score</div>
          <div className="num" style={{ color: (s.score ?? 0) >= 50 ? '#16a34a' : (s.score ?? 0) >= 25 ? '#d97706' : undefined }}>{s.score ?? '—'}<span style={{ fontSize: 14, color: '#64748b' }}>/100</span></div>
          {(() => { try { return JSON.parse(s.scoreDetails || '[]').map((d, i) => <div key={i} className="muted" style={{ fontSize: 11.5 }}>{d}</div>); } catch { return null; } })()}
        </div>
      </div>
      {(() => {
        try {
          const flags = JSON.parse(s.flags || '[]');
          return flags.length ? <div className="alert err" style={{ marginTop: 12 }}><b>⚠️ Auto-detected warnings:</b> {flags.join(' · ')}</div> : null;
        } catch { return null; }
      })()}

      <div className="grid cols-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div>
          <div className="card">
            <div className="kv-toolbar">
              <h3 style={{ margin: 0 }}>Form Data</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!editing && (
                  <label className="check" style={{ margin: 0, fontSize: 12 }}>
                    <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Show empty
                  </label>
                )}
                {hasPerm('edit') && !editing && !s.isDraft && (
                  <button className="btn small ghost" onClick={startEdit}>✏️ Edit</button>
                )}
                {editing && (
                  <>
                    <button className="btn small green" onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : '💾 Save Changes'}</button>
                    <button className="btn small ghost" onClick={cancelEdit} disabled={saving}>Cancel</button>
                  </>
                )}
              </div>
            </div>
            {editing && <div className="alert ok" style={{ marginTop: 8 }}>Editing form data — every change is recorded in the audit log with before/after values. File attachments can't be replaced here.</div>}

            {sections.map((sec) => {
              const flds = editing ? sec.fields : (showEmpty ? sec.fields : sec.fields.filter((f) => !isEmpty(data[f.id])));
              if (!flds.length) return null;
              return (
                <div key={sec.id} className="kv-section">
                  <div className="kv-head">{sec.title}</div>
                  <div className="kv-grid">
                    {flds.map((fld) => {
                      const v = editing ? editData[fld.id] : data[fld.id];
                      const wide = ['textarea', 'checkbox'].includes(fld.fieldType) || (fld.label || '').length > 55;
                      return (
                        <div key={fld.id} className={`kv-item ${wide ? 'wide' : ''}`}>
                          <div className="kv-k">{fld.label}{fld.studentField ? <span title="Linked to student profile"> 🔗</span> : ''}</div>
                          {editing && fld.fieldType !== 'file' ? (
                            <EditInput fld={fld} value={v} onChange={(nv) => setEditData((d) => ({ ...d, [fld.id]: nv }))} />
                          ) : isFileVal(editing ? data[fld.id] : v) ? (
                            <button className="btn small ghost" onClick={() => { const fv = editing ? data[fld.id] : v; downloadBlob(`/api/admin/attachments/${fv.attachmentId}`, fv.filename || 'document'); }}>
                              📎 {(editing ? data[fld.id] : v).filename || 'File'}
                            </button>
                          ) : (
                            <div className="kv-v">{Array.isArray(v) ? v.join(', ') : (isEmpty(v) ? <span className="kv-empty">—</span> : String(v))}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {!editing && !showEmpty && <div className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>Empty fields are hidden — tick "Show empty" to see all fields.</div>}
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
          {hasPerm('status') && (
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
          )}

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
            {hasPerm('communicate') && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 110 }}>
                  <option value="portal">Portal</option>
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
                <input type="text" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message to applicant…" onKeyDown={(e) => e.key === 'Enter' && sendMsg()} />
                <button className="btn" onClick={sendMsg}>Send</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
