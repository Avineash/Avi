import type { Db } from '../db.js';
import type { Config } from '../config.js';
import type { PaymentProvider } from './types.js';
import { SandboxCard, SandboxLankaQr } from './sandbox.js';
import { PayHere } from './payhere.js';
import { LankaQrAcquirer } from './acquirer.js';

export type Registry = Map<string, PaymentProvider>;
export function buildRegistry(db: Db, cfg: Config): Registry {
  const list: PaymentProvider[] = [new PayHere(), new LankaQrAcquirer()];
  if (cfg.allowSandbox) list.push(new SandboxLankaQr(db, cfg), new SandboxCard(db, cfg));
  return new Map(list.map((p) => [p.key, p]));
}
