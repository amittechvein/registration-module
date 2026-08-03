import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, errMsg } from '../lib/api.js';

const STATUS_COLORS = {
  paid: '#16a34a', mock_paid: '#16a34a', captured: '#16a34a',
  created: '#64748b', failed: '#dc2626', authorized: '#d97706',
  superseded: '#94a3b8', refunded: '#7c3aed', partial_refund: '#7c3aed',
};

export default function Payments() {
  const [rows, setRows] = useState([]);
  const [live, setLive] = useState({});
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => adminApi.get('/payments').then((r) => setRows(r.data)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const hay = [r.paymentId, r.orderId, r.formNo, r.applicant, r.phone, r.form].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const refresh = async () => {
    setBusy(true); setErr('');
    try {
      const ids = filtered.slice(0, 100).map((r) => r.id);
      const { data } = await adminApi.post('/payments/refresh', { ids });
      setLive((l) => ({ ...l, ...data.live }));
      load();
    } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  };

  const liveBadge = (r) => {
    const info = live[r.id];
    if (!info) return <span className="muted">— press Refresh —</span>;
    if (info.error) return <span style={{ color: '#dc2626', fontSize: 11.5 }}>{info.error}</span>;
    const refund = info.refundStatus === 'full' ? 'REFUNDED' : info.refundStatus === 'partial' ? `PARTIAL REFUND ₹${info.amountRefunded}` : null;
    return (
      <>
        <span className="badge" style={{ background: STATUS_COLORS[info.status] || '#64748b' }}>{info.status}</span>
        {info.method && <span className="muted" style={{ marginLeft: 6 }}>{info.method}</span>}
        {refund && <div style={{ color: '#7c3aed', fontWeight: 700, fontSize: 11.5, marginTop: 2 }}>↩ {refund}</div>}
      </>
    );
  };

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Payments</h1>
          <div className="muted">Every Razorpay order & payment with its owner — press "Refresh live status" to pull captured / authorized / refunded states from Razorpay. Refunds themselves are issued from the Razorpay dashboard using the Payment ID.</div>
        </div>
        <button className="btn" onClick={refresh} disabled={busy}>{busy ? '⏳ Checking Razorpay…' : '↻ Refresh live status'}</button>
      </div>
      {err && <div className="alert err">{err}</div>}

      <div className="card">
        <div className="toolbar">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payment id / order id / form no / name / phone…" style={{ width: 340 }} />
          <span className="muted" style={{ marginLeft: 'auto' }}>{filtered.length} of {rows.length} payment order(s)</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Payment ID</th><th>Order ID</th><th>Form No</th><th>Applicant</th>
              <th>Amount</th><th>Our Status</th><th>Live Razorpay Status</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{r.paymentId || '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11.5 }} className="muted">{r.orderId}</td>
                <td>{r.submissionId ? <Link to={`/admin/submissions/${r.submissionId}`}><b>{r.formNo}</b></Link> : r.formNo}</td>
                <td>{r.applicant || '—'}<div className="muted">{r.phone}</div></td>
                <td><b>₹{r.amount.toFixed(0)}</b></td>
                <td><span className="badge" style={{ background: STATUS_COLORS[r.status] || '#64748b' }}>{r.status}</span></td>
                <td>{liveBadge(r)}</td>
                <td className="muted">{new Date(r.createdAt).toLocaleString('en-IN')}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 18 }}>No payments match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
