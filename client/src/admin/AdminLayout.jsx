import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom';
import { hasPerm, publicApi, adminApi } from '../lib/api.js';

const NAV = [
  { to: '/admin', end: true, icon: '📊', label: 'Dashboard', perm: null, bubble: '#d3e3fd' },
  { to: '/admin/templates', icon: '🧩', label: 'Form Templates', perm: 'forms', bubble: '#e6f4ea' },
  { to: '/admin/activations', icon: '🚀', label: 'Active Forms', perm: 'forms', bubble: '#fef7e0' },
  { to: '/admin/submissions', icon: '📥', label: 'Submissions', perm: 'submissions', bubble: '#fce8e6' },
  { to: '/admin/students', icon: '🎓', label: 'Allotted Students', perm: 'students', bubble: '#f3e8fd' },
  { to: '/admin/settings', icon: '⚙️', label: 'Settings', perm: 'settings', bubble: '#e0f7fa' },
  { to: '/admin/users', icon: '👥', label: 'Users', perm: 'users', bubble: '#fde7f3' },
  { to: '/admin/audit', icon: '📜', label: 'Audit Log', perm: 'audit', bubble: '#f1f5f9' },
];

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unseen, setUnseen] = useState(0);
  const boxRef = useRef(null);

  const load = () => adminApi.get('/notifications')
    .then((r) => { setItems(r.data.items || []); setUnseen(r.data.unseen || 0); })
    .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(t);
  }, []);

  // close on outside click
  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unseen > 0) {
      // opening the bell marks everything as read
      adminApi.post('/notifications/seen').then(() => setUnseen(0)).catch(() => {});
    }
  };

  return (
    <div className="bell-wrap" ref={boxRef}>
      <button className="bell-btn" onClick={toggle} title="Notifications">
        🔔
        {unseen > 0 && <span className="bell-badge">{unseen > 9 ? '9+' : unseen}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <b>Notifications</b>
            <button className="btn small ghost" onClick={load}>↻ Refresh</button>
          </div>
          {!items.length && <div className="muted" style={{ padding: '14px 16px' }}>Nothing new in the last 30 days.</div>}
          {items.map((n, i) => (
            <div
              key={i}
              className={`bell-item ${n.unseen ? 'new' : ''}`}
              onClick={() => { setOpen(false); if (n.submissionId) navigate(`/admin/submissions/${n.submissionId}`); }}
            >
              <span className="bell-ico">{n.type === 'submission' ? '📥' : '💬'}</span>
              <div>
                <div className="bell-title">{n.title}</div>
                <div className="bell-body">{n.body}</div>
              </div>
              <span className="bell-time">{timeAgo(n.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const [school, setSchool] = useState({ name: '' });
  const [navOpen, setNavOpen] = useState(localStorage.getItem('navOpen') !== '0');
  const toggleNav = () => {
    const next = !navOpen;
    setNavOpen(next);
    localStorage.setItem('navOpen', next ? '1' : '0');
  };
  useEffect(() => { publicApi.get('/school-info').then((r) => setSchool(r.data)).catch(() => {}); }, []);
  if (!sessionStorage.getItem('adminToken')) return <Navigate to="/admin/login" />;
  const name = sessionStorage.getItem('adminName') || 'Admin';
  const role = sessionStorage.getItem('adminRole') || 'owner';

  return (
    <div className="app-shell">
      <header className="app-top">
        <div className="app-top-brand">
          <button className="nav-burger" onClick={toggleNav} title={navOpen ? 'Hide menu' : 'Show menu'}>☰</button>
          <img src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <b>{school.name || 'Admissions'}</b>
            <span>Admissions Management</span>
          </div>
        </div>
        <div className="app-top-right">
          <a href="/" target="_blank" rel="noreferrer" className="btn small ghost">🌐 View Portal</a>
          <NotificationBell />
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
        <aside className={`sidebar ${navOpen ? '' : 'collapsed'}`}>
          {NAV.filter((n) => !n.perm || hasPerm(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={n.label}>
              <span className="nav-ico" style={{ background: n.bubble }}>{n.icon}</span>
              <span className="nav-lbl">{n.label}</span>
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
