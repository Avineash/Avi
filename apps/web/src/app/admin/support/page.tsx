'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/money';
import { PageHead } from '@/components/shell';
import { Empty, ErrorBox, Loading, Pill, StatusPill, useToast } from '@/components/ui';

export default function AdminSupport() {
  const toast = useToast(); const { data, loading, error, reload } = useApi<any[]>('/api/admin/tickets'); const [open, setOpen] = useState<string | null>(null); const [body, setBody] = useState('');
  const send = async (id: string, status?: string) => { try { await api(`/api/admin/tickets/${id}/messages`, { body: { body: body || '(status updated)', status } }); setBody(''); reload(); } catch (e) { toast((e as ApiError).message, 'bad'); } };
  return (<><PageHead title="Support tickets" /><ErrorBox error={error} retry={reload} />{loading ? <Loading /> : !data?.length ? <Empty icon="🎧" title="Inbox zero" /> :
    <div className="space-y-3">{data.map((t) => <div key={t.id} className="card p-4"><button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}><span><b>{t.subject}</b> <span className="text-sm text-muted">· {t.restaurant}</span></span><span className="flex items-center gap-2">{t.priority === 'high' && <Pill tone="bad">high</Pill>}<StatusPill s={t.status} /><span className="text-xs text-muted">{dateTime(t.updated_at)}</span></span></button>
      {open === t.id && <div className="mt-3 space-y-3 border-t border-line pt-3">{t.messages.map((m: any, i: number) => <div key={i} className={`rounded-xl p-3 text-sm ${m.author_role === 'platform' ? 'bg-brand/10' : 'bg-sunken'}`}><div className="mb-1 text-xs font-bold text-muted">{m.author_name} · {dateTime(m.created_at)}</div>{m.body}</div>)}
        <textarea className="input min-h-[80px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply to the restaurant…" /><div className="flex flex-wrap gap-2"><button className="btn btn-brand btn-sm" disabled={!body} onClick={() => send(t.id, 'in_progress')}>Reply</button><button className="btn btn-line btn-sm" disabled={!body} onClick={() => send(t.id, 'resolved')}>Reply & resolve</button></div></div>}</div>)}</div>}</>);
}
