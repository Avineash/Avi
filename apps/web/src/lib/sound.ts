/** New-order chime generated with the Web Audio API (no asset to download on slow connections). */
let ctx: AudioContext | null = null;
export function unlockAudio() {
  try { ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)(); if (ctx.state === 'suspended') void ctx.resume(); return ctx.state; } catch { return 'unsupported'; }
}
export function chime(times = 2) {
  if (!ctx || ctx.state !== 'running') return false;
  const now = ctx.currentTime;
  for (let i = 0; i < times; i++) [880, 1175, 1568].forEach((f, j) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain(), t = now + i * 0.9 + j * 0.16;
    o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 0.55);
  });
  return true;
}
