// Generates placeholder "photo" cards. REAL photography is uploaded by each restaurant in the menu editor.
import { writeFileSync, mkdirSync } from 'node:fs';
const items = {
  'chicken-kottu': ['🍛', '#f59e0b', '#b45309'], 'veg-kottu': ['🥗', '#84cc16', '#3f6212'], 'cheese-kottu': ['🧀', '#fbbf24', '#b45309'],
  'rice-curry': ['🍛', '#ef4444', '#7f1d1d'], 'lamprais': ['🍱', '#10b981', '#065f46'], 'egg-hopper': ['🍳', '#f59e0b', '#92400e'],
  'plain-hopper': ['🥣', '#d6a560', '#78350f'], 'string-hoppers': ['🍜', '#fcd34d', '#a16207'], 'fish-cutlet': ['🧆', '#fb923c', '#9a3412'],
  'isso-wade': ['🍤', '#f97316', '#9a3412'], 'club-sandwich': ['🥪', '#a3e635', '#4d7c0f'], 'avocado-toast': ['🥑', '#4ade80', '#166534'],
  'milk-tea': ['☕', '#c08457', '#5b3a1e'], 'iced-coffee': ['🧋', '#a78bfa', '#4c1d95'], 'king-coconut': ['🥥', '#fbbf24', '#854d0e'],
  'wood-apple': ['🍹', '#d97706', '#78350f'], 'lime-soda': ['🍋', '#bef264', '#4d7c0f'], 'watalappan': ['🍮', '#f59e0b', '#7c2d12'],
  'biscuit-pudding': ['🍫', '#a16207', '#3b1d0a'],
};
mkdirSync(new URL('../public/food/', import.meta.url), { recursive: true });
for (const [slug, [emoji, a, b]] of Object.entries(items)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="${slug}">
<defs><radialGradient id="g" cx="30%" cy="25%" r="90%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>
<radialGradient id="p" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".7"/></radialGradient>
<filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#000" flood-opacity=".35"/></filter></defs>
<rect width="800" height="600" fill="url(#g)"/>
<circle cx="90" cy="520" r="170" fill="#fff" opacity=".07"/><circle cx="720" cy="70" r="130" fill="#fff" opacity=".08"/>
<circle cx="400" cy="318" r="196" fill="url(#p)" filter="url(#s)"/><circle cx="400" cy="318" r="160" fill="#fff" opacity=".55"/>
<text x="400" y="372" font-size="170" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text></svg>`;
  writeFileSync(new URL(`../public/food/${slug}.svg`, import.meta.url), svg);
}
console.log('wrote', Object.keys(items).length, 'placeholders');
