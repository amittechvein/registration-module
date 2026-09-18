import React, { useEffect, useState } from 'react';
import { adminApi, publicApi, errMsg } from '../lib/api.js';

const GROUPS = [
  {
    id: 'razorpay', title: 'Razorpay (Online Payments)',
    hint: 'Get keys from dashboard.razorpay.com → Settings → API Keys. Test keys (rzp_test_…) simulate payments; live keys (rzp_live_…) collect real money. Leave empty for mock mode (development only).',
  },
  {
    id: 'sms', title: 'SMS (OTP & Status Notifications)',
    hint: 'Infobip is used when username & password are set. The OTP template must exactly match your DLT-registered template ({{otp}} is replaced with the code). Turn OFF "Show OTP on screen" before going live.',
  },
  {
    id: 'email', title: 'Email (TatvaOS Mail)',
    hint: 'All emails (status notifications, messages to applicants, daily Owner report, server alerts) are sent through the TatvaOS Mail API. Get the key from TatvaOS admin → Organisation → API keys (it is shown once — if lost, revoke and create a new one). The From Address must be a mailbox on a domain verified in TatvaOS (e.g. admissions@techvein.com — a plain address, no display name). Attachments are not supported by TatvaOS: the daily report links to the Excel instead.',
  },
  {
    id: 'tracking', title: 'Parent Tracking Page',
    hint: 'Switch the parent "Track Application" page OFF to block tracking logins temporarily (e.g. while results are being finalised). The link disappears from the portal, the page shows your message, and the tracking API is blocked. Applying, paying and continuing drafts keep working. Switch back ON any time — no deploy needed.',
  },
  {
    id: 'reports', title: 'Daily Report to Owners',
    hint: 'Every day at the chosen time (IST), all active users with Role: Owner receive an email with a summary of every active form (submissions, last-24h count, fees collected, status breakdown) and a secure link (valid 3 days) to download the complete submissions Excel. Requires Email to be configured above.',
  },
  {
    id: 'auth', title: 'Login Options (Google & TatvaOS Sign-In)',
    hint: 'GOOGLE: in console.cloud.google.com → APIs & Services → Credentials → your OAuth 2.0 Client ID (Web application): add https://form.techvein.org/api/public/auth/google/callback under "Authorized redirect URIs", then paste the Client ID and Client Secret. TATVAOS: in TatvaOS admin → Organisation → Applications → New application, redirect URI https://form.techvein.org/api/public/auth/tatvaos/callback (exact match), Server application = Yes; paste the Client ID (tos_…) and Client Secret (toss_…, shown once). Optionally enter your Organisation ID to refuse sign-ins from any other TatvaOS organisation. For both: admin sign-in only works for emails that exist in Users; parents get an account automatically. Buttons appear on the login screens as soon as ID + Secret are saved.',
  },
];

export default function Settings() {
  const [items, setItems] = useState([]);
  const [values, setValues] = useState({});
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);
  const [testPhone, setTestPhone] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState({});
  const [busy, setBusy] = useState(false);
  const [school, setSchool] = useState({ name: '' });
  const [q, setQ] = useState('');

  const load = async () => {
    const [s, st] = await Promise.all([adminApi.get('/settings'), adminApi.get('/settings/status')]);
    setItems(s.data);
    setValues(Object.fromEntries(s.data.map((i) => [i.key, i.value ?? ''])));
    setStatus(st.data);
  };
  useEffect(() => {
    load().catch((e) => setMsg({ type: 'err', text: errMsg(e) }));
    publicApi.get('/school-info').then((r) => setSchool(r.data)).catch(() => {});
  }, []);

  // Google-account-style search: filter groups & fields as you type
  const matches = (g) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return g.title.toLowerCase().includes(needle)
      || g.hint.toLowerCase().includes(needle)
      || items.some((i) => i.group === g.id && i.label.toLowerCase().includes(needle));
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data } = await adminApi.post('/settings', { settings: values });
      setMsg({ type: 'ok', text: `Settings saved. Razorpay mode: ${data.razorpayMode.toUpperCase()}. Changes apply immediately — no restart needed.` });
      await load();
    } catch (e) { setMsg({ type: 'err', text: errMsg(e) }); }
    setBusy(false);
  };

  const test = async (kind) => {
    setTestResult((t) => ({ ...t, [kind]: '…testing' }));
    try {
      if (kind === 'report') {
        const { data } = await adminApi.post('/reports/send-now');
        setTestResult((t) => ({ ...t, report: data.sent?.length ? `✅ Sent to: ${data.sent.join(', ')}` : `❌ ${data.skipped || 'No owner received it — check Email settings & owner email addresses'}` }));
        return;
      }
      const { data } = kind === 'sms'
        ? await adminApi.post('/settings/test-sms', { phone: testPhone })
        : await adminApi.post('/settings/test-email', { to: testEmail });
      setTestResult((t) => ({ ...t, [kind]: (data.ok ? '✅ ' : '❌ ') + data.note }));
    } catch (e) { setTestResult((t) => ({ ...t, [kind]: '❌ ' + errMsg(e) })); }
  };

  const modeBadge = () => {
    if (!status) return null;
    const m = status.razorpay.mode;
    const color = m === 'live' ? '#16a34a' : m === 'test' ? '#d97706' : '#64748b';
    return <span className="badge" style={{ background: color }}>{m === 'mock' ? 'MOCK (no gateway)' : m.toUpperCase() + ' MODE'}</span>;
  };

  return (
    <div>
      {/* Google-Account-style centered header */}
      <div className="gset-head">
        <img src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
        <h1>{school.name || 'School Settings'}</h1>
        <div className="muted">SMS, Email, Payments & Login configuration — stored securely, applied instantly</div>
        <div className="gset-search">
          <span>🔍</span>
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings (e.g. razorpay, otp, smtp…)" />
        </div>
        <button className="btn green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save All Settings'}</button>
      </div>
      {msg && <div className={`alert ${msg.type}`}>{msg.text}</div>}
      {status && (
        <div className="card" style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><span className="muted">Payments:</span> {modeBadge()}</div>
          <div><span className="muted">SMS:</span> <b>{status.sms}</b></div>
          <div><span className="muted">Email:</span> <b>{status.email}</b></div>
          {status.devShowOtp && <div className="pill off">⚠ OTP shown on screen — turn off before going live</div>}
        </div>
      )}

      {GROUPS.filter(matches).map((g) => (
        <div className="card" key={g.id}>
          <h3>{g.title}</h3>
          <div className="muted" style={{ marginBottom: 12 }}>{g.hint}</div>
          <div className="grid cols-3">
            {items.filter((i) => i.group === g.id).map((i) => (
              <label className="fld" key={i.key}>
                {i.label} {i.secret && i.isSet && <span className="pill on">set</span>}
                {i.key === 'REPORT_ENABLED' ? (
                  <select value={values[i.key] || 'true'} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })}>
                    <option value="true">ON — send every day</option>
                    <option value="false">OFF — do not send</option>
                  </select>
                ) : i.key === 'TRACK_ENABLED' ? (
                  <select value={values[i.key] || 'true'} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })}>
                    <option value="true">OPEN — parents can log in and track</option>
                    <option value="false">CLOSED — tracking login blocked</option>
                  </select>
                ) : i.key === 'DEV_SHOW_OTP' ? (
                  <select value={values[i.key] || 'true'} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })}>
                    <option value="true">ON — show OTP on screen (testing)</option>
                    <option value="false">OFF — send by SMS only (production)</option>
                  </select>
                ) : (
                  <input
                    type={i.secret ? 'password' : 'text'}
                    value={values[i.key] || ''}
                    placeholder={i.secret ? (i.isSet ? 'saved — type to replace' : (i.key === 'TATVAOS_MAIL_KEY' ? 'tvos_…' : '')) : (i.key === 'MAIL_FROM' ? 'admissions@your-domain.com' : i.key === 'MAIL_REPLY_TO' ? 'same as From if empty' : i.key === 'TRACK_CLOSED_MESSAGE' ? 'Application tracking is temporarily unavailable. Please check back later.' : '')}
                    autoComplete="off"
                    onChange={(e) => setValues({ ...values, [i.key]: e.target.value })}
                  />
                )}
              </label>
            ))}
          </div>
          {g.id === 'sms' && (
            <div className="toolbar" style={{ marginTop: 8 }}>
              <label className="fld" style={{ marginBottom: 0 }}>Send test SMS to
                <input type="text" value={testPhone} onChange={(e) => setTestPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" style={{ width: 170 }} />
              </label>
              <button className="btn ghost" onClick={() => test('sms')} disabled={testPhone.length !== 10}>Send Test SMS</button>
              {testResult.sms && <span className="muted">{testResult.sms}</span>}
            </div>
          )}
          {g.id === 'reports' && (
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="btn ghost" onClick={() => test('report')}>📧 Send Report Now (test)</button>
              {testResult.report && <span className="muted">{testResult.report}</span>}
            </div>
          )}
          {g.id === 'email' && (
            <div className="toolbar" style={{ marginTop: 8 }}>
              <label className="fld" style={{ marginBottom: 0 }}>Send test email to
                <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="you@example.com" style={{ width: 220 }} />
              </label>
              <button className="btn ghost" onClick={() => test('email')} disabled={!testEmail}>Send Test Email</button>
              {testResult.email && <span className="muted">{testResult.email}</span>}
            </div>
          )}
        </div>
      ))}

      <div className="card" style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn green" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save All Settings'}</button>
      </div>
    </div>
  );
}
