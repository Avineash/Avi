import type { Q } from './db.js';
import { z } from 'zod';

export const LineIn = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  optionIds: z.array(z.string().uuid()).max(30).default([]),
  note: z.string().max(200).optional(),
});
export type LineInput = z.infer<typeof LineIn>;

export interface Totals { subtotal: number; service: number; tax: number; total: number }

/** Service charge applies to the subtotal; tax (e.g. VAT) applies to subtotal + service charge. */
export function computeTotals(subtotal: number, serviceBps: number, taxBps: number): Totals {
  const service = Math.round((subtotal * serviceBps) / 10000);
  const tax = Math.round(((subtotal + service) * taxBps) / 10000);
  return { subtotal, service, tax, total: subtotal + service + tax };
}

export class PricingError extends Error {
  constructor(public code: string, message: string, public itemId?: string) { super(message); }
}

export interface PricedLine {
  itemId: string; name: any; qty: number; unitPriceCents: number; note?: string;
  options: { id: string; name: any; priceDeltaCents: number }[];
  lineTotalCents: number; prepMinutes: number;
}

/** Server-side pricing: prices are NEVER trusted from the client. */
export async function priceLines(q: Q, lines: LineInput[]): Promise<PricedLine[]> {
  if (!lines.length) throw new PricingError('empty_cart', 'Cart is empty');
  if (lines.length > 40) throw new PricingError('too_many_lines', 'Too many lines');
  const ids = [...new Set(lines.map((l) => l.itemId))];
  const items = await q.query(
    `select i.id, i.name, i.price_cents, i.available, i.prep_minutes
       from menu_items i join menu_categories c on c.id = i.category_id
      where i.id = any($1::uuid[]) and c.active`, [ids]);
  const byId = new Map(items.map((i: any) => [i.id, i]));
  const groups = await q.query(`select id, item_id, min_select, max_select from option_groups where item_id = any($1::uuid[])`, [ids]);
  const opts = await q.query(
    `select o.id, o.group_id, o.name, o.price_delta_cents, o.available from options o
       join option_groups g on g.id = o.group_id where g.item_id = any($1::uuid[])`, [ids]);
  const optById = new Map(opts.map((o: any) => [o.id, o]));

  return lines.map((l) => {
    const it: any = byId.get(l.itemId);
    if (!it) throw new PricingError('unknown_item', 'Item not found', l.itemId);
    if (!it.available) throw new PricingError('unavailable', 'Item is currently unavailable', l.itemId);
    const chosen = [...new Set(l.optionIds)].map((id) => {
      const o: any = optById.get(id);
      if (!o) throw new PricingError('bad_option', 'Unknown option', l.itemId);
      if (!o.available) throw new PricingError('option_unavailable', 'Option unavailable', l.itemId);
      return o;
    });
    for (const g of groups.filter((g: any) => g.item_id === l.itemId)) {
      const n = chosen.filter((o: any) => o.group_id === g.id).length;
      if (n < g.min_select || n > g.max_select) throw new PricingError('option_rules', 'Option selection invalid', l.itemId);
    }
    const groupIds = new Set(groups.filter((g: any) => g.item_id === l.itemId).map((g: any) => g.id));
    if (chosen.some((o: any) => !groupIds.has(o.group_id))) throw new PricingError('bad_option', 'Option does not belong to item', l.itemId);
    const unit = it.price_cents + chosen.reduce((s: number, o: any) => s + o.price_delta_cents, 0);
    return {
      itemId: l.itemId, name: it.name, qty: l.qty, unitPriceCents: unit, note: l.note?.trim() || undefined,
      options: chosen.map((o: any) => ({ id: o.id, name: o.name, priceDeltaCents: o.price_delta_cents })),
      lineTotalCents: unit * l.qty, prepMinutes: it.prep_minutes,
    };
  });
}
