// Génère de faux enregistrements de beatbox pour tester le moteur sans micro.
import type { DrumClass } from './analysis';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Sons de type « bouche » : boum (grave), tchac (médium bruité), tss (aigu bruité)
export function voiceHit(cls: DrumClass, sr: number, rand: () => number, gain = 1): Float32Array {
  const len = Math.round(sr * (cls === 'hihat' ? 0.08 : 0.18));
  const out = new Float32Array(len);
  let lp = 0, hp = 0, prevIn = 0, bp1 = 0, bp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = rand() * 2 - 1;
    if (cls === 'kick') {
      const f = 60 + 90 * Math.exp(-t * 30);
      const env = Math.exp(-t * 18);
      lp += 0.05 * (n - lp);
      out[i] = (0.9 * Math.sin(2 * Math.PI * f * t) + 0.25 * lp) * env * Math.min(1, i / (0.002 * sr));
    } else if (cls === 'snare') {
      // bruit passe-bande ~1-4 kHz + petite composante tonale
      bp1 += 0.35 * (n - bp1);
      bp2 += 0.08 * (bp1 - bp2);
      const band = bp1 - bp2;
      const env = Math.exp(-t * 22);
      out[i] = (1.6 * band + 0.15 * Math.sin(2 * Math.PI * 220 * t)) * env * Math.min(1, i / (0.001 * sr));
    } else {
      // bruit passe-haut (> ~6 kHz)
      hp = 0.6 * (hp + n - prevIn);
      prevIn = n;
      const env = Math.exp(-t * 60);
      out[i] = 0.9 * hp * env;
    }
    out[i] *= gain;
  }
  return out;
}

export interface Placed { step: number; cls: DrumClass }

export function renderBeatbox(pattern: Placed[], opts: { bpm: number; sr?: number; loops?: number; jitterMs?: number; noise?: number; lead?: number; seed?: number }) {
  const sr = opts.sr ?? 44100;
  const rand = rng(opts.seed ?? 1);
  const step = 60 / opts.bpm / 4;
  const loops = opts.loops ?? 2;
  const lead = opts.lead ?? 0.4;
  const steps = 16;
  const total = lead + loops * steps * step + 0.6;
  const out = new Float32Array(Math.round(total * sr));
  for (let i = 0; i < out.length; i++) out[i] = (rand() * 2 - 1) * (opts.noise ?? 0.005);
  const truth: { time: number; cls: DrumClass; step: number }[] = [];
  for (let l = 0; l < loops; l++) {
    for (const p of pattern) {
      const jitter = ((rand() * 2 - 1) * (opts.jitterMs ?? 0)) / 1000;
      const time = lead + (l * steps + p.step) * step + jitter;
      const hit = voiceHit(p.cls, sr, rand, 0.6 + 0.4 * rand());
      const start = Math.round(time * sr);
      for (let i = 0; i < hit.length && start + i < out.length; i++) out[start + i] += hit[i];
      truth.push({ time, cls: p.cls, step: p.step + l * steps });
    }
  }
  return { signal: out, sr, truth };
}
