import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

export default function Activations() {
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');

  const load = () => adminApi.get('/activations').then((r) => setList(r.data)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);

  const toggle = async (id) => {
    try { await adminApi.post(`/activations/${id}/toggle`); load(); }
    catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Active Forms</h1>
          <div className="muted">A form activation publishes a template for a class with price, validations, statuses and a public URL</div>
        </div>
        <Link className="btn" to="/admin/activations/new">+ Activate Form for Class</Link>
      </div>
      {err && <div className="alert err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Title</th><th>Session</th><th>Class</th><th>Template</th><th>Price</th><th>Public URL</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td><Link to={`/admin/activations/${a.id}`}><b>{a.title}</b></Link></td>
                <td>{a.session?.name}</td>
                <td>{a.classRoom?.name}</td>
                <td>{a.template?.name}</td>
                <td>₹{Number(a.price).toFixed(0)} {a.onlinePaymentEnabled ? '' : '(offline)'}</td>
                <td><code className="url">/form/{a.slug}</code></td>
                <td><span className={`pill ${a.active ? 'on' : 'off'}`}>{a.active ? 'Active' : 'Inactive'}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Link className="btn small ghost" to={`/admin/activations/${a.id}`}>Edit</Link>{' '}
                  <button className={`btn small ${a.active ? 'danger' : 'green'}`} onClick={() => toggle(a.id)}>
                    {a.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="muted">No forms activated yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
