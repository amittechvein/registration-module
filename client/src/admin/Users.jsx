import React, { useEffect, useState } from 'react';
import { adminApi, errMsg } from '../lib/api.js';

const emptyForm = { id: null, name: '', email: '', password: '', role: 'staff', permissions: {} };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [allPerms, setAllPerms] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState(null);
  const [pwd, setPwd] = useState({ current: '', next: '' });

  const load = () => adminApi.get('/users').then((r) => { setUsers(r.data.users); setAllPerms(r.data.allPermissions); })
    .catch((e) => setMsg({ type: 'err', text: errMsg(e) }));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setMsg(null);
    try {
      if (form.id) {
        await adminApi.post(`/users/${form.id}`, { name: form.name, role: form.role, permissions: form.permissions, ...(form.password ? { password: form.password } : {}) });
      } else {
        await adminApi.post('/users', form);
      }
      setMsg({ type: 'ok', text: form.id ? 'User updated' : 'User created — share the email & password with them' });
      setForm(emptyForm);
      load();
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };

  const edit = (u) => {
    let permissions = {}; try { permissions = JSON.parse(u.permissions || '{}'); } catch {}
    setForm({ id: u.id, name: u.name, email: u.email, password: '', role: u.role, permissions });
  };

  const toggleActive = async (u) => {
    try { await adminApi.post(`/users/${u.id}`, { active: !u.active }); load(); }
    catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.email}?`)) return;
    try { await adminApi.delete(`/users/${u.id}`); load(); }
    catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };

  const changeMyPassword = async () => {
    setMsg(null);
    try {
      await adminApi.post('/users/me/password', pwd);
      setMsg({ type: 'ok', text: 'Your password has been changed' });
      setPwd({ current: '', next: '' });
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
  };

  const permSummary = (u) => {
    if (u.role === 'owner') return <span className="badge" style={{ background: '#16a34a' }}>Owner — full access</span>;
    let p = {}; try { p = JSON.parse(u.permissions || '{}'); } catch {}
    const granted = allPerms.filter((d) => p[d.key]).map((d) => d.label);
    return granted.length ? <span className="muted">{granted.join(' · ')}</span> : <span className="pill off">no permissions</span>;
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Users & Privileges</h1>
          <div className="muted">Create staff logins that can only do what you allow — e.g. view submissions and update status only</div>
        </div>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <h3>{form.id ? `Edit User: ${form.email}` : 'Create New User'}</h3>
        <div className="grid cols-3">
          <label className="fld">Name
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Staff member's name" />
          </label>
          <label className="fld">Email (login ID)
            <input type="email" value={form.email} disabled={!!form.id} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="staff@school.com" />
          </label>
          <label className="fld">{form.id ? 'New password (leave empty to keep)' : 'Password'}
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 6 characters" />
          </label>
        </div>
        <label className="fld" style={{ maxWidth: 320 }}>Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="staff">Staff — only selected permissions below</option>
            <option value="owner">Owner — full access to everything</option>
          </select>
        </label>
        {form.role === 'staff' && (
          <div style={{ margin: '6px 0 10px' }}>
            <div className="muted" style={{ marginBottom: 6 }}>Permissions for this user:</div>
            {allPerms.map((d) => (
              <label className="check" key={d.key}>
                <input
                  type="checkbox"
                  checked={!!form.permissions[d.key]}
                  onChange={(e) => setForm({ ...form, permissions: { ...form.permissions, [d.key]: e.target.checked } })}
                />
                {d.label}
              </label>
            ))}
          </div>
        )}
        <button className="btn green" onClick={save}>{form.id ? 'Save Changes' : 'Create User'}</button>{' '}
        {form.id && <button className="btn ghost" onClick={() => setForm(emptyForm)}>Cancel</button>}
      </div>

      <div className="card">
        <h3>All Users</h3>
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td>{u.email}</td>
                <td>{permSummary(u)}</td>
                <td><span className={`pill ${u.active ? 'on' : 'off'}`}>{u.active ? 'Active' : 'Disabled'}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn small ghost" onClick={() => edit(u)}>Edit</button>{' '}
                  <button className="btn small ghost" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>{' '}
                  <button className="btn small danger" onClick={() => remove(u)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Change My Password</h3>
        <div className="toolbar">
          <label className="fld" style={{ marginBottom: 0 }}>Current password
            <input type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
          </label>
          <label className="fld" style={{ marginBottom: 0 }}>New password
            <input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
          </label>
          <button className="btn" onClick={changeMyPassword} disabled={!pwd.current || !pwd.next}>Change Password</button>
        </div>
      </div>
    </div>
  );
}
