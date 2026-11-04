import { describe, it, expect } from 'vitest';
import { analyze, analyzeHits, estimateBpm, patternToText, type DrumClass } from '../src/analysis';
import { renderBeatbox, type Placed } from '../src/synth';

const K: DrumClass = 'kick', S: DrumClass = 'snare', H: DrumClass = 'hihat';

// Le rythme de Thomas : boum tchac tchac boum tchac boum tchac tchac (en croches)
const THOMAS: Placed[] = [K, S, S, K, S, K, S, S].map((cls, i) => ({ step: i * 2, cls }));

// Boom bap classique avec charleys
const BOOMBAP: Placed[] = [
  { step: 0, cls: K }, { step: 4, cls: S }, { step: 7, cls: K }, { step: 10, cls: K }, { step: 12, cls: S },
  { step: 2, cls: H }, { step: 6, cls: H }, { step: 14, cls: H },
];

function expected(pattern: Placed[]) {
  const g: Record<DrumClass, string[]> = { kick: [], snare: [], hihat: [] };
  for (const d of ['kick', 'snare', 'hihat'] as DrumClass[]) g[d] = Array.from({ length: 16 }, () => '.');
  for (const p of pattern) g[p.cls][p.step] = 'x';
  return g;
}

function check(pattern: Placed[], bpm: number, opts: { jitterMs?: number; noise?: number; seed?: number } = {}) {
  const { signal, sr, truth } = renderBeatbox(pattern, { bpm, loops: 2, ...opts });
  const { hits, pattern: p } = analyze(signal, sr);
  const exp = expected(pattern);
  const got: Record<DrumClass, string[]> = { kick: [], snare: [], hihat: [] };
  for (const d of ['kick', 'snare', 'hihat'] as DrumClass[]) {
    got[d] = Array.from({ length: 16 }, (_, i) => (p.grid[d][i] > 0 || p.grid[d][(i + 16) % p.steps] > 0 ? 'x' : '.'));
  }
  return { hits, p, truth, exp, got };
}

describe('détection des coups', () => {
  it('trouve tous les coups du rythme de Thomas à 90 BPM, sans faux positif', () => {
    const { signal, sr, truth } = renderBeatbox(THOMAS, { bpm: 90, loops: 2, jitterMs: 10, noise: 0.01 });
    const hits = analyzeHits(signal, sr);
    expect(hits.length).toBe(truth.length);
    hits.forEach((h, i) => expect(Math.abs(h.time - truth[i].time)).toBeLessThan(0.03));
  });
});

describe('classification', () => {
  it('reconnaît kick / caisse claire / charley', () => {
    const { signal, sr, truth } = renderBeatbox(BOOMBAP, { bpm: 90, loops: 2, jitterMs: 8 });
    const hits = analyzeHits(signal, sr);
    const sorted = [...truth].sort((a, b) => a.time - b.time);
    expect(hits.length).toBe(sorted.length);
    const correct = hits.filter((h, i) => h.cls === sorted[i].cls).length;
    expect(correct / hits.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe('tempo', () => {
  for (const bpm of [80, 88, 90, 92, 95, 100, 120, 140]) {
    it(`retrouve ${bpm} BPM (à ±1)`, () => {
      const { signal, sr } = renderBeatbox(BOOMBAP, { bpm, loops: 2, jitterMs: 8, seed: bpm });
      const hits = analyzeHits(signal, sr);
      const est = estimateBpm(hits.map((h) => h.time));
      expect(Math.abs(est - bpm)).toBeLessThanOrEqual(1);
    });
  }
});

describe('pipeline complet → grille 16 pas', () => {
  it('rythme de Thomas : grille exacte', () => {
    const { p, exp, got } = check(THOMAS, 90, { jitterMs: 12, noise: 0.01 });
    console.log('\nRythme de Thomas (' + p.bpm + ' BPM, ' + p.bars + ' mesure(s))\n' + patternToText(p));
    expect(got).toEqual(exp);
  });
  it('boom bap avec charleys + timing humain (±15 ms) : grille exacte', () => {
    const { p, exp, got } = check(BOOMBAP, 92, { jitterMs: 15, noise: 0.01, seed: 7 });
    console.log('\nBoom bap (' + p.bpm + ' BPM)\n' + patternToText(p));
    expect(got).toEqual(exp);
  });
  it('robuste sur 10 graines aléatoires (≥ 9/10 grilles parfaites)', () => {
    let ok = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { exp, got } = check(BOOMBAP, 85 + seed, { jitterMs: 15, noise: 0.015, seed });
      if (JSON.stringify(exp) === JSON.stringify(got)) ok++;
    }
    console.log(`\nGrilles parfaites : ${ok}/10`);
    expect(ok).toBeGreaterThanOrEqual(9);
  });
});
