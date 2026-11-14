'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { tr } from '@/lib/i18n';
import { lkr } from '@/lib/money';
import { PageHead } from '@/components/shell';
import { Confirm, Empty, ErrorBox, Field, Loading, Pill, Sheet, Spinner, Toggle, useToast } from '@/components/ui';
import { FoodImg } from '@/components/customer';

type L = { en: string; si: string; ta: string };
const blank = (): L => ({ en: '', si: '', ta: '' });
interface Draft { id?: string; categoryId: string; name: L; description: L; priceCents: number; imageUrl: string | null; prepMinutes: number; tags: string[]; available: boolean; optionGroups: { name: L; min: number; max: number; options: { name: L; priceDeltaCents: number; available: boolean }[] }[] }

function LText({ label, v, on, area }: { label: string; v: L; on: (v: L) => void; area?: boolean }) {
  return <div><span className="label">{label}</span><div className="space-y-2">{(['en', 'si', 'ta'] as const).map((k) => area
    ? <textarea key={k} className="input min-h-[60px]" placeholder={k === 'en' ? 'English' : k === 'si' ? 'සිංහල' : 'தமிழ்'} maxLength={400} value={v[k] ?? ''} onChange={(e) => on({ ...v, [k]: e.target.value })} />
    : <input key={k} className="input" placeholder={k === 'en' ? 'English (required)' : k === 'si' ? 'සිංහල' : 'தமிழ்'} required={k === 'en'} maxLength={120} value={v[k] ?? ''} onChange={(e) => on({ ...v, [k]: e.target.value })} />)}</div></div>;
}

export default function MenuAdmin() {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<any[]>('/api/r/menu');
  const [d, setD] = useState<Draft | null>(null); const [busy, setBusy] = useState(false); const [up, setUp] = useState(false);
  const [cat, setCat] = useState<{ id?: string; name: L } | null>(null); const [del, setDel] = useState<any>(null);

  const edit = (it: any, categoryId: string) => setD({ id: it.id, categoryId, name: { ...blank(), ...it.name }, description: { ...blank(), ...it.description }, priceCents: it.priceCents, imageUrl: it.imageUrl, prepMinutes: it.prepMinutes, tags: it.tags, available: it.available,
    optionGroups: it.optionGroups.map((g: any) => ({ name: { ...blank(), ...g.name }, min: g.min, max: g.max, options: g.options.map((o: any) => ({ name: { ...blank(), ...o.name }, priceDeltaCents: o.priceDeltaCents, available: o.available })) })) });
  const fresh = (categoryId: string): Draft => ({ categoryId, name: blank(), description: blank(), priceCents: 0, imageUrl: null, prepMinutes: 10, tags: [], available: true, optionGroups: [] });

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!d) return; setBusy(true);
    try {
      const body = { categoryId: d.categoryId, name: d.name, description: d.description, priceCents: d.priceCents, imageUrl: d.imageUrl, available: d.available, tags: d.tags, prepMinutes: d.prepMinutes, optionGroups: d.optionGroups };
      if (d.id) await api(`/api/r/items/${d.id}`, { method: 'PUT', body }); else await api('/api/r/items', { body });
      toast('Saved'); setD(null); reload();
    } catch (ex) { toast((ex as ApiError).data?.issues?.[0] ? `${(ex as ApiError).data.issues[0].path}: ${(ex as ApiError).data.issues[0].message}` : (ex as ApiError).message, 'bad'); } finally { setBusy(false); }
  }
  async function upload(f: File) {
    setUp(true);
    try { const fd = new FormData(); fd.append('file', f); const r = await fetch('/api/r/uploads', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'x-tf-csrf': '1' } }); const j = await r.json(); if (!r.ok) throw new Error(j.message); setD((x) => x && { ...x, imageUrl: j.url }); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setUp(false); }
  }
  const quick = async (id: string, available: boolean) => { try { await api(`/api/r/items/${id}/availability`, { method: 'PATCH', body: { available } }); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } };

  return (
    <>
      <PageHead title="Menu" sub="Names in Sinhala and Tamil show to customers who pick those languages." actions={<button className="btn btn-brand btn-sm" onClick={() => setCat({ name: blank() })}>+ Category</button>} />
      <ErrorBox error={error} retry={reload} />
      {loading ? <Loading /> : !data?.length ? <Empty icon="🍛" title="Your menu is empty">Create a category, then add items.</Empty> : data.map((c) => (
        <section key={c.id} className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-extrabold">{tr(c.name, 'en')} {!c.active && <Pill>hidden</Pill>}</h2>
            <div className="flex gap-2"><button className="btn btn-ghost btn-sm" onClick={() => setCat({ id: c.id, name: { ...blank(), ...c.name } })}>Rename</button><button className="btn btn-ghost btn-sm" onClick={async () => { await api(`/api/r/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); reload(); }}>{c.active ? 'Hide' : 'Show'}</button>
              <button className="btn btn-brand btn-sm" onClick={() => setD(fresh(c.id))}>+ Item</button></div></div>
          <div className="card divide-y divide-line">{c.items.length === 0 && <p className="p-4 text-sm text-muted">No items. <button className="font-bold text-brandtext" onClick={() => setDel(c)}>Delete category</button></p>}
            {c.items.map((i: any) => (
              <div key={i.id} className="flex items-center gap-3 p-3">
                <FoodImg src={i.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl" />
                <button className="min-w-0 flex-1 text-left" onClick={() => edit(i, c.id)}><div className="truncate font-bold">{tr(i.name, 'en')}</div><div className="truncate text-xs text-muted">{[i.name.si, i.name.ta].filter(Boolean).join(' · ') || 'No translations yet'}</div></button>
                <div className="hidden text-right text-sm sm:block"><b className="tabular">{lkr(i.priceCents)}</b>{i.optionGroups.length > 0 && <div className="text-xs text-muted">{i.optionGroups.length} option group(s)</div>}</div>
                <label className="flex flex-col items-center gap-1 text-[10px] font-bold uppercase text-muted">{i.available ? 'Available' : 'Sold out'}<Toggle on={i.available} onChange={(v) => quick(i.id, v)} label={`${tr(i.name, 'en')} available`} /></label>
              </div>))}</div>
        </section>))}

      <Sheet open={!!d} onClose={() => setD(null)} wide title={d?.id ? 'Edit item' : 'New item'}>
        {d && <form onSubmit={save} className="space-y-5 p-5">
          <div className="flex items-center gap-4"><FoodImg src={d.imageUrl} alt="" className="h-24 w-24 rounded-2xl" /><div className="space-y-2"><label className="btn btn-line btn-sm cursor-pointer">{up ? <Spinner /> : '📷 Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
            {d.imageUrl && <button type="button" className="block text-xs font-bold text-bad" onClick={() => setD({ ...d, imageUrl: null })}>Remove photo</button>}<p className="text-xs text-muted">JPEG/PNG/WebP, max 2 MB. Landscape 4:3 looks best.</p></div></div>
          <LText label="Name" v={d.name} on={(name) => setD({ ...d, name })} /><LText label="Description" v={d.description} on={(description) => setD({ ...d, description })} area />
          <div className="grid grid-cols-3 gap-3"><Field label="Price (Rs.)"><input className="input" type="number" min={0} step="0.01" required value={d.priceCents / 100} onChange={(e) => setD({ ...d, priceCents: Math.round(parseFloat(e.target.value || '0') * 100) })} /></Field>
            <Field label="Prep (min)"><input className="input" type="number" min={1} max={120} value={d.prepMinutes} onChange={(e) => setD({ ...d, prepMinutes: +e.target.value })} /></Field>
            <Field label="Category"><select className="input" value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>{data?.map((c) => <option key={c.id} value={c.id}>{tr(c.name, 'en')}</option>)}</select></Field></div>
          <div><span className="label">Tags</span><div className="flex flex-wrap gap-2">{['popular', 'vegetarian', 'vegan', 'spicy'].map((t) => <button key={t} type="button" aria-pressed={d.tags.includes(t)} onClick={() => setD({ ...d, tags: d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t] })} className={`pill ${d.tags.includes(t) ? 'bg-brand text-onbrand' : 'bg-sunken text-muted'}`}>{t}</button>)}</div></div>
          <div><div className="mb-2 flex items-center justify-between"><span className="label !mb-0">Options & add-ons</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setD({ ...d, optionGroups: [...d.optionGroups, { name: blank(), min: 0, max: 1, options: [{ name: blank(), priceDeltaCents: 0, available: true }] }] })}>+ Group</button></div>
            <div className="space-y-3">{d.optionGroups.map((g, gi) => (
              <div key={gi} className="rounded-2xl border border-line p-3"><div className="mb-2 flex items-start gap-2"><div className="flex-1"><LText label="Group name (e.g. Spice level)" v={g.name} on={(name) => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, name } : x)) })} /></div>
                <button type="button" aria-label="Remove group" className="btn btn-ghost btn-sm" onClick={() => setD({ ...d, optionGroups: d.optionGroups.filter((_, i) => i !== gi) })}>✕</button></div>
                <div className="mb-2 flex gap-3"><Field label="Min"><input className="input w-20" type="number" min={0} max={10} value={g.min} onChange={(e) => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, min: +e.target.value } : x)) })} /></Field>
                  <Field label="Max"><input className="input w-20" type="number" min={1} max={10} value={g.max} onChange={(e) => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, max: +e.target.value } : x)) })} /></Field><p className="self-end pb-3 text-xs text-muted">Min 1 = customer must choose.</p></div>
                {g.options.map((o, oi) => (<div key={oi} className="mb-2 flex items-center gap-2"><input className="input" placeholder="EN" required value={o.name.en} onChange={(e) => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, options: x.options.map((y, j) => (j === oi ? { ...y, name: { ...y.name, en: e.target.value } } : y)) } : x)) })} />
                  <input className="input" placeholder="සිං" value={o.name.si} onChange={(e) => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, options: x.options.map((y, j) => (j === oi ? { ...y, name: { ...y.name, si: e.target.value } } : y)) } : x)) })} />
                  <input className="input" placeholder="தமி" value={o.name.ta} onChange={(e) => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, options: x.options.map((y, j) => (j === oi ? { ...y, name: { ...y.name, ta: e.target.value } } : y)) } : x)) })} />
                  <input className="input w-28" type="number" step="0.01" aria-label="Price change in rupees" value={o.priceDeltaCents / 100} onChange={(e) => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, options: x.options.map((y, j) => (j === oi ? { ...y, priceDeltaCents: Math.round(parseFloat(e.target.value || '0') * 100) } : y)) } : x)) })} />
                  <button type="button" aria-label="Remove option" onClick={() => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x)) })}>✕</button></div>))}
                <button type="button" className="text-sm font-bold text-brandtext" onClick={() => setD({ ...d, optionGroups: d.optionGroups.map((x, i) => (i === gi ? { ...x, options: [...x.options, { name: blank(), priceDeltaCents: 0, available: true }] } : x)) })}>+ Add choice</button></div>))}</div></div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">{d.id ? <button type="button" className="btn btn-line text-bad" onClick={() => setDel({ item: d })}>Delete</button> : <span />}<div className="flex gap-2"><button type="button" className="btn btn-line" onClick={() => setD(null)}>Cancel</button><button className="btn btn-brand" disabled={busy}>{busy ? <Spinner /> : 'Save item'}</button></div></div>
        </form>}</Sheet>

      <Sheet open={!!cat} onClose={() => setCat(null)} title={cat?.id ? 'Rename category' : 'New category'}>{cat && <form className="space-y-4 p-5" onSubmit={async (e) => { e.preventDefault(); try { if (cat.id) await api(`/api/r/categories/${cat.id}`, { method: 'PATCH', body: { name: cat.name } }); else await api('/api/r/categories', { body: { name: cat.name } }); setCat(null); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } }}>
        <LText label="Name" v={cat.name} on={(name) => setCat({ ...cat, name })} /><button className="btn btn-brand w-full">Save</button></form>}</Sheet>
      <Confirm open={!!del} danger title="Delete?" confirmLabel="Delete" onClose={() => setDel(null)} body={del?.item ? 'Items that were already ordered are hidden instead of deleted, so your sales history stays intact.' : 'Delete this empty category?'}
        onConfirm={async () => { try { if (del.item) { await api(`/api/r/items/${del.item.id}`, { method: 'DELETE' }); setD(null); } else await api(`/api/r/categories/${del.id}`, { method: 'DELETE' }); reload(); } catch (ex) { toast((ex as ApiError).message, 'bad'); } }} />
    </>
  );
}
