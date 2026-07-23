import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publicApi, errMsg, downloadBlob } from '../lib/api.js';
import OtpLogin from '../components/OtpLogin.jsx';

export default function TrackPage() {
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('applicantToken'));
  const [subs, setSubs] = useState([]);
  const [err, setErr] = useState('');
  const [msgs, setMsgs] = useState({});

  const load = () =>
    publicApi.get('/my-submissions').then((r) => setSubs(r.data)).catch((e) => {
      if (e.response?.status === 401) setLoggedIn(false);
      else setErr(errMsg(e));
    });
  useEffect(() => { if (loggedIn) load(); }, [loggedIn]); // eslint-disable-line

  const send = async (id) => {
    const message = (msgs[id] || '').trim();
    if (!message) return;
    try {
      await publicApi.post(`/my-submissions/${id}/communications`, { message });
      setMsgs((m) => ({ ...m, [id]: '' }));
      load();
    } catch (e) { setErr(errMsg(e)); }
  };

  return (
    <div className="pub-wrap">
      <div className="pub-header">
        <div className="pub-brand">
          <img className="pub-logo" src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <h1>Track Your Application</h1>
            <div style={{ opacity: 0.92, fontSize: 14 }}>Login with the mobile number you used to apply</div>
          </div>
        </div>
        <div className="pub-nav">
          <Link to="/">← All forms</Link>
        </div>
      </div>
      {err && <div className="alert err">{err}</div>}
      {!loggedIn && <OtpLogin askProfile={false} onLoggedIn={() => setLoggedIn(true)} />}
      {loggedIn && (
        <>
          {subs.map((s) => (
            <div className="card" key={s.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3>{s.form} <span className="muted">· {s.className} · {s.session}</span></h3>
                  <div className="muted">Form No: <b>{s.formNo || '—'}</b> {s.amount > 0 && <>· Fee: ₹{Number(s.amount).toFixed(0)} ({s.paymentStatus})</>}</div>
                </div>
                <div>
                  {s.isDraft
                    ? <Link className="btn" to={`/form/${s.slug}`}>Continue draft →</Link>
                    : s.status && <span className="badge" style={{ background: s.status.color, fontSize: 14 }}>{s.status.name}</span>}
                </div>
              </div>

              {!s.isDraft && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button className="btn ghost" onClick={() => downloadBlob(`/api/public/my-submissions/${s.id}/pdf`, `application-${s.formNo}.pdf`, 'applicantToken')}>
                      ⬇ Download Form (PDF)
                    </button>
                    {s.paymentStatus === 'paid' && (
                      <button className="btn ghost" onClick={() => downloadBlob(`/api/public/my-submissions/${s.id}/receipt`, `receipt-${s.formNo}.pdf`, 'applicantToken')}>
                        🧾 Payment Receipt
                      </button>
                    )}
                  </div>
                  <div className="section-title">Status history</div>
                  <div className="timeline">
                    {(s.statusLogs || []).slice().reverse().map((l) => (
                      <div key={l.id} className="tl-item">
                        <b>{l.toStatus}</b>{l.note ? <span className="muted"> · {l.note}</span> : ''}
                        <div className="muted">{new Date(l.createdAt).toLocaleString('en-IN')}</div>
                      </div>
                    ))}
                  </div>

                  <div className="section-title">Messages</div>
                  <div className="thread">
                    {(s.communications || []).map((c) => (
                      <div key={c.id} className={`msg ${c.sender}`}>
                        {c.message}
                        <div className="meta">{c.sender} · {new Date(c.createdAt).toLocaleString('en-IN')}</div>
                      </div>
                    ))}
                    {!(s.communications || []).length && <div className="muted">No messages yet. You can write to the school below.</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input type="text" value={msgs[s.id] || ''} onChange={(e) => setMsgs((m) => ({ ...m, [s.id]: e.target.value }))} placeholder="Write a message to the school…" onKeyDown={(e) => e.key === 'Enter' && send(s.id)} />
                    <button className="btn" onClick={() => send(s.id)}>Send</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!subs.length && (
            <div className="card">
              <p className="muted">No applications found for this mobile number.</p>
              <Link className="btn" to="/">Browse open forms →</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
