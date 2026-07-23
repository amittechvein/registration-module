import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

const ACTION_META = {
  'login': { icon: '🔑', label: 'Login', color: '#2563eb' },
  'login.failed': { icon: '🚫', label: 'Failed login', color: '#dc2626' },
  'submission.edit': { icon: '✏️', label: 'Form edited', color: '#d97706' },
  'status.change': { icon: '🔄', label: 'Status change', color: '#7c3aed' },
  'status.bulk': { icon: '🔄', label: 'Bulk status', color: '#7c3aed' },
  'message.send': { icon: '💬', label: 'Message sent', color: '#0891b2' },
  'message.bulk': { icon: '📢', label: 'Bulk message', color: '#0891b2' },
  'settings.save': { icon: '⚙️', label: 'Settings', color: '#64748b' },
  'user.create': { icon: '👤', label: 'User created', color: '#16a34a' },
  'user.update': { icon: '👤', label: 'User updated', color: '#16a34a' },
  'user.delete': { icon: '👤', label: 'User deleted', color: '#dc2626' },
  'template.save': { icon: '🧩', label: 'Template', color: '#0f766e' },
  'activation.save': { icon: '🚀', label: 'Active form', color: '#0f766e' },
  'activation.toggle': { icon: '🚀', label: 'Form on/off', color: '#0f766e' },
};

const FILTERS = [
  { value: '', label: 'All activity' },
  { value: 'login', label: 'Logins' },
  { value: 'submission', label: 'Form edits' },
  { value: 'status', label: 'Status changes' },
  { value: 'message', label: 'Messages' },
  { value: 'user', label: 'User management' },
  { value: 'settings', label: 'Settings' },
  { value: 'template', label: 'Templates' },
  { value: 'activation', label: 'Active forms' },
];

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState(null);
  const limit = 50;

  const load = (off = 0) => {
    setErr('');
    adminApi.get('/audit', { params: { q: q || undefined, action: action || undefined, limit, offset: off } })
      .then((r) => { setRows(r.data.rows); setCount(r.data.count); setOffset(off); })
      .catch((e) => setErr(errMsg(e)));
  };
  useEffect(() => { load(0); }, [action]); // eslint-disable-line

  const meta = (a) => ACTION_META[a] || { icon: '📌', label: a, color: '#64748b' };

  const renderChanges = (r) => {
    try {
      const d = JSON.parse(r.details || 'null');
      if (!d?.changes?.length) return null;
      return (
        <table className="tbl" style={{ marginTop: 6 }}>
          <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
          <tbody>
            {d.changes.map((c, i) => (
              <tr key={i}>
                <td className="muted">{c.field}</td>
                <td style={{ color: '#dc2626' }}>{c.from}</td>
                <td style={{ color: '#16a34a' }}><b>{c.to}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    } catch { return null; }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Audit Log</h1>
          <div className="muted">Who did what and when — logins, form edits, status changes, messages, settings and user management</div>
        </div>
        <button className="btn ghost" onClick={() => load(offset)}>↻ Refresh</button>
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="card">
        <div className="toolbar">
          <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: 180 }}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <input
            type="text" value={q} placeholder="Search by user, form no, text…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(0)}
            style={{ width: 260 }}
          />
          <button className="btn small" onClick={() => load(0)}>Search</button>
          <span className="muted" style={{ marginLeft: 'auto' }}>{count} entries</span>
        </div>

        <table className="tbl">
          <thead><tr><th style={{ width: 150 }}>When</th><th style={{ width: 130 }}>User</th><th style={{ width: 130 }}>Action</th><th>Details</th><th style={{ width: 100 }}>IP</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const m = meta(r.action);
              const hasChanges = (() => { try { return !!JSON.parse(r.details || 'null')?.changes?.length; } catch { return false; } })();
              return (
                <React.Fragment key={r.id}>
                  <tr style={{ cursor: hasChanges ? 'pointer' : 'default' }} onClick={() => hasChanges && setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="muted">{new Date(r.createdAt).toLocaleString('en-IN')}</td>
                    <td><b>{r.actorName}</b></td>
                    <td><span className="badge" style={{ background: m.color }}>{m.icon} {m.label}</span></td>
                    <td>
                      {r.entity === 'Submission' && r.entityId
                        ? <Link to={`/admin/submissions/${r.entityId}`} onClick={(e) => e.stopPropagation()}>{r.summary}</Link>
                        : r.summary}
                      {hasChanges && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{expanded === r.id ? '▲ hide' : '▼ view changes'}</span>}
                    </td>
                    <td className="muted" style={{ fontSize: 11 }}>{r.ip}</td>
                  </tr>
                  {expanded === r.id && (
                    <tr><td colSpan={5} style={{ background: '#f8fafc' }}>{renderChanges(r)}</td></tr>
                  )}
                </React.Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 18 }}>No audit entries match.</td></tr>}
          </tbody>
        </table>

        {count > limit && (
          <div className="toolbar" style={{ marginTop: 10, justifyContent: 'center' }}>
            <button className="btn small ghost" disabled={offset === 0} onClick={() => load(Math.max(0, offset - limit))}>← Newer</button>
            <span className="muted">{offset + 1}–{Math.min(offset + limit, count)} of {count}</span>
            <button className="btn small ghost" disabled={offset + limit >= count} onClick={() => load(offset + limit)}>Older →</button>
          </div>
        )}
      </div>
    </div>
  );
}
