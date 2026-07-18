import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicApi, errMsg } from '../lib/api.js';
import OtpLogin from '../components/OtpLogin.jsx';

function FieldInput({ field, value, onChange }) {
  const opts = JSON.parse(field.options || '[]').filter(Boolean);
  const common = { id: `f${field.id}` };
  switch (field.fieldType) {
    case 'textarea':
      return <textarea {...common} rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select {...common} value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'radio':
      return (
        <div>
          {opts.map((o) => (
            <label className="check" key={o}>
              <input type="radio" name={`f${field.id}`} checked={value === o} onChange={() => onChange(o)} /> {o}
            </label>
          ))}
        </div>
      );
    case 'checkbox':
      return (
        <div>
          {opts.map((o) => {
            const arr = Array.isArray(value) ? value : [];
            return (
              <label className="check" key={o}>
                <input type="checkbox" checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} /> {o}
              </label>
            );
          })}
        </div>
      );
    case 'date':
      return <input {...common} type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input {...common} type="number" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input {...common} type="email" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input {...common} type="text" value={value || ''} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit mobile" />;
    default:
      return <input {...common} type="text" value={value || ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function FormPage() {
  const { slug } = useParams();
  const [form, setForm] = useState(null);
  const [closed, setClosed] = useState('');
  const [loggedIn, setLoggedIn] = useState(!!sessionStorage.getItem('applicantToken'));
  const [data, setData] = useState({});
  const [draftInfo, setDraftInfo] = useState(null);
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState([]);
  const [ok, setOk] = useState('');
  const [formNo, setFormNo] = useState('');
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    publicApi.get(`/forms/${slug}`)
      .then((r) => setForm(r.data))
      .catch((e) => {
        if (e.response?.data?.closed) setClosed(e.response.data.title);
        else setErr(errMsg(e));
      });
  }, [slug]);

  // load draft after login
  useEffect(() => {
    if (loggedIn && form) {
      publicApi.get(`/forms/${slug}/draft`).then((r) => {
        if (r.data) {
          setDraftInfo(r.data);
          setData(r.data.data || {});
          if (!r.data.isDraft) setFormNo(r.data.formNo);
        }
      }).catch(() => setLoggedIn(false));
    }
  }, [loggedIn, form, slug]);

  // autosave draft (half-filled forms can be resumed)
  const setField = (fieldId, value) => {
    setData((d) => {
      const next = { ...d, [fieldId]: value };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        publicApi.post(`/forms/${slug}/draft`, { data: next }).catch(() => {});
      }, 800);
      return next;
    });
  };

  const openRazorpay = (order, keyId) =>
    new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: keyId,
        amount: order.amount,
        currency: order.currency,
        name: form.title,
        order_id: order.id,
        handler: (resp) => resolve(resp),
        modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
        prefill: { contact: sessionStorage.getItem('applicantPhone') || '' },
      });
      rzp.open();
    });

  const submit = async () => {
    setErr(''); setErrs([]); setOk(''); setBusy(true);
    try {
      const { data: res } = await publicApi.post(`/forms/${slug}/submit`, { data });
      if (res.requiresPayment) {
        let verifyBody;
        if (res.mock) {
          // Development mode: no Razorpay keys configured — simulate payment
          verifyBody = { orderId: res.order.id, paymentId: 'pay_mock', signature: 'mock' };
        } else {
          const resp = await openRazorpay(res.order, res.keyId);
          verifyBody = { orderId: res.order.id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature };
        }
        const { data: v } = await publicApi.post(`/forms/${slug}/payment/verify`, verifyBody);
        setFormNo(v.formNo);
        setOk(`Payment successful! Your form number is ${v.formNo}.`);
      } else {
        setFormNo(res.formNo);
        setOk(`Form submitted! Your form number is ${res.formNo}.`);
      }
    } catch (e) {
      const list = e.response?.data?.errors;
      if (list) setErrs(list);
      else setErr(errMsg(e));
    }
    setBusy(false);
  };

  if (closed) return (
    <div className="pub-wrap"><div className="pub-header"><h1>{closed}</h1></div>
      <div className="alert err">This form is currently closed for submissions.</div>
      <Link to="/">← All forms</Link>
    </div>
  );
  if (!form) return <div className="pub-wrap">{err ? <div className="alert err">{err}</div> : 'Loading…'}</div>;

  const alreadySubmitted = draftInfo && !draftInfo.isDraft;

  return (
    <div className="pub-wrap">
      <div className="pub-header">
        <h1>{form.title}</h1>
        <div style={{ opacity: 0.92 }}>{form.className} · Session {form.session} {Number(form.price) > 0 && <> · Form fee ₹{Number(form.price).toFixed(0)}</>}</div>
      </div>

      {form.instructionsHtml && (
        <div className="card instructions">
          <h3>Instructions</h3>
          <div dangerouslySetInnerHTML={{ __html: form.instructionsHtml }} />
        </div>
      )}
      {form.dob && (
        <div className="alert ok">Eligibility: date of birth must be between <b>{form.dob.min || 'any'}</b> and <b>{form.dob.max || 'any'}</b>.</div>
      )}

      {!loggedIn && <OtpLogin onLoggedIn={() => setLoggedIn(true)} />}

      {loggedIn && (formNo || alreadySubmitted) && (
        <div className="card">
          <div className="alert ok">{ok || `This form has already been submitted.`}</div>
          <p>Your form number: <b style={{ fontSize: 20 }}>{formNo || draftInfo?.formNo}</b></p>
          <Link className="btn" to="/track">Track your application →</Link>
        </div>
      )}

      {loggedIn && !formNo && !alreadySubmitted && (
        <>
          {draftInfo?.isDraft && <div className="alert ok">Your saved draft was loaded — you can continue where you left off. The form auto-saves as you type.</div>}
          {form.template.sections.sort((a, b) => a.sortOrder - b.sortOrder).map((sec) => (
            <div className="card" key={sec.id}>
              <div className="section-title">{sec.title}</div>
              {sec.fields.sort((a, b) => a.sortOrder - b.sortOrder).map((fld) => (
                <label className="fld" key={fld.id} htmlFor={`f${fld.id}`}>
                  {fld.label} {fld.required && <span className="req">*</span>}
                  <FieldInput field={fld} value={data[fld.id]} onChange={(v) => setField(fld.id, v)} />
                </label>
              ))}
            </div>
          ))}
          {errs.length > 0 && (
            <div className="alert err">
              <b>Please fix the following:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{errs.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {err && <div className="alert err">{err}</div>}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="muted">
              {Number(form.price) > 0
                ? form.onlinePaymentEnabled
                  ? <>You will be asked to pay <b>₹{Number(form.price).toFixed(0)}</b> {form.mockPayment ? '(dev: mock payment)' : 'via Razorpay'} to complete submission.</>
                  : <>Form fee ₹{Number(form.price).toFixed(0)} — payable offline at the school office.</>
                : 'This form is free.'}
            </div>
            <button className="btn green" onClick={submit} disabled={busy}>
              {busy ? 'Submitting…' : Number(form.price) > 0 && form.onlinePaymentEnabled ? 'Pay & Submit' : 'Submit Form'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
