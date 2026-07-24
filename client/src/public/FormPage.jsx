import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { publicApi, errMsg } from '../lib/api.js';
import OtpLogin from '../components/OtpLogin.jsx';
import PubShell from '../components/PubShell.jsx';

const isImageName = (n) => /\.(jpe?g|png|webp)$/i.test(n || '');
// Photo & signature fields accept images only (no PDF)
const isImageOnlyField = (label) => /photo|photograph|signature/i.test(label || '');
// The student's own Date-of-Birth field (not father's/mother's DOB)
const isDobField = (fld) => fld.studentField === 'dob' || /^date of birth$/i.test(String(fld.label || '').trim());
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };

// Auto-fill rules (configured in the admin Template Builder):
// a select/radio field computed from a number field via ranges, e.g.
// distance → locality code. Locked rules can't be changed by the parent.
const parseAutoRules = (template) => {
  const fields = template.sections.flatMap((s) => s.fields);
  const out = [];
  for (const f of fields) {
    if (!f.autoFill) continue;
    let rule; try { rule = typeof f.autoFill === 'string' ? JSON.parse(f.autoFill) : f.autoFill; } catch { continue; }
    if (!rule || !rule.sourceLabel) continue;
    const src = fields.find((x) => x.label === rule.sourceLabel);
    if (!src) continue;
    out.push({ targetId: f.id, sourceId: src.id, sourceLabel: src.label, rule });
  }
  return out;
};
const computeAuto = (rule, raw) => {
  const num = Number(raw);
  if (raw == null || raw === '' || Number.isNaN(num)) return undefined;
  const sorted = [...(rule.ranges || [])]
    .filter((r) => r.upTo !== '' && r.upTo != null)
    .sort((a, b) => Number(a.upTo) - Number(b.upTo));
  for (const r of sorted) if (num <= Number(r.upTo)) return r.value;
  return rule.above || undefined;
};

function FileUpload({ field, value, onChange }) {
  const imageOnly = isImageOnlyField(field.label);
  const accept = imageOnly ? '.jpg,.jpeg,.png,.webp' : '.jpg,.jpeg,.png,.webp,.pdf';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);

  // Restore image preview when a saved draft is reloaded
  useEffect(() => {
    let url;
    if (value?.attachmentId && isImageName(value.filename)) {
      fetch(`/api/public/uploads/${value.attachmentId}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('applicantToken')}` },
      })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => { if (b) { url = URL.createObjectURL(b); setPreview(url); } })
        .catch(() => {});
    } else {
      setPreview(null);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [value?.attachmentId]); // eslint-disable-line

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    if (imageOnly && !file.type.startsWith('image/')) { setErr('Only image files (JPG/PNG) are allowed for this field'); e.target.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { setErr('File must be smaller than 5 MB'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await publicApi.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange({ attachmentId: data.id, filename: data.filename, sizeBytes: data.sizeBytes });
      if (file.type.startsWith('image/')) setPreview(URL.createObjectURL(file));
    } catch (e2) { setErr(errMsg(e2)); }
    setBusy(false);
  };
  return (
    <div>
      {value?.attachmentId ? (
        <div style={{ marginTop: 5 }}>
          {preview && <img className="upload-preview" src={preview} alt={field.label} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
            <span className="pill on">📎 {value.filename}</span>
            <label className="btn small ghost" style={{ cursor: 'pointer' }}>
              Replace<input type="file" accept={accept} hidden onChange={pick} />
            </label>
          </div>
        </div>
      ) : (
        <input type="file" accept={accept} onChange={pick} disabled={busy} style={{ marginTop: 5 }} />
      )}
      <div className="muted">{busy ? 'Uploading securely…' : imageOnly ? 'Image only — JPG or PNG · max 5 MB' : 'JPG, PNG or PDF · max 5 MB'}</div>
      {err && <div className="alert err" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function FieldInput({ field, value, onChange, dob }) {
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
      return <input {...common} type="date" min={dob?.min || undefined} max={dob?.max || undefined} value={value || ''} onChange={(e) => onChange(e.target.value)} />;
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
function Wizard({ form, data, setField, errs, err, busy, submit, hadDraft, autoMeta = {} }) {
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

  // Date-of-birth eligibility check, enforced immediately on the step itself
  const dobIssuesIn = (sec) => {
    if (!form.dob) return [];
    const out = [];
    for (const fld of sec.fields) {
      if (fld.fieldType !== 'date' || !isDobField(fld)) continue;
      const v = data[fld.id];
      if (!v) continue;
      if (form.dob.min && v < form.dob.min) out.push(`${fld.label}: must be on or after ${fmtDate(form.dob.min)} — this child is not eligible for this class`);
      if (form.dob.max && v > form.dob.max) out.push(`${fld.label}: must be on or before ${fmtDate(form.dob.max)} — this child is not eligible for this class`);
    }
    return out;
  };

  const next = () => {
    const problems = [
      ...missingIn(current).map((m) => `${m.label} is required`),
      ...dobIssuesIn(current),
    ];
    if (problems.length) {
      setStepErrs(problems);
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
      {/* Instructions appear on the FIRST step only */}
      {step === 0 && form.instructionsHtml && (
        <div className="card instructions">
          <h3>Instructions</h3>
          <div dangerouslySetInnerHTML={{ __html: form.instructionsHtml }} />
        </div>
      )}
      {step === 0 && form.dob && (
        <div className="alert ok">Eligibility: date of birth must be between <b>{form.dob.min ? fmtDate(form.dob.min) : 'any'}</b> and <b>{form.dob.max ? fmtDate(form.dob.max) : 'any'}</b>.</div>
      )}
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
          <div className="fields-grid">
            {[...current.fields].sort((a, b) => a.sortOrder - b.sortOrder).map((fld) => {
              let opts = []; try { opts = JSON.parse(fld.options || '[]'); } catch {}
              const wide = ['textarea', 'checkbox'].includes(fld.fieldType)
                || fld.label.length > 58
                || (fld.fieldType === 'radio' && opts.join('').length > 24);
              return (
                <label className={`fld ${wide ? 'span-all' : ''}`} key={fld.id} htmlFor={`f${fld.id}`}>
                  {fld.label} {fld.required && <span className="req">*</span>}
                  {autoMeta[fld.id]?.locked ? (
                    <>
                      <div className="auto-locked">{data[fld.id] || '—'}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>🔒 Auto-calculated from "{autoMeta[fld.id].sourceLabel}" — set by school rules.</div>
                    </>
                  ) : (
                    <>
                      <FieldInput field={fld} value={data[fld.id]} onChange={(v) => setField(fld.id, v)} dob={fld.fieldType === 'date' && isDobField(fld) ? form.dob : null} />
                      {autoMeta[fld.id] && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>⚡ Auto-filled from "{autoMeta[fld.id].sourceLabel}" — change only if needed.</div>}
                    </>
                  )}
                </label>
              );
            })}
          </div>
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
  const [draft, setDraft] = useState(null);          // in-progress draft {id, data}
  const [submitted, setSubmitted] = useState([]);    // previously submitted forms
  const [started, setStarted] = useState(false);     // wizard visible
  const [wizKey, setWizKey] = useState(0);           // remount wizard for a fresh application
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

  // load draft + previous submissions after login
  useEffect(() => {
    if (loggedIn && form) {
      publicApi.get(`/forms/${slug}/draft`).then((r) => {
        const d = r.data || {};
        setSubmitted(d.submitted || []);
        if (d.draft) {
          setDraft(d.draft);
          setData(d.draft.data || {});
          setStarted(true);
        } else if (!(d.submitted || []).length) {
          setStarted(true); // first-time applicant → straight into the form
        }
      }).catch(() => setLoggedIn(false));
    }
  }, [loggedIn, form, slug]);

  // Begin a brand-new application (multiple children from the same number)
  const startNew = () => {
    setData({}); setDraft(null); setFormNo(''); setOk(''); setErr(''); setErrs([]);
    setStarted(true); setWizKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Auto-fill rules configured on the template (e.g. distance → locality code)
  const autoRules = useMemo(() => (form ? parseAutoRules(form.template) : []), [form]);
  const autoMeta = useMemo(() => {
    const m = {};
    for (const r of autoRules) {
      m[r.targetId] = { locked: !!r.rule.locked, sourceLabel: r.sourceLabel };
    }
    return m;
  }, [autoRules]);

  // autosave draft (half-filled forms can be resumed)
  const setField = (fieldId, value) => {
    setData((d) => {
      const next = { ...d, [fieldId]: value };
      // Recompute every auto-filled field that depends on the changed field
      for (const r of autoRules) {
        if (r.sourceId !== fieldId) continue;
        const v = computeAuto(r.rule, value);
        next[r.targetId] = v !== undefined ? v : '';
      }
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
        setSubmitted((list) => [{ formNo: v.formNo }, ...list]);
      } else {
        setFormNo(res.formNo);
        setOk(`Form submitted! Your form number is ${res.formNo}.`);
        setSubmitted((list) => [{ formNo: res.formNo }, ...list]);
      }
      setDraft(null); setStarted(false);
    } catch (e) {
      const list = e.response?.data?.errors;
      if (list) setErrs(list);
      else setErr(errMsg(e));
    }
    setBusy(false);
  };

  if (closed) return (
    <PubShell><div className="pub-header"><h1>{closed}</h1></div>
      <div className="alert err">This form is currently closed for submissions.</div>
      <Link to="/">← All forms</Link>
    </PubShell>
  );
  if (!form) return <PubShell>{err ? <div className="alert err">{err}</div> : 'Loading…'}</PubShell>;

  return (
    <PubShell>
      <div className="pub-header">
        <div className="pub-brand">
          <img className="pub-logo" src="/api/public/logo" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <div>
            <h1>{form.title}</h1>
            <div style={{ opacity: 0.92, fontSize: 14 }}>{form.className} · Session {form.session} {Number(form.price) > 0 && <> · Form fee ₹{Number(form.price).toFixed(0)}</>}</div>
          </div>
        </div>
      </div>

      {/* Before login: show instructions so parents can read them first */}
      {!loggedIn && form.instructionsHtml && (
        <div className="card instructions">
          <h3>Instructions</h3>
          <div dangerouslySetInnerHTML={{ __html: form.instructionsHtml }} />
        </div>
      )}
      {!loggedIn && form.dob && (
        <div className="alert ok">Eligibility: date of birth must be between <b>{form.dob.min ? fmtDate(form.dob.min) : 'any'}</b> and <b>{form.dob.max ? fmtDate(form.dob.max) : 'any'}</b>.</div>
      )}

      {!loggedIn && <OtpLogin onLoggedIn={() => setLoggedIn(true)} />}

      {/* Just-submitted success */}
      {loggedIn && formNo && (
        <div className="card">
          <div className="alert ok">{ok}</div>
          <p>Your form number: <b style={{ fontSize: 20 }}>{formNo}</b></p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="btn" to="/track">Track your application →</Link>
            <button className="btn ghost" onClick={startNew}>➕ Submit Another Application</button>
          </div>
        </div>
      )}

      {/* Previously submitted forms from this mobile number */}
      {loggedIn && !formNo && submitted.length > 0 && (
        <div className="card">
          <b>Applications already submitted from this mobile number:</b>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 10px' }}>
            {submitted.map((x, i) => <span key={i} className="pill on">📄 {x.formNo || '(processing)'}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link className="btn ghost" to="/track">Track applications</Link>
            {!started && <button className="btn" onClick={startNew}>➕ Fill a New Application (another child)</button>}
          </div>
        </div>
      )}

      {loggedIn && !formNo && started && (
        <Wizard
          key={wizKey}
          form={form}
          data={data}
          setField={setField}
          errs={errs}
          err={err}
          busy={busy}
          submit={submit}
          hadDraft={!!draft}
          autoMeta={autoMeta}
        />
      )}
    </PubShell>
  );
}
