import React, { useState } from 'react';
import { publicApi, errMsg } from '../lib/api.js';
import GoogleButton from './GoogleButton.jsx';

/** Phone-OTP login (OTP sent by SMS + email) or Google sign-in. */
export default function OtpLogin({ onLoggedIn, askProfile = true }) {
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [sentToEmail, setSentToEmail] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const requestOtp = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const { data } = await publicApi.post('/auth/request-otp', { phone, email });
      setDevOtp(data.devOtp || '');
      setSentToEmail(!!data.sentToEmail);
      setStep(2);
    } catch (e2) { setErr(errMsg(e2)); }
    setBusy(false);
  };

  const google = async (credential) => {
    setErr('');
    try {
      const { data } = await publicApi.post('/auth/google', { credential });
      sessionStorage.setItem('applicantToken', data.token);
      sessionStorage.setItem('applicantPhone', data.applicant.phone || '');
      onLoggedIn(data.applicant);
    } catch (e2) { setErr(errMsg(e2)); }
  };

  const verify = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const { data } = await publicApi.post('/auth/verify-otp', { phone, otp, name, email });
      sessionStorage.setItem('applicantToken', data.token);
      sessionStorage.setItem('applicantPhone', data.applicant.phone);
      onLoggedIn(data.applicant);
    } catch (e2) { setErr(errMsg(e2)); }
    setBusy(false);
  };

  return (
    <div className="card">
      <h3>Login with your mobile number</h3>
      <p className="muted">Your application account is created automatically from your phone number — use the same number to save drafts and track your status.</p>
      {err && <div className="alert err">{err}</div>}
      {step === 1 && (
        <form onSubmit={requestOtp}>
          <div className="grid cols-2">
            <label className="fld">Mobile number
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" />
            </label>
            <label className="fld">Email (optional — OTP will also be emailed)
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
          </div>
          <button className="btn" disabled={busy || phone.length !== 10}>Send OTP</button>
          <GoogleButton role="applicant" onCredential={google} />
        </form>
      )}
      {step === 2 && (
        <form onSubmit={verify}>
          {devOtp && <div className="alert ok">Dev mode — your OTP is <b>{devOtp}</b></div>}
          {sentToEmail && <div className="alert ok">OTP sent to your mobile by SMS and to your email.</div>}
          <label className="fld">Enter OTP sent to {phone}
            <input type="text" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit OTP" />
          </label>
          {askProfile && (
            <div className="grid cols-2">
              <label className="fld">Your name
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Parent/guardian name" />
              </label>
              <label className="fld">Email (for updates)
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
            </div>
          )}
          <button className="btn" disabled={busy || otp.length !== 6}>Verify & Continue</button>{' '}
          <button type="button" className="btn ghost" onClick={() => setStep(1)}>Change number</button>
        </form>
      )}
    </div>
  );
}
