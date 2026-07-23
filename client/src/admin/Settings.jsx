import React, { useEffect, useState } from 'react';
import { adminApi, errMsg } from '../lib/api.js';

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
    id: 'email', title: 'Email (SMTP)',
    hint: 'Any SMTP provider works (Gmail: smtp.gmail.com, port 587, app password). Leave empty to log emails to the server console instead of sending.',
  },
  {
    id: 'auth', title: 'Login Options (Google Sign-In)',
    hint: 'Create an OAuth Client ID at console.cloud.google.com → APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application, and add https://form.techvein.org to "Authorized JavaScript origins". Paste the Client ID here — a "Sign in with Google" button then appears on both the parent portal and admin login. Admin Google login only works for emails that exist in Users.',
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

  const load = async () => {
    const [s, st] = await Promise.all([adminApi.get('/settings'), adminApi.get('/settings/status')]);
    setItems(s.data);
    setValues(Object.fromEntries(s.data.map((i) => [i.key, i.value ?? ''])));
    setStatus(st.data);
  };
  useEffect(() => { load().catch((e) => setMsg({ type: 'err', text: errMsg(e) })); }, []);

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
      <div className="topbar">
        <div>
          <h1>Settings</h1>
          <div className="muted">SMS, Email and Razorpay configuration — stored securely, applied instantly</div>
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

      {GROUPS.map((g) => (
        <div className="card" key={g.id}>
          <h3>{g.title}</h3>
          <div className="muted" style={{ marginBottom: 12 }}>{g.hint}</div>
          <div className="grid cols-3">
            {items.filter((i) => i.group === g.id).map((i) => (
              <label className="fld" key={i.key}>
                {i.label} {i.secret && i.isSet && <span className="pill on">set</span>}
                {i.key === 'DEV_SHOW_OTP' ? (
                  <select value={values[i.key] || 'true'} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })}>
                    <option value="true">ON — show OTP on screen (testing)</option>
                    <option value="false">OFF — send by SMS only (production)</option>
                  </select>
                ) : (
                  <input
                    type={i.secret ? 'password' : 'text'}
                    value={values[i.key] || ''}
                    placeholder={i.secret ? (i.isSet ? 'saved — type to replace' : '') : ''}
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
