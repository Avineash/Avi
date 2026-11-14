'use client';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/money';
import { PageHead } from '@/components/shell';
import { ErrorBox, Loading } from '@/components/ui';

export default function Audit() {
  const { data, loading, error, reload } = useApi<any[]>('/api/admin/audit');
  return (<><PageHead title="Audit log" sub="Append-only record of sensitive actions across all restaurants" /><ErrorBox error={error} retry={reload} />{loading ? <Loading /> :
    <div className="card overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="text-left text-xs uppercase text-muted"><th className="p-3">When</th><th>Actor</th><th>Restaurant</th><th>Action</th><th className="p-3">Detail</th></tr></thead>
      <tbody>{data?.map((a) => <tr key={a.id} className="border-t border-line align-top"><td className="p-3 whitespace-nowrap">{dateTime(a.created_at)}</td><td>{a.actor ?? 'system'} <span className="text-xs text-muted">{a.actor_role}</span></td><td>{a.restaurant ?? '—'}</td><td className="font-mono text-xs">{a.action}</td><td className="p-3 text-xs text-muted">{JSON.stringify(a.meta).slice(0, 120)}</td></tr>)}</tbody></table></div>}</>);
}
