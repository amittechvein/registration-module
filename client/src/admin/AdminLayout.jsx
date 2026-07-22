import React from 'react';
import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom';

export default function AdminLayout() {
  const navigate = useNavigate();
  if (!sessionStorage.getItem('adminToken')) return <Navigate to="/admin/login" />;
  const name = sessionStorage.getItem('adminName') || 'Admin';
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">🎓 Admissions</div>
        <NavLink to="/admin" end>Dashboard</NavLink>
        <NavLink to="/admin/templates">Form Templates</NavLink>
        <NavLink to="/admin/activations">Active Forms</NavLink>
        <NavLink to="/admin/submissions">Submissions</NavLink>
        <NavLink to="/admin/students">Allotted Students</NavLink>
        <NavLink to="/admin/settings">Settings</NavLink>
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
