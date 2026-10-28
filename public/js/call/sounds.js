// Sons do soundboard gerados por síntese (nenhum arquivo, nada de direitos autorais).
export const BUILTIN_SOUNDS = [
  { id: 'airhorn', name: 'Buzina', icon: '📯' },
  { id: 'rimshot', name: 'Ba dum tss', icon: '🥁' },
  { id: 'sad', name: 'Fracasso', icon: '🎺' },
  { id: 'applause', name: 'Aplausos', icon: '👏' },
  { id: 'victory', name: 'Vitória', icon: '🏆' },
  { id: 'boom', name: 'Explosão', icon: '💥' },
  { id: 'laser', name: 'Pew pew', icon: '🔫' },
  { id: 'ding', name: 'Ding', icon: '🔔' },
  { id: 'coin', name: 'Moeda', icon: '🪙' },
  { id: 'suspense', name: 'Suspense', icon: '😱' },
];

const DUR = { airhorn: 1.6, rimshot: 1.3, sad: 2.2, applause: 2.6, victory: 1.6, boom: 2.2, laser: 0.8, ding: 1.4, coin: 0.6, suspense: 2.4 };

function noise(ctx, len) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function env(ctx, node, t, a, peak, dec, end = 0.0001) {
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + a);
  node.gain.exponentialRampToValueAtTime(end, t + a + dec);
}

function tone(ctx, out, { type = 'sine', f, f2, t, d, vol = 0.3, a = 0.01 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  env(ctx, g, t, a, vol, d);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + a + d + 0.05);
  return o;
}

function noiseHit(ctx, out, { t, d, vol = 0.4, type = 'highpass', freq = 2000, q = 0.7 }) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx, d + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(ctx, g, t, 0.003, vol, d);
  s.connect(f).connect(g).connect(out);
  s.start(t);
}

const RECIPES = {
  airhorn(ctx, out) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.connect(out);
    [[0, 0.2], [0.27, 0.2], [0.54, 0.95]].forEach(([t, d]) => {
      [466, 470, 233, 699].forEach((f, i) => tone(ctx, lp, { type: 'sawtooth', f, t, d, vol: i === 3 ? 0.05 : 0.11, a: 0.02 }));
    });
  },
  rimshot(ctx, out) {
    [0, 0.16].forEach((t) => {
      noiseHit(ctx, out, { t, d: 0.18, vol: 0.5, freq: 1500 });
      tone(ctx, out, { type: 'triangle', f: 220, f2: 120, t, d: 0.12, vol: 0.4 });
    });
    noiseHit(ctx, out, { t: 0.34, d: 0.9, vol: 0.35, freq: 7000 });
    tone(ctx, out, { f: 60, f2: 40, t: 0.34, d: 0.3, vol: 0.5 });
  },
  sad(ctx, out) {
    const notes = [[392, 0], [370, 0.4], [349, 0.8]];
    notes.forEach(([f, t]) => tone(ctx, out, { type: 'sawtooth', f, t, d: 0.36, vol: 0.18, a: 0.03 }));
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 330;
    lfo.frequency.value = 6;
    lg.gain.value = 9;
    lfo.connect(lg).connect(o.frequency);
    env(ctx, g, 1.2, 0.04, 0.18, 0.9);
    o.connect(g).connect(out);
    o.start(1.2);
    lfo.start(1.2);
    o.stop(2.2);
    lfo.stop(2.2);
  },
  applause(ctx, out) {
    for (let i = 0; i < 160; i++) {
      const t = Math.random() * 2.1 * Math.sqrt(Math.random());
      noiseHit(ctx, out, { t, d: 0.04 + Math.random() * 0.05, vol: 0.12 + Math.random() * 0.15, type: 'bandpass', freq: 1200 + Math.random() * 2500, q: 1.2 });
    }
  },
  victory(ctx, out) {
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]].forEach(([f, t]) => tone(ctx, out, { type: 'square', f, t, d: 0.14, vol: 0.12 }));
    [523, 659, 784, 1047].forEach((f) => tone(ctx, out, { type: 'triangle', f, t: 0.52, d: 1, vol: 0.12 }));
  },
  boom(ctx, out) {
    noiseHit(ctx, out, { t: 0, d: 1.9, vol: 0.9, type: 'lowpass', freq: 380 });
    tone(ctx, out, { f: 120, f2: 30, t: 0, d: 1.2, vol: 0.8 });
  },
  laser(ctx, out) {
    [0, 0.28].forEach((t) => tone(ctx, out, { type: 'square', f: 1800, f2: 180, t, d: 0.24, vol: 0.14 }));
  },
  ding(ctx, out) {
    tone(ctx, out, { f: 1318, t: 0, d: 1.2, vol: 0.35 });
    tone(ctx, out, { f: 2637, t: 0, d: 0.8, vol: 0.12 });
  },
  coin(ctx, out) {
    tone(ctx, out, { type: 'square', f: 988, t: 0, d: 0.08, vol: 0.14 });
    tone(ctx, out, { type: 'square', f: 1319, t: 0.08, d: 0.4, vol: 0.14 });
  },
  suspense(ctx, out) {
    [[220, 0], [233, 0.6], [247, 1.2]].forEach(([f, t]) => {
      tone(ctx, out, { type: 'sawtooth', f, t, d: 0.55, vol: 0.16, a: 0.05 });
      tone(ctx, out, { type: 'sawtooth', f: f * 1.5, t, d: 0.55, vol: 0.06, a: 0.05 });
    });
    noiseHit(ctx, out, { t: 1.8, d: 0.6, vol: 0.4, type: 'lowpass', freq: 500 });
  },
};

export async function renderSound(id, sampleRate = 48000) {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error('som desconhecido');
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * DUR[id]), sampleRate);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  recipe(ctx, master);
  return ctx.startRendering();
}

// Nome amigável de uma tecla (para o push-to-talk)
export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Mouse')) return `Botão ${Number(code.slice(5)) + 1} do mouse`;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Space: 'Espaço', CapsLock: 'Caps Lock', ShiftLeft: 'Shift esq.', ShiftRight: 'Shift dir.', ControlLeft: 'Ctrl esq.', ControlRight: 'Ctrl dir.', AltLeft: 'Alt', AltRight: 'Alt Gr', Backquote: "'", Tab: 'Tab' }[code] || code;
}
