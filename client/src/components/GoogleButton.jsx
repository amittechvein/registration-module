import React, { useEffect, useRef, useState } from 'react';
import { publicApi } from '../lib/api.js';

/** Renders Google's official sign-in button when a Client ID is configured in Settings. */
export default function GoogleButton({ onCredential }) {
  const ref = useRef(null);
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    publicApi.get('/auth/config').then((r) => setClientId(r.data.googleClientId)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId || !ref.current) return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => onCredential(resp.credential),
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 280 });
    };
    if (window.google?.accounts?.id) { init(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [clientId]); // eslint-disable-line

  if (!clientId) return null;
  return (
    <div style={{ margin: '12px 0' }}>
      <div className="muted" style={{ textAlign: 'center', margin: '8px 0' }}>— or —</div>
      <div ref={ref} style={{ display: 'flex', justifyContent: 'center' }} />
    </div>
  );
}
