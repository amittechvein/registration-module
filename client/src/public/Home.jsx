import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publicApi } from '../lib/api.js';
import PubShell from '../components/PubShell.jsx';

export default function Home() {
  const [forms, setForms] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { publicApi.get('/forms').then((r) => setForms(r.data)).catch(() => {}).finally(() => setLoaded(true)); }, []);

  return (
    <PubShell>
      <div className="pub-header">
        <div className="pub-brand">
          <img className="pub-logo" src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <h1>Admissions Portal</h1>
            <p style={{ opacity: 0.92, margin: 0, fontSize: 14 }}>Apply online in minutes — fill the form, pay securely, track your status anytime.</p>
          </div>
        </div>
      </div>

      <h3 style={{ margin: '22px 4px 12px' }}>Open Registration Forms</h3>
      <div className="grid cols-2">
        {forms.map((f) => (
          <div className="card form-card" key={f.slug}>
            <h3 style={{ marginBottom: 0 }}>{f.title}</h3>
            <div className="muted">{f.className} · Academic session {f.session}</div>
            <span className="fee-chip">{Number(f.price) > 0 ? `Form fee ₹${Number(f.price).toFixed(0)}` : 'Free application'}</span>
            <Link className="btn" style={{ marginTop: 8 }} to={`/form/${f.slug}`}>Apply Now →</Link>
          </div>
        ))}
        {loaded && !forms.length && <div className="card muted">No forms are open right now. Please check back later.</div>}
      </div>

      <div className="card" style={{ marginTop: 20, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 26 }}>🔒</div>
        <div className="muted" style={{ flex: 1, minWidth: 220 }}>
          Your details are stored securely and payments are processed by Razorpay.
          Log in anytime with your mobile number to continue a saved draft, download your form and payment receipt, or message the school.
        </div>
      </div>
    </PubShell>
  );
}
