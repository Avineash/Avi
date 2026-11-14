'use client';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/money';
import { PageHead } from '@/components/shell';
import { Empty, ErrorBox, Loading } from '@/components/ui';

export default function Feedback() {
  const { data, loading, error, reload } = useApi<any[]>('/api/r/feedback');
  const avg = data?.length ? (data.reduce((s, f) => s + f.rating, 0) / data.length).toFixed(2) : null;
  return (<>
    <PageHead title="Customer feedback" sub={avg ? `${avg} ★ average over ${data!.length} reviews` : undefined} />
    <ErrorBox error={error} retry={reload} />
    {loading ? <Loading /> : !data?.length ? <Empty icon="⭐" title="No feedback yet">Customers are invited to rate their order once it is ready.</Empty> :
      <ul className="space-y-3">{data.map((f) => <li key={f.id} className="card p-4"><div className="flex items-center justify-between"><span className="text-lg text-brand2" aria-label={`${f.rating} out of 5`}>{'★'.repeat(f.rating)}<span className="text-line">{'★'.repeat(5 - f.rating)}</span></span><span className="text-xs text-muted">Order #{f.number} · {dateTime(f.created_at)}</span></div>{f.comment && <p className="mt-2">{f.comment}</p>}</li>)}</ul>}
  </>);
}
