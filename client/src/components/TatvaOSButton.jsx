import React, { useEffect, useState } from 'react';
import { publicApi } from '../lib/api.js';

const TLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="2" width="20" height="20" rx="5" fill="#0f2a5a" />
    <path d="M7 8h10M12 8v9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

/**
 * "Sign in with TatvaOS" — full-page OpenID Connect redirect handled by the
 * server (/api/public/auth/tatvaos/start → TatvaOS → /callback → /google-done).
 * Renders nothing until a Client ID + Secret are saved in Settings.
 * Place it right after <GoogleButton/>; it draws its own "— or —" divider
 * only when Google is not configured.
 */
export default function TatvaOSButton({ role = 'applicant' }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { publicApi.get('/auth/config').then((r) => setCfg(r.data)).catch(() => {}); }, []);
  if (!cfg?.tatvaosEnabled) return null;
  const next = role === 'admin' ? '/admin' : window.location.pathname + window.location.search;
  const href = `/api/public/auth/tatvaos/start?role=${role}&next=${encodeURIComponent(next)}`;
  return (
    <div style={{ margin: cfg.googleClientId ? '8px 0 12px' : '12px 0' }}>
      {!cfg.googleClientId && <div className="muted" style={{ textAlign: 'center', margin: '8px 0' }}>— or —</div>}
      <a className="gbtn" href={href}>
        <TLogo /> Sign in with TatvaOS
      </a>
    </div>
  );
}
