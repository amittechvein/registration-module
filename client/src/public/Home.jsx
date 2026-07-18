import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publicApi } from '../lib/api.js';

export default function Home() {
  const [forms, setForms] = useState([]);
  useEffect(() => { publicApi.get('/forms').then((r) => setForms(r.data)).catch(() => {}); }, []);

  return (
    <div className="pub-wrap">
      <div className="pub-header">
        <h1>Admissions — Open Registration Forms</h1>
        <p style={{ opacity: 0.9, margin: 0 }}>Fill the form online, pay the fee, and track your application status.</p>
      </div>
      <div className="grid cols-2">
        {forms.map((f) => (
          <div className="card" key={f.slug}>
            <h3>{f.title}</h3>
            <div className="muted">{f.className} · Session {f.session}</div>
            <div style={{ margin: '10px 0', fontWeight: 700 }}>{Number(f.price) > 0 ? `Form fee: ₹${Number(f.price).toFixed(0)}` : 'Free'}</div>
            <Link className="btn" to={`/form/${f.slug}`}>Apply Now →</Link>
          </div>
        ))}
        {!forms.length && <div className="card muted">No forms are open right now. Please check back later.</div>}
      </div>
      <p style={{ marginTop: 18 }}>
        Already applied? <Link to="/track"><b>Track your application</b></Link> with your mobile number.
      </p>
    </div>
  );
}
