import type { NextRequest } from "next/server";

/**
 * Generated placeholder artwork (navy / ivory / gold) so every listing has a cohesive cover before a partner uploads photography.
 * Partners replace it by pasting an image URL on their listing. Deterministic per slug, cached aggressively.
 */
function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: number) { let t = seed; return () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const kind = req.nextUrl.searchParams.get("kind") ?? "hotel";
  const r = rng(hash(slug));
  const W = 800, H = 520;
  const hue = Math.floor(r() * 24) - 12;
  const bg1 = `hsl(${217 + hue} 62% ${10 + Math.floor(r() * 6)}%)`, bg2 = `hsl(${215 + hue} 52% ${22 + Math.floor(r() * 10)}%)`;
  const gold = "#c9ae74";
  let art = "";
  if (kind === "hotel") {
    let x = 20;
    while (x < W - 20) {
      const w = 40 + Math.floor(r() * 70), h = 140 + Math.floor(r() * 250), y = H - h;
      art += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="hsl(${214 + hue} 45% ${14 + Math.floor(r() * 10)}%)" stroke="${gold}" stroke-opacity=".25"/>`;
      for (let wy = y + 14; wy < H - 14; wy += 22) for (let wx = x + 8; wx < x + w - 10; wx += 14) if (r() > 0.45) art += `<rect x="${wx}" y="${wy}" width="6" height="10" rx="1" fill="${gold}" fill-opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`;
      x += w + 6 + Math.floor(r() * 10);
    }
    art += `<circle cx="${620 + Math.floor(r() * 120)}" cy="${90 + Math.floor(r() * 50)}" r="34" fill="${gold}" fill-opacity=".9"/>`;
  } else if (kind === "restaurant") {
    const cx = 400, cy = 270;
    for (let i = 0; i < 5; i++) art += `<circle cx="${cx}" cy="${cy}" r="${40 + i * 38}" fill="none" stroke="${gold}" stroke-opacity="${(0.55 - i * 0.09).toFixed(2)}" stroke-width="${i === 0 ? 3 : 1.5}"/>`;
    art += `<circle cx="${cx}" cy="${cy}" r="34" fill="${gold}" fill-opacity=".85"/>`;
    for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, d = 100 + r() * 130; art += `<circle cx="${(cx + Math.cos(a) * d).toFixed(0)}" cy="${(cy + Math.sin(a) * d).toFixed(0)}" r="${2 + r() * 4}" fill="#f8f4ea" fill-opacity="${(0.2 + r() * 0.5).toFixed(2)}"/>`; }
    art += `<path d="M60 470 Q 400 380 740 470" fill="none" stroke="${gold}" stroke-opacity=".4"/>`;
  } else {
    for (let i = 0; i < 5; i++) { const x = 120 + i * 140 + (r() * 30 - 15); art += `<path d="M${x} 0 L${x - 110} ${H} L${x + 110} ${H} Z" fill="${gold}" fill-opacity="${(0.05 + r() * 0.1).toFixed(2)}"/>`; }
    for (let i = 0; i < 40; i++) art += `<circle cx="${Math.floor(r() * W)}" cy="${Math.floor(r() * H * 0.7)}" r="${(0.6 + r() * 2.2).toFixed(1)}" fill="#f8f4ea" fill-opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`;
    art += `<ellipse cx="400" cy="${H - 20}" rx="360" ry="46" fill="${gold}" fill-opacity=".35"/><rect x="240" y="${H - 150}" width="320" height="110" rx="6" fill="hsl(214 50% 10%)" stroke="${gold}" stroke-opacity=".6"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Decorative ${kind} artwork"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>${art}</svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" } });
}
