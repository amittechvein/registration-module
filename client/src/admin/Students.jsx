import React, { useEffect, useState } from 'react';
import { adminApi, errMsg } from '../lib/api.js';

export default function Students() {
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { adminApi.get('/students').then((r) => setList(r.data)).catch((e) => setErr(errMsg(e))); }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Allotted Students</h1>
          <div className="muted">Created automatically in the Students DB when a form is moved to the "Allotted" status (via linked fields)</div>
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Admission No</th><th>Name</th><th>DOB</th><th>Class</th><th>Session</th><th>Father</th><th>Phone</th><th>City</th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><b>{s.admissionNo || '—'}</b></td>
                <td>{[s.firstName, s.lastName].filter(Boolean).join(' ') || '—'}</td>
                <td>{s.dob || '—'}</td>
                <td>{s.classRoom?.name || '—'}</td>
                <td>{s.session?.name || '—'}</td>
                <td>{s.fatherName || '—'}</td>
                <td>{s.guardianPhone || '—'}</td>
                <td>{s.city || '—'}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={8} className="muted">No students allotted yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
