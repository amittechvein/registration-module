import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { publicApi, errMsg, downloadBlob } from '../lib/api.js';
import OtpLogin from '../components/OtpLogin.jsx';
import PubShell from '../components/PubShell.jsx';
import WhatsAppSupport from '../components/WhatsAppSupport.jsx';

export default function TrackPage() {
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('applicantToken'));
  const [subs, setSubs] = useState([]);
  const [err, setErr] = useState('');
  const [msgs, setMsgs] = useState({});
  // null = not known yet, true = open, string = closed (the message to show)
  const [closed, setClosed] = useState(null);
  const [popup, setPopup] = useState(null); // submission whose result popup is open
  const TONE = {
    success: { bg: '#f0fdf4', border: '#16a34a', color: '#166534', btn: '#16a34a' },
    regret: { bg: '#fff7ed', border: '#ea580c', color: '#7c2d12', btn: '#ea580c' },
    info: { bg: '#eff6ff', border: '#2563eb', color: '#1e3a8a', btn: '#2563eb' },
  };
  const toneOf = (n) => TONE[n?.tone] || TONE.info;
  const downloadNotice = (s) => downloadBlob(`/api/public/my-submissions/${s.id}/notice`, `notice-${s.formNo}.pdf`, 'applicantToken');
  const downloadNoticeFile = (s) => downloadBlob(`/api/public/my-submissions/${s.id}/notice-file`, s.notice?.file?.name || 'document.pdf', 'applicantToken');
  useEffect(() => {
    publicApi.get('/school-info')
      .then((r) => setClosed(r.data.trackEnabled === false ? (r.data.trackClosedMessage || 'Application tracking is temporarily unavailable.') : false))
      .catch(() => setClosed(false));
  }, []);

  const load = () =>
    publicApi.get('/my-submissions').then((r) => {
      setSubs(r.data);
      // result popup: first application that has a published notice
      const withNotice = r.data.find((x) => x.notice);
      setPopup((p) => (p === undefined ? p : withNotice || null));
    }).catch((e) => {
      if (e.response?.status === 401) setLoggedIn(false);
      else if (e.response?.data?.trackingClosed) setClosed(e.response.data.error);
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
    <PubShell>
      <div className="pub-header">
        <div className="pub-brand">
          <img className="pub-logo" src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <h1>Track Your Application</h1>
            <div style={{ opacity: 0.92, fontSize: 14 }}>Login with the mobile number you used to apply</div>
          </div>
        </div>
      </div>
      {closed && (
        <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 28 }}>⏸️</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>Tracking is temporarily closed</b>
            <div className="muted" style={{ marginTop: 4 }}>{closed}</div>
          </div>
          <Link className="btn" to="/">Browse open forms →</Link>
        </div>
      )}
      {err && !closed && <div className="alert err">{err}</div>}
      {closed === false && !loggedIn && <OtpLogin askProfile={false} onLoggedIn={() => setLoggedIn(true)} />}
      {closed === false && loggedIn && popup && popup.notice && (
        <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
            style={{ background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%', padding: '22px 24px', boxShadow: '0 20px 60px rgba(0,0,0,.3)', borderTop: `6px solid ${toneOf(popup.notice).border}` }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: toneOf(popup.notice).color }}>{popup.notice.heading}</div>
            <div className="muted" style={{ margin: '4px 0 12px' }}>Form No: <b>{popup.formNo}</b> · {popup.form}</div>
            <div style={{ whiteSpace: 'pre-line', fontSize: 15, lineHeight: 1.5 }}>{popup.notice.message}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <button className="btn" style={{ background: toneOf(popup.notice).btn, borderColor: toneOf(popup.notice).btn }} onClick={() => downloadNotice(popup)}>
                📄 Download {popup.notice.title || 'Notice'} (PDF)
              </button>
              {popup.notice.file && (
                <button className="btn ghost" onClick={() => downloadNoticeFile(popup)}>📎 {popup.notice.file.label} (PDF)</button>
              )}
              <button className="btn ghost" onClick={() => setPopup(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {closed === false && loggedIn && (
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

              {/* Payment stuck? Direct WhatsApp line to support */}
              {Number(s.amount) > 0 && ['pending', 'failed'].includes(s.paymentStatus) && (
                <div className="alert err" style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>
                    <b>Payment {s.paymentStatus === 'failed' ? 'failed' : 'not confirmed yet'}.</b>{' '}
                    If money was deducted from your account, don't pay again — contact support and we will verify it.
                  </span>
                  <WhatsAppSupport
                    small
                    label="💬 WhatsApp Support"
                    text={`Hello, my admission form payment is stuck.\nForm: ${s.form || ''}\nForm No: ${s.formNo || 'DRAFT (application #' + s.id + ')'}\nRegistered mobile: ${sessionStorage.getItem('applicantPhone') || ''}\nPlease check my payment.`}
                  />
                </div>
              )}

              {!s.isDraft && s.notice && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: toneOf(s.notice).bg, border: `1px solid ${toneOf(s.notice).border}`, color: toneOf(s.notice).color }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{s.notice.heading}</div>
                  <div style={{ whiteSpace: 'pre-line', marginTop: 4 }}>{s.notice.message}</div>
                </div>
              )}
              {!s.isDraft && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button className="btn ghost" onClick={() => downloadBlob(`/api/public/my-submissions/${s.id}/pdf`, `application-${s.formNo}.pdf`, 'applicantToken')}>
                      ⬇ Download Form (PDF)
                    </button>
                    {s.notice && (
                      <button className="btn" style={{ background: toneOf(s.notice).btn, borderColor: toneOf(s.notice).btn }} onClick={() => downloadNotice(s)}>
                        📄 {s.notice.title || 'Notice'} (PDF)
                      </button>
                    )}
                    {s.notice?.file && (
                      <button className="btn ghost" onClick={() => downloadNoticeFile(s)}>📎 {s.notice.file.label} (PDF)</button>
                    )}
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
    </PubShell>
  );
}
