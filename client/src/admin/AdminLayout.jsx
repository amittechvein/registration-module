import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom';
import { hasPerm, publicApi } from '../lib/api.js';

const NAV = [
  { to: '/admin', end: true, icon: '📊', label: 'Dashboard', perm: null, bubble: '#d3e3fd' },
  { to: '/admin/templates', icon: '🧩', label: 'Form Templates', perm: 'forms', bubble: '#e6f4ea' },
  { to: '/admin/activations', icon: '🚀', label: 'Active Forms', perm: 'forms', bubble: '#fef7e0' },
  { to: '/admin/submissions', icon: '📥', label: 'Submissions', perm: 'submissions', bubble: '#fce8e6' },
  { to: '/admin/students', icon: '🎓', label: 'Allotted Students', perm: 'students', bubble: '#f3e8fd' },
  { to: '/admin/settings', icon: '⚙️', label: 'Settings', perm: 'settings', bubble: '#e0f7fa' },
  { to: '/admin/users', icon: '👥', label: 'Users', perm: 'users', bubble: '#fde7f3' },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [school, setSchool] = useState({ name: '' });
  useEffect(() => { publicApi.get('/school-info').then((r) => setSchool(r.data)).catch(() => {}); }, []);
  if (!sessionStorage.getItem('adminToken')) return <Navigate to="/admin/login" />;
  const name = sessionStorage.getItem('adminName') || 'Admin';
  const role = sessionStorage.getItem('adminRole') || 'owner';

  return (
    <div className="app-shell">
      <header className="app-top">
        <div className="app-top-brand">
          <img src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <b>{school.name || 'Admissions'}</b>
            <span>Admissions Management</span>
          </div>
        </div>
        <div className="app-top-right">
          <a href="/" target="_blank" rel="noreferrer" className="btn small ghost">🌐 View Portal</a>
          <div className="user-chip">
            <div className="user-avatar">{name.slice(0, 1).toUpperCase()}</div>
            <div>
              <b>{name}</b>
              <span>{role === 'owner' ? 'Owner' : 'Staff'}</span>
            </div>
          </div>
          <button className="btn small ghost" style={{ color: '#dc2626' }}
            onClick={() => { sessionStorage.clear(); navigate('/admin/login'); }}>
            Logout
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          {NAV.filter((n) => !n.perm || hasPerm(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <span className="nav-ico" style={{ background: n.bubble }}>{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
