import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicApi, errMsg } from '../lib/api.js';
import OtpLogin from '../components/OtpLogin.jsx';

function FileUpload({ field, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    if (file.size > 5 * 1024 * 1024) { setErr('File must be smaller than 5 MB'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await publicApi.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange({ attachmentId: data.id, filename: data.filename, sizeBytes: data.sizeBytes });
    } catch (e2) { setErr(errMsg(e2)); }
    setBusy(false);
  };
  return (
    <div>
      {value?.attachmentId ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 }}>
          <span className="pill on">📎 {value.filename}</span>
          <label className="btn small ghost" style={{ cursor: 'pointer' }}>
            Replace<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" hidden onChange={pick} />
          </label>
        </div>
      ) : (
        <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={pick} disabled={busy} style={{ marginTop: 5 }} />
      )}
      <div className="muted">{busy ? 'Uploading securely…' : 'JPG, PNG or PDF · max 5 MB'}</div>
      {err && <div className="alert err" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  const opts = JSON.parse(field.options || '[]').filter(Boolean);
  const common = { id: `f${field.id}` };
  switch (field.fieldType) {
    case 'file':
      return <FileUpload field={field} value={value} onChange={onChange} />;
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

/** Section-wise step wizard: one section per step, then Review & Submit. */
function Wizard({ form, data, setField, errs, err, busy, submit, hadDraft }) {
  const sections = [...form.template.sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const steps = [...sections.map((s) => s.title), 'Review & Submit'];
  const [step, setStep] = useState(0);
  const [stepErrs, setStepErrs] = useState([]);
  const isReview = step === steps.length - 1;
  const current = sections[step];

  const missingIn = (sec) =>
    sec.fields.filter((fld) => {
      if (!fld.required) return false;
      const v = data[fld.id];
      if (fld.fieldType === 'file') return !(v && typeof v === 'object' && v.attachmentId);
      return v == null || v === '' || (Array.isArray(v) && !v.length);
    });

  const next = () => {
    const missing = missingIn(current);
    if (missing.length) {
      setStepErrs(missing.map((m) => `${m.label} is required`));
      return;
    }
    setStepErrs([]);
    setStep((s) => Math.min(s + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const back = () => { setStepErrs([]); setStep((s) => Math.max(s - 1, 0)); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const jump = (i) => { if (i <= step) { setStepErrs([]); setStep(i); } };

  const displayValue = (fld) => {
    const v = data[fld.id];
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return v.attachmentId ? `📎 ${v.filename}` : '—';
    return String(v);
  };

  return (
    <>
      {hadDraft && step === 0 && <div className="alert ok">Your saved draft was loaded — continue where you left off. The form auto-saves at every step.</div>}

      <div className="steps">
        {steps.map((title, i) => (
          <div key={i} className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} onClick={() => jump(i)}>
            <div className="dot">{i < step ? '✓' : i + 1}</div>
            <div className="lbl">{title}</div>
          </div>
        ))}
      </div>

      {!isReview && (
        <div className="card">
          <div className="section-title">Step {step + 1} of {steps.length}: {current.title}</div>
          {[...current.fields].sort((a, b) => a.sortOrder - b.sortOrder).map((fld) => (
            <label className="fld" key={fld.id} htmlFor={`f${fld.id}`}>
              {fld.label} {fld.required && <span className="req">*</span>}
              <FieldInput field={fld} value={data[fld.id]} onChange={(v) => setField(fld.id, v)} />
            </label>
          ))}
        </div>
      )}

      {isReview && (
        <div className="card">
          <div className="section-title">Review your application before submitting</div>
          {sections.map((sec) => (
            <div key={sec.id} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ color: '#1d4ed8' }}>{sec.title}</b>
                <button className="btn small ghost" onClick={() => jump(sections.indexOf(sec))}>Edit</button>
              </div>
              {sec.fields.map((fld) => (
                <div className="review-item" key={fld.id}>
                  <div className="k">{fld.label}</div>
                  <div className="v">{displayValue(fld)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {stepErrs.length > 0 && (
        <div className="alert err">
          <b>Please complete this step:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{stepErrs.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {errs.length > 0 && (
        <div className="alert err">
          <b>Please fix the following:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>{errs.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {err && <div className="alert err">{err}</div>}

      <div className="card wizard-nav">
        <button className="btn ghost" onClick={back} disabled={step === 0}>← Back</button>
        <div className="muted" style={{ textAlign: 'center' }}>
          {isReview
            ? Number(form.price) > 0
              ? form.onlinePaymentEnabled
                ? <>Pay <b>₹{Number(form.price).toFixed(0)}</b> {form.mockPayment ? '(dev: mock payment)' : 'securely via Razorpay'} to complete submission.</>
                : <>Form fee ₹{Number(form.price).toFixed(0)} — payable at the school office.</>
              : 'This form is free.'
            : `Step ${step + 1} of ${steps.length}`}
        </div>
        {isReview ? (
          <button className="btn green" onClick={submit} disabled={busy}>
            {busy ? 'Submitting…' : Number(form.price) > 0 && form.onlinePaymentEnabled ? 'Pay & Submit' : 'Submit Form'}
          </button>
        ) : (
          <button className="btn" onClick={next}>Save & Continue →</button>
        )}
      </div>
    </>
  );
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
        <Wizard
          form={form}
          data={data}
          setField={setField}
          errs={errs}
          err={err}
          busy={busy}
          submit={submit}
          hadDraft={!!draftInfo?.isDraft}
        />
      )}
    </div>
  );
}
