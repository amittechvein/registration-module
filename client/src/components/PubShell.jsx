import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { publicApi } from '../lib/api.js';

/** Shared chrome for all parent-facing pages: sticky navbar + footer. */
export default function PubShell({ children }) {
  const [school, setSchool] = useState({ name: '', address: '' });
  const loc = useLocation();
  useEffect(() => { publicApi.get('/school-info').then((r) => setSchool(r.data)).catch(() => {}); }, []);

  return (
    <div className="pub-shell">
      <nav className="pub-navbar">
        <Link to="/" className="pub-nav-brand">
          <img src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <b>{school.name || 'Admissions Portal'}</b>
            <span>Online Admissions</span>
          </div>
        </Link>
        <div className="pub-nav-links">
          <Link to="/" className={loc.pathname === '/' ? 'on' : ''}>Forms</Link>
          <Link to="/track" className={loc.pathname === '/track' ? 'on' : ''}>Track Application</Link>
        </div>
      </nav>

      <div className="pub-wrap">{children}</div>

      <footer className="pub-footer">
        <div>
          <b>{school.name}</b>
          <div>{school.address}</div>
        </div>
        <div className="muted">Payments secured by Razorpay · Need help? Use "Track Application" to message the school.</div>
      </footer>
    </div>
  );
}
