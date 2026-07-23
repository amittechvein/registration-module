import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

export default function Templates() {
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');

  const load = () => adminApi.get('/templates').then((r) => setList(r.data)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    if (!window.confirm('Delete this template?')) return;
    try { await adminApi.delete(`/templates/${id}`); load(); }
    catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Form Templates</h1>
          <div className="muted">Dynamic templates: sections → fields, linkable to the student profile</div>
        </div>
        <Link className="btn" to="/admin/templates/new">+ New Template</Link>
      </div>
      {err && <div className="alert err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Sections</th><th>Fields</th><th>Linked fields</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map((t) => {
              const fields = t.sections.flatMap((s) => s.fields);
              return (
                <tr key={t.id}>
                  <td><Link to={`/admin/templates/${t.id}`}><b>{t.name}</b></Link></td>
                  <td>{t.sections.length}</td>
                  <td>{fields.length}</td>
                  <td>{fields.filter((f) => f.studentField).length} linked to student profile</td>
                  <td><span className={`pill ${t.active ? 'on' : 'off'}`}>{t.active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link className="btn small ghost" to={`/admin/templates/${t.id}`}>Edit</Link>{' '}
                    <Link className="btn small ghost" to={`/admin/templates/${t.id}/design`}>🎨 Design PDF</Link>{' '}
                    <button className="btn small danger" onClick={() => remove(t.id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={6} className="muted">No templates yet — create your first form template.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
