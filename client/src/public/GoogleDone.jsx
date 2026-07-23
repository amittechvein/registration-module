import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { storeAdminSession } from '../lib/api.js';

/** Landing page for the Google OAuth redirect flow — stores the session and
 *  sends the user back to where they started. */
export default function GoogleDone() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [wasAdmin, setWasAdmin] = useState(false);

  useEffect(() => {
    try {
      let b64 = window.location.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const p = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (p.error) {
        setError(p.error);
        setWasAdmin(/admin/i.test(p.error));
        return;
      }
      if (p.role === 'admin') {
        storeAdminSession(p);
        navigate(p.next || '/admin', { replace: true });
      } else {
        sessionStorage.setItem('applicantToken', p.token);
        sessionStorage.setItem('applicantPhone', p.applicant?.phone || '');
        navigate(p.next || '/', { replace: true });
      }
    } catch {
      setError('Sign-in could not be completed. Please try again.');
    }
  }, []); // eslint-disable-line

  return (
    <div className="login-page">
      <div className="login-box card" style={{ textAlign: 'center' }}>
        <img src="/api/public/logo" alt="" style={{ height: 56, display: 'block', margin: '0 auto 10px' }} onError={(e) => { e.target.style.display = 'none'; }} />
        {!error ? (
          <>
            <h2>Signing you in…</h2>
            <p className="muted">One moment while we complete your Google sign-in.</p>
          </>
        ) : (
          <>
            <h2>Sign-in failed</h2>
            <div className="alert err" style={{ textAlign: 'left' }}>{error}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 8 }}>
              <Link className="btn" to={wasAdmin ? '/admin/login' : '/'}>← Back to {wasAdmin ? 'admin login' : 'home'}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
