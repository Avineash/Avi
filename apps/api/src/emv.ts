/**
 * EMVCo Merchant-Presented QR payload (the format LankaQR is built on).
 *
 * IMPORTANT: LankaQR network-specific fields (the merchant-account template in tags 26–51:
 * network GUID, acquirer/merchant identifiers) are issued by the acquiring bank / LankaPay.
 * They are injected via `merchantAccount` by the provider adapter. The sandbox adapter uses a
 * clearly fake GUID, so sandbox QR codes can never be paid by a real banking app.
 */
export interface TLV { [tag: string]: string }

export function crc16(input: string): string {
  // CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no xorout.
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const f = (tag: string, value: string) => {
  if (value.length > 99) throw new Error(`EMV tag ${tag} too long`);
  return tag + String(value.length).padStart(2, '0') + value;
};
const ascii = (s: string, max: number) =>
  s.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim().slice(0, max) || 'NA';

export interface DynamicQrInput {
  merchantAccount: { tag: string; guid: string; merchantId: string };
  mcc?: string;
  merchantName: string;
  merchantCity: string;
  amountCents: number;
  /** Bill number / payment reference echoed back by the bank in the notification (tag 62-01). */
  billNumber: string;
  /** Terminal / table label (tag 62-07). */
  terminalLabel?: string;
}

export function buildDynamicQr(i: DynamicQrInput): string {
  const amount = (i.amountCents / 100).toFixed(2);
  const acct = f('00', i.merchantAccount.guid) + f('01', i.merchantAccount.merchantId);
  const add = f('01', ascii(i.billNumber, 25)) + (i.terminalLabel ? f('07', ascii(i.terminalLabel, 25)) : '');
  const body =
    f('00', '01') + f('01', '12') + // 12 = dynamic (single-use) QR
    f(i.merchantAccount.tag, acct) +
    f('52', i.mcc ?? '5812') + f('53', '144') + f('54', amount) +
    f('58', 'LK') + f('59', ascii(i.merchantName, 25)) + f('60', ascii(i.merchantCity, 15)) +
    f('62', add) + '6304';
  return body + crc16(body);
}

export function parseQr(payload: string): { ok: boolean; crcOk: boolean; fields: TLV; sub: Record<string, TLV> } {
  const fields: TLV = {};
  let i = 0;
  try {
    while (i < payload.length) {
      const tag = payload.slice(i, i + 2), len = Number(payload.slice(i + 2, i + 4));
      if (!/^\d{2}$/.test(tag) || !Number.isInteger(len)) throw new Error('bad tlv');
      fields[tag] = payload.slice(i + 4, i + 4 + len);
      i += 4 + len;
    }
  } catch { return { ok: false, crcOk: false, fields: {}, sub: {} }; }
  const idx = payload.lastIndexOf('6304');
  const crcOk = idx > -1 && crc16(payload.slice(0, idx + 4)) === payload.slice(idx + 4);
  const sub: Record<string, TLV> = {};
  for (const [t, v] of Object.entries(fields)) {
    if ((+t >= 26 && +t <= 51) || t === '62') {
      const o: TLV = {}; let j = 0;
      while (j + 4 <= v.length) { const l = Number(v.slice(j + 2, j + 4)); o[v.slice(j, j + 2)] = v.slice(j + 4, j + 4 + l); j += 4 + l; }
      sub[t] = o;
    }
  }
  return { ok: fields['00'] === '01', crcOk, fields, sub };
}
