import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await adminApi.post('/auth/login', { email, password });
      sessionStorage.setItem('adminToken', data.token);
      sessionStorage.setItem('adminName', data.name);
      navigate('/admin');
    } catch (e2) {
      setErr(errMsg(e2));
    }
  };

  return (
    <div className="login-box card">
      <h2>Admin Login</h2>
      <p className="muted">Registration module administration</p>
      {err && <div className="alert err">{err}</div>}
      <form onSubmit={submit}>
        <label className="fld">Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="fld">Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn" style={{ width: '100%' }}>Sign in</button>
      </form>
    </div>
  );
}
