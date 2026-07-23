import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { adminApi.get('/dashboard').then((r) => setD(r.data)).catch((e) => setErr(errMsg(e))); }, []);

  if (!d) return <div>{err ? <div className="alert err">{err}</div> : 'Loading…'}</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Registration Dashboard</h1>
          <div className="muted">Summary of all admission form registrations</div>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat" style={{ '--accent': '#2563eb' }}><div className="stat-ico">📥</div><div className="lbl">Forms Submitted</div><div className="num">{d.totals.totalSubmitted}</div></div>
        <div className="stat" style={{ '--accent': '#d97706' }}><div className="stat-ico">✏️</div><div className="lbl">Drafts In Progress</div><div className="num">{d.totals.totalDrafts}</div></div>
        <div className="stat" style={{ '--accent': '#16a34a' }}><div className="stat-ico">💰</div><div className="lbl">Fees Collected</div><div className="num">₹{d.totals.feeCollected.toLocaleString('en-IN')}</div></div>
        <div className="stat" style={{ '--accent': '#7c3aed' }}><div className="stat-ico">🎓</div><div className="lbl">Students Allotted</div><div className="num">{d.totals.studentsAllotted}</div></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Forms Overview</h3>
        <table className="tbl">
          <thead><tr><th>Form</th><th>Class / Session</th><th>Submitted</th><th>Drafts</th><th>Collected</th><th style={{ width: '30%' }}>Status distribution</th><th></th></tr></thead>
          <tbody>
            {d.perForm.map((f) => {
              const entries = Object.entries(f.byStatus).filter(([, v]) => v.count > 0);
              const total = entries.reduce((t, [, v]) => t + v.count, 0);
              return (
                <tr key={f.id}>
                  <td>
                    <b>{f.title}</b> {f.active ? <span className="pill on">live</span> : <span className="pill off">off</span>}
                    <div className="muted"><code className="url">/form/{f.slug}</code></div>
                  </td>
                  <td>{f.className}<div className="muted">{f.session}</div></td>
                  <td><b>{f.submitted}</b></td>
                  <td className="muted">{f.drafts}</td>
                  <td>₹{f.collected.toLocaleString('en-IN')}</td>
                  <td>
                    {total > 0 ? (
                      <>
                        <div className="dist">
                          {entries.map(([name, v]) => (
                            <div key={name} title={`${name}: ${v.count}`} style={{ width: `${(v.count / total) * 100}%`, background: v.color, borderRight: '2px solid #fff' }} />
                          ))}
                        </div>
                        <div className="legend">
                          {entries.map(([name, v]) => (
                            <span key={name}><span className="dot" style={{ background: v.color }} />{name} ({v.count})</span>
                          ))}
                        </div>
                      </>
                    ) : <span className="muted">No submissions</span>}
                  </td>
                  <td><Link className="btn small ghost" to={`/admin/submissions?activationId=${f.id}`}>View</Link></td>
                </tr>
              );
            })}
            {!d.perForm.length && <tr><td colSpan={7} className="muted">No forms activated yet — start by creating a <Link to="/admin/templates">template</Link> and <Link to="/admin/activations/new">activating it for a class</Link>.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Recent Submissions</h3>
        <table className="tbl">
          <thead><tr><th>Form No</th><th>Applicant</th><th>Form</th><th>Status</th><th>Submitted</th></tr></thead>
          <tbody>
            {d.recent.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/admin/submissions/${r.id}`}><b>{r.formNo}</b></Link></td>
                <td>{r.applicant?.name || r.applicant?.phone}</td>
                <td>{r.activation?.title}</td>
                <td>{r.status && <span className="badge" style={{ background: r.status.color }}>{r.status.name}</span>}</td>
                <td className="muted">{new Date(r.submittedAt).toLocaleString('en-IN')}</td>
              </tr>
            ))}
            {!d.recent.length && <tr><td colSpan={5} className="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
