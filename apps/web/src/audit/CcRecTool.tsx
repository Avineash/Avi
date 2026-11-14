import { useEffect, useMemo, useRef, useState } from 'react';
import { computeCcRec, emptyCcRec, formatCents, parseCents, type CcRecData } from '@staffhub/audit-core';
import { Button, Card, Icon, Input, Notice, Textarea } from '@staffhub/ui';
import { api, ApiError } from '../api.ts';
import type { AuditApi } from './useAudit.ts';
import type { RunView } from './types.ts';

const toInput = (c: number) => (c === 0 ? '' : (c / 100).toFixed(2));

/**
 * Card reconciliation: PMS card payments vs what the terminals settled, per card, with a tolerance.
 * Amounts are held as text while typing and as whole cents once parsed, so nothing is ever a float.
 */
export function CcRecTool({ a, view, canWrite }: { a: AuditApi; view: RunView; canWrite: boolean }) {
  const [data, setData] = useState<CcRecData | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'approved' | 'rejected'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef<CcRecData | null>(null);

  useEffect(() => { api.get<{ data: CcRecData }>(`/api/audit/run/${view.run.id}/ccrec`).then((r) => { setData(r.data); latest.current = r.data; setDirty(false); }); }, [view.run.id]);
  const result = useMemo(() => (data ? computeCcRec(data) : null), [data]);
  if (!data || !result) return <p className="ds-muted" role="status">Loading…</p>;

  const change = (next: CcRecData) => {
    setData(next); latest.current = next; setDirty(true); setMsg(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };
  async function save() {
    const d = latest.current; if (!d || !canWrite) return;
    try { await api.put(`/api/audit/run/${view.run.id}/ccrec`, d, a.lockHeader()); setDirty(false); setMsg({ tone: 'approved', text: 'Saved.' }); }
    catch (e) { setMsg({ tone: 'rejected', text: e instanceof ApiError ? e.message : 'Could not save.' }); if (e instanceof ApiError && e.code === 'locked') void a.load(true); }
  }
  const money = (id: string, cents: number, set: (c: number) => void, label: string) => {
    const shown = text[id] ?? toInput(cents);
    const bad = shown !== '' && parseCents(shown) === null;
    return (
      <Input inputMode="decimal" value={shown} disabled={!canWrite} aria-label={label} aria-invalid={bad} placeholder="0.00"
        onChange={(e) => { setText({ ...text, [id]: e.target.value }); const c = e.target.value === '' ? 0 : parseCents(e.target.value); if (c !== null) set(c); }}
        onBlur={() => setText((t) => { const { [id]: _drop, ...rest } = t; return rest; })} />
    );
  };

  return (
    <div className="ds-stack">
      <Card title={`Card reconciliation · ${view.run.auditDate}`} actions={
        <div className="ds-row">
          {msg && <span role="status" className="ds-hint">{msg.text}</span>}
          {dirty && canWrite && <Button size="sm" icon="save" onClick={() => void save()}>Save now</Button>}
        </div>}>
        {!canWrite && <Notice tone="info" title="Display only">You can see the figures but not change them.</Notice>}
        <div className="au-scroll">
          <table className="au-cc">
            <thead><tr><th scope="col">Card</th><th scope="col">PMS</th><th scope="col">Terminal · front office</th><th scope="col">Terminal · F&amp;B</th><th scope="col">Terminals total</th><th scope="col">Variance</th></tr></thead>
            <tbody>
              {data.rows.map((r, i) => {
                const x = result.rows[i]!;
                const set = (patch: Partial<typeof r>) => change({ ...data, rows: data.rows.map((y, j) => (j === i ? { ...y, ...patch } : y)) });
                return (
                  <tr key={r.card}>
                    <td>{r.card}</td>
                    <td>{money(`${i}p`, r.pms, (c) => set({ pms: c }), `${r.card} PMS amount`)}</td>
                    <td>{money(`${i}f`, r.terminalFo, (c) => set({ terminalFo: c }), `${r.card} front office terminal`)}</td>
                    <td>{money(`${i}b`, r.terminalFb, (c) => set({ terminalFb: c }), `${r.card} F&B terminal`)}</td>
                    <td className="au-money">{formatCents(x.terminals)}</td>
                    <td className="au-money">
                      <span className="ds-status" data-status={x.balanced ? 'approved' : 'rejected'}><Icon name={x.balanced ? 'check-circle' : 'alert'} size={14} />{formatCents(x.variance)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td>Total</td><td className="au-money">{formatCents(result.totals.pms)}</td><td /><td /><td className="au-money">{formatCents(result.totals.terminals)}</td><td className="au-money">{formatCents(result.totals.variance)}</td></tr>
            </tfoot>
          </table>
        </div>
        <label className="ds-field" style={{ maxWidth: 240 }}>
          <span className="ds-label">Tolerance per card</span>
          {money('tol', data.tolerance, (c) => change({ ...data, tolerance: Math.abs(c) }), 'Tolerance in dollars')}
          <span className="ds-hint">A variance up to this amount counts as balanced.</span>
        </label>
      </Card>

      <Card title="Payment-link payments">
        {data.paylinks.length === 0 && <p className="ds-muted">None recorded. Add any payment-link payments received on the portal so unposted ones are caught.</p>}
        <ul className="ds-list">
          {data.paylinks.map((p, i) => (
            <li key={i} className="ds-list__row">
              <Input value={p.ref} disabled={!canWrite} maxLength={40} placeholder="Reference" aria-label="Reference" style={{ maxWidth: 160 }} onChange={(e) => change({ ...data, paylinks: data.paylinks.map((y, j) => (j === i ? { ...y, ref: e.target.value } : y)) })} />
              <Input value={p.room} disabled={!canWrite} maxLength={12} placeholder="Room" aria-label="Room" style={{ maxWidth: 100 }} onChange={(e) => change({ ...data, paylinks: data.paylinks.map((y, j) => (j === i ? { ...y, room: e.target.value } : y)) })} />
              <div style={{ maxWidth: 140 }}>{money(`pl${i}`, p.amount, (c) => change({ ...data, paylinks: data.paylinks.map((y, j) => (j === i ? { ...y, amount: c } : y)) }), 'Amount')}</div>
              <label className="ds-check"><input type="checkbox" checked={p.posted} disabled={!canWrite} onChange={(e) => change({ ...data, paylinks: data.paylinks.map((y, j) => (j === i ? { ...y, posted: e.target.checked } : y)) })} /><span className="ds-check__label">Posted in PMS</span></label>
              {canWrite && <Button size="sm" variant="ghost" icon="trash" aria-label="Remove payment" onClick={() => change({ ...data, paylinks: data.paylinks.filter((_, j) => j !== i) })} />}
            </li>
          ))}
        </ul>
        {canWrite && <Button size="sm" variant="secondary" icon="plus" onClick={() => change({ ...data, paylinks: [...data.paylinks, { ref: '', room: '', amount: 0, posted: false }] })}>Add payment</Button>}
        {result.unpostedPaylinks > 0 && <Notice tone="rejected" title={`${formatCents(result.unpostedPaylinks)} not yet posted`}>Post these in the PMS before processing the card rec.</Notice>}
      </Card>

      <Card title="Result">
        <Notice tone={result.balanced ? 'approved' : 'rejected'} title={result.balanced ? 'Balanced' : 'Not balanced'}>
          {result.balanced ? 'Every card is within tolerance and all payment links are posted.' : `Total variance ${formatCents(result.totals.variance)}. Investigate the cards marked above before processing.`}
        </Notice>
        <label className="ds-field"><span className="ds-label">Note</span><Textarea value={data.note} disabled={!canWrite} maxLength={1000} onChange={(e) => change({ ...data, note: e.target.value })} placeholder="Explain any variance" /></label>
        {canWrite && <Button variant="ghost" size="sm" icon="reset" onClick={() => change(emptyCcRec())}>Clear all figures</Button>}
      </Card>
    </div>
  );
}
