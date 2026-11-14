'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/money';
import { PageHead } from '@/components/shell';
import { Empty, ErrorBox, Loading, Sheet, StatusPill, useToast } from '@/components/ui';

export default function Support() {
  const toast = useToast(); const { data, loading, error, reload } = useApi<any[]>('/api/r/tickets');
  const [f, setF] = useState<any>(null); const [open, setOpen] = useState<string | null>(null); const [reply, setReply] = useState('');
  return (<>
    <PageHead title="Support" sub="Talk to the TableFlow team — payments, onboarding, anything." actions={<button className="btn btn-brand btn-sm" onClick={() => setF({ subject: '', body: '', priority: 'normal' })}>+ New ticket</button>} />
    <ErrorBox error={error} retry={reload} />{loading ? <Loading /> : !data?.length ? <Empty icon="💬" title="No tickets">Need help? Open a ticket and we will reply here.</Empty> :
      <div className="space-y-3">{data.map((t) => (<div key={t.id} className="card p-4"><button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}><span className="font-bold">{t.subject}</span><span className="flex items-center gap-2"><StatusPill s={t.status} /><span className="text-xs text-muted">{dateTime(t.updated_at)}</span></span></button>
        {open === t.id && <div className="mt-3 space-y-3 border-t border-line pt-3">{t.messages.map((m: any, i: number) => <div key={i} className={`rounded-xl p-3 text-sm ${m.author_role === 'platform' ? 'bg-brand/10' : 'bg-sunken'}`}><div className="mb-1 text-xs font-bold text-muted">{m.author_role === 'platform' ? 'TableFlow support' : m.author_name} · {dateTime(m.created_at)}</div>{m.body}</div>)}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await api(`/api/r/tickets/${t.id}/messages`, { body: { body: reply } }); setReply(''); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } }}><input className="input" required value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" /><button className="btn btn-brand">Send</button></form></div>}</div>))}</div>}
    <Sheet open={!!f} onClose={() => setF(null)} title="New support ticket">{f && <form className="space-y-4 p-5" onSubmit={async (e) => { e.preventDefault(); try { await api('/api/r/tickets', { body: f }); setF(null); toast('Ticket sent'); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } }}>
      <input className="input" required minLength={3} placeholder="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /><textarea className="input min-h-[120px]" required minLength={3} placeholder="How can we help?" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High — customers affected</option></select><button className="btn btn-brand w-full">Send</button></form>}</Sheet>
  </>);
}
