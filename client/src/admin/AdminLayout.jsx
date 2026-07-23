import React from 'react';
import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom';
import { hasPerm } from '../lib/api.js';

export default function AdminLayout() {
  const navigate = useNavigate();
  if (!sessionStorage.getItem('adminToken')) return <Navigate to="/admin/login" />;
  const name = sessionStorage.getItem('adminName') || 'Admin';
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">🎓 Admissions</div>
        <NavLink to="/admin" end>Dashboard</NavLink>
        {hasPerm('forms') && <NavLink to="/admin/templates">Form Templates</NavLink>}
        {hasPerm('forms') && <NavLink to="/admin/activations">Active Forms</NavLink>}
        {hasPerm('submissions') && <NavLink to="/admin/submissions">Submissions</NavLink>}
        {hasPerm('students') && <NavLink to="/admin/students">Allotted Students</NavLink>}
        {hasPerm('settings') && <NavLink to="/admin/settings">Settings</NavLink>}
        {hasPerm('users') && <NavLink to="/admin/users">Users</NavLink>}
        <a
          href="#logout"
          onClick={(e) => { e.preventDefault(); sessionStorage.clear(); navigate('/admin/login'); }}
          style={{ marginTop: 24, color: '#f87171' }}
        >
          Logout ({name})
        </a>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
