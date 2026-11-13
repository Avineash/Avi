import { randomUUID } from 'node:crypto';
import { applyPreset, getPreset, type ThemeConfig } from '@staffhub/theme-core';
import { hashPassword, type Ctx } from './auth.ts';
import { publish, resolveScope, saveAsset, saveDraft, setPolicy } from './brand/store.ts';
import { all, get, now, run, tx, type DB } from './db.ts';
import { countWorkingDays, isoDate } from './leave.ts';

export const DEMO_PASSWORD = 'staffhub-demo';

// All names, companies and logos below are fictional and do not imitate any real brand.
const FIRST = ['Amelia', 'Noah', 'Sofia', 'Liam', 'Maya', 'Lucas', 'Elena', 'Omar', 'Chloe', 'Mateo', 'Priya', 'Jonas', 'Isla', 'Kofi', 'Hana', 'Diego', 'Freya', 'Ravi', 'Zoe', 'Tomas', 'Nadia', 'Felix', 'Leila', 'Oscar', 'Mei', 'Hugo', 'Aisha', 'Nils', 'Camila', 'Idris'];
const LAST = ['Hart', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Silva', 'Novak', 'Haddad', 'Fischer', 'Reyes', 'Kaur', 'Bauer', 'Costa', 'Mensah', 'Ivanov', 'Larsen', 'Ortiz', 'Sato', 'Dubois', 'Petrov', 'Rossi', 'Khan', 'Weber', 'Nguyen', 'Alvarez', 'Berg', 'Mahlangu', 'Quinn', 'Varga', 'Holm'];
const DEPARTMENTS = [
  { name: 'Front Office', shifts: [['Early', '06:00', '14:00'], ['Late', '14:00', '22:00'], ['Night', '22:00', '06:00']] },
  { name: 'Housekeeping', shifts: [['Early', '07:00', '15:00'], ['Late', '11:00', '19:00']] },
  { name: 'Food & Beverage', shifts: [['Breakfast', '06:30', '14:30'], ['Dinner', '15:00', '23:00']] },
] as const;

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const svgW = (w: number, body: string) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 48" role="img">${body}</svg>`);
const LOGOS = {
  aurora: svgW(150, `<circle cx="24" cy="26" r="14" fill="#c98a2b"/><path d="M6 36a18 18 0 0 1 36 0z" fill="#0f7a76"/><text x="52" y="31" font-family="Georgia,serif" font-size="19" font-weight="600" fill="#0f5c5a">Aurora</text>`),
  maison: svgW(190, `<path d="M10 38C10 20 22 10 40 8c-1 18-9 30-30 30z" fill="#5d7f69"/><path d="M12 38c8-10 14-16 24-24" stroke="#fbf6f3" stroke-width="2" fill="none"/><text x="50" y="31" font-family="Georgia,serif" font-style="italic" font-size="19" fill="#9b3d55">Maison Verde</text>`),
  meridianLight: svgW(200, `<path d="M24 6l14 18-14 18L10 24z" fill="none" stroke="#7a5a1e" stroke-width="3"/><path d="M24 14v20" stroke="#7a5a1e" stroke-width="3"/><text x="48" y="31" font-family="Georgia,serif" font-size="19" letter-spacing="3" fill="#1c1a16">MERIDIAN</text>`),
  meridianDark: svgW(200, `<path d="M24 6l14 18-14 18L10 24z" fill="none" stroke="#c9a35b" stroke-width="3"/><path d="M24 14v20" stroke="#c9a35b" stroke-width="3"/><text x="48" y="31" font-family="Georgia,serif" font-size="19" letter-spacing="3" fill="#f2ede4">MERIDIAN</text>`),
};
const FAVICON = (color: string) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>`);

interface CompanySpec {
  name: string; slug: string; preset: string; tagline: string;
  properties: Array<{ name: string; slug: string }>;
}
const COMPANIES: CompanySpec[] = [
  { name: 'Aurora Hotels Group', slug: 'aurora', preset: 'premium-hospitality', tagline: 'Warm welcomes, worldwide', properties: [{ name: 'Aurora Harbour Hotel', slug: 'harbour' }, { name: 'Aurora Alpine Lodge', slug: 'alpine' }] },
  { name: 'Maison Verde Collection', slug: 'maison-verde', preset: 'boutique-hotel', tagline: 'Small hotels with big character', properties: [{ name: 'Maison Verde Paris', slug: 'paris' }, { name: 'Maison Verde Lisbon', slug: 'lisbon' }] },
  { name: 'Meridian Suites', slug: 'meridian', preset: 'luxury-dark', tagline: 'Considered stays', properties: [{ name: 'Meridian Tower', slug: 'tower' }] },
];

export function seedDemo(db: DB, today = new Date()): void {
  if (get(db, 'SELECT 1 FROM companies LIMIT 1')) return;
  const rand = rng(20240607);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
  const pw = hashPassword(DEMO_PASSWORD); // one hash reused for all demo users (demo data only)
  const usedNames = new Set<string>();
  const person = () => { for (;;) { const n = `${pick(FIRST)} ${pick(LAST)}`; if (!usedNames.has(n)) { usedNames.add(n); return n; } } };
  const addDays = (n: number) => isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + n)));

  tx(db, () => {
    for (const spec of COMPANIES) {
      const companyId = randomUUID();
      run(db, 'INSERT INTO companies (id, name, slug, created_at) VALUES (?,?,?,?)', companyId, spec.name, spec.slug, now());
      const insertUser = (role: string, name: string, email: string, propertyId: string | null, departmentId: string | null) => {
        const id = randomUUID();
        run(db, 'INSERT INTO users (id, company_id, property_id, department_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?,?,?)', id, companyId, propertyId, departmentId, name, email, pw, role, now());
        return id;
      };
      insertUser('company_admin', person(), `admin@${spec.slug}.example`, null, null);

      for (const prop of spec.properties) {
        const propertyId = randomUUID();
        run(db, 'INSERT INTO properties (id, company_id, name, slug) VALUES (?,?,?,?)', propertyId, companyId, prop.name, prop.slug);
        insertUser('property_admin', person(), `${prop.slug}.admin@${spec.slug}.example`, propertyId, null);

        for (const dept of DEPARTMENTS) {
          const deptId = randomUUID();
          run(db, 'INSERT INTO departments (id, company_id, property_id, name) VALUES (?,?,?,?)', deptId, companyId, propertyId, dept.name);
          const slugDept = dept.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');
          const mgr = insertUser('manager', person(), `${prop.slug}.${slugDept}.manager@${spec.slug}.example`, propertyId, deptId);
          const staff: string[] = [];
          for (let i = 0; i < 4; i++) {
            const name = person();
            const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${spec.slug}.example`;
            staff.push(insertUser('employee', name, email, propertyId, deptId));
          }

          // ── leave ──
          const taken = new Map<string, Array<[string, string]>>();
          const addLeave = (emp: string, start: number, len: number, status: string, type = pick(['Annual leave', 'Annual leave', 'Sick leave', 'Unpaid leave', 'Time off in lieu'])) => {
            const s = addDays(start), e = addDays(start + len - 1);
            const days = countWorkingDays(s, e);
            if (!days) return;
            const mine = taken.get(emp) ?? [];
            if (mine.some(([a, b]) => a <= e && b >= s)) return;
            mine.push([s, e]); taken.set(emp, mine);
            const decided = status === 'approved' || status === 'rejected';
            const id = randomUUID();
            run(db, `INSERT INTO leave_requests (id, company_id, property_id, department_id, employee_id, leave_type, start_date, end_date, days, status, reason, decided_by, decided_at, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, companyId, propertyId, deptId, emp, type, s, e, days, status, null, decided ? mgr : null, decided ? now() : null, now());
            const title = { approved: 'Leave approved', rejected: 'Leave rejected', pending: 'Leave request awaiting approval', cancelled: 'Leave cancelled' }[status]!;
            const recipient = status === 'pending' ? mgr : emp;
            const who = get<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', emp)!.name;
            run(db, 'INSERT INTO notifications (id, company_id, user_id, kind, status, title, body, created_at, read_at) VALUES (?,?,?,?,?,?,?,?,?)',
              randomUUID(), companyId, recipient, 'leave', status, title,
              status === 'pending' ? `${who} requested ${days} working day${days === 1 ? '' : 's'} of ${type.toLowerCase()} (${s} → ${e}).` : `Your ${type.toLowerCase()} request (${s} → ${e}) was ${status}.`,
              now(), rand() < 0.4 ? now() : null);
          };
          // Guaranteed showcase data so every role has something of each status to look at.
          addLeave(staff[0]!, 9, 3, 'pending', 'Annual leave');
          addLeave(staff[1]!, 16, 2, 'pending', 'Time off in lieu');
          addLeave(staff[2]!, 2, 3, 'approved', 'Annual leave');
          addLeave(staff[3]!, 5, 2, 'rejected', 'Annual leave');
          addLeave(staff[0]!, -12, 2, 'cancelled', 'Sick leave');
          addLeave(staff[1]!, -30, 5, 'approved', 'Annual leave');
          for (const emp of staff) {
            for (let k = 0; k < 2; k++) {
              if (rand() < 0.45) {
                const start = Math.floor(rand() * 85) - 25, len = 1 + Math.floor(rand() * 7);
                const r = rand();
                const status = start < 0 ? (r < 0.8 ? 'approved' : r < 0.9 ? 'rejected' : 'cancelled') : (r < 0.45 ? 'pending' : r < 0.85 ? 'approved' : r < 0.93 ? 'rejected' : 'cancelled');
                addLeave(emp, start, len, status);
              }
            }
          }

          // ── roster: five days a week on a rotating pattern, skipping approved leave ──
          const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
          monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 7);
          const members = [mgr, ...staff];
          members.forEach((emp, idx) => {
            const offset = idx % 3; // 0: Mon–Fri, 1: Wed–Sun, 2: Tue–Sat
            const approvedRanges = all<{ start_date: string; end_date: string }>(db, "SELECT start_date, end_date FROM leave_requests WHERE employee_id = ? AND status = 'approved'", emp);
            for (let w = 0; w < 5; w++) for (let d = 0; d < 7; d++) {
              const dow = d; // 0 = Monday
              const works = offset === 0 ? dow <= 4 : offset === 1 ? dow >= 2 : dow >= 1 && dow <= 5;
              if (!works) continue;
              const date = isoDate(new Date(monday.getTime() + (w * 7 + d) * 86_400_000));
              if (approvedRanges.some((r) => r.start_date <= date && r.end_date >= date)) continue;
              const [label, st, en] = dept.shifts[(idx + w) % dept.shifts.length]!;
              run(db, 'INSERT INTO roster_shifts (id, company_id, property_id, department_id, employee_id, shift_date, start_time, end_time, label) VALUES (?,?,?,?,?,?,?,?,?)',
                randomUUID(), companyId, propertyId, deptId, emp, date, st, en, label);
            }
          });
        }
      }
    }
  });

  seedThemes(db);
}

/** Publishes starter themes through the real store, exercising validation, the accessibility gate and version history. */
function seedThemes(db: DB) {
  for (const spec of COMPANIES) {
    const company = get<{ id: string }>(db, 'SELECT id FROM companies WHERE slug = ?', spec.slug)!;
    const admin = get<{ id: string; name: string; email: string }>(db, "SELECT id, name, email FROM users WHERE company_id = ? AND role = 'company_admin'", company.id)!;
    const ctx: Ctx = { userId: admin.id, companyId: company.id, propertyId: null, departmentId: null, role: 'company_admin', name: admin.name, email: admin.email };
    const preset = getPreset(spec.preset)!;
    const publishLayer = (layer: ThemeConfig, note: string) => {
      const s = resolveScope(db, ctx, 'company');
      const rev = saveDraft(db, ctx, s, layer, s.draft_revision).revision;
      publish(db, ctx, s, { baseRevision: rev, note });
    };

    // v1: the preset alone, with the company name.
    const base = applyPreset({ identity: { companyName: spec.name } }, preset);
    publishLayer(base, `Started from the “${preset.name}” preset`);

    // v2: logo, favicon and tagline.
    const logoBytes = spec.slug === 'aurora' ? LOGOS.aurora : spec.slug === 'maison-verde' ? LOGOS.maison : LOGOS.meridianLight;
    const logo = saveAsset(db, ctx, 'logo', logoBytes);
    const fav = saveAsset(db, ctx, 'favicon', FAVICON(preset.config.colors!.light!.primary!));
    const identity: NonNullable<ThemeConfig['identity']> = { companyName: spec.name, tagline: spec.tagline, logoAssetId: logo.id, faviconAssetId: fav.id };
    if (spec.slug === 'meridian') identity.logoDarkAssetId = saveAsset(db, ctx, 'logoDark', LOGOS.meridianDark).id;
    publishLayer({ ...base, identity }, 'Added logo, favicon and tagline');
  }

  // Aurora lets properties override identity *and* colours; the Alpine Lodge uses a forest-green variant of the brand.
  const aurora = get<{ id: string }>(db, "SELECT id FROM companies WHERE slug = 'aurora'")!;
  const admin = get<{ id: string; name: string; email: string }>(db, "SELECT id, name, email FROM users WHERE company_id = ? AND role = 'company_admin'", aurora.id)!;
  const ctx: Ctx = { userId: admin.id, companyId: aurora.id, propertyId: null, departmentId: null, role: 'company_admin', name: admin.name, email: admin.email };
  setPolicy(db, ctx, { identity: true, colors: true });
  const alpine = get<{ id: string }>(db, "SELECT id FROM properties WHERE company_id = ? AND slug = 'alpine'", aurora.id)!;
  const scope = resolveScope(db, ctx, alpine.id);
  const rev = saveDraft(db, ctx, scope, {
    colors: { light: { primary: '#2f5d3a', sidebarBg: '#1d3a26' }, dark: { primary: '#7fcf94', sidebarBg: '#0b1a10' } },
  }, scope.draft_revision).revision;
  publish(db, ctx, scope, { baseRevision: rev, note: 'Alpine Lodge forest-green variant' });
}
