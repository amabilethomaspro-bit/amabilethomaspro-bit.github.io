import { describe, it, expect } from 'vitest';
import { patternToMidi } from '../src/midi';
import type { Pattern } from '../src/analysis';

describe('export MIDI', () => {
  it('produit un fichier MIDI valide avec les bonnes notes de batterie', () => {
    const p: Pattern = { bpm: 90, bars: 1, steps: 16, offset: 0, grid: {
      kick: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hihat: new Array(16).fill(0).map((_, i) => (i % 2 ? 0 : 0.5)) } };
    const m = patternToMidi(p);
    expect(String.fromCharCode(...m.slice(0, 4))).toBe('MThd');
    expect(String.fromCharCode(...m.slice(14, 18))).toBe('MTrk');
    const len = (m[18] << 24) | (m[19] << 16) | (m[20] << 8) | m[21];
    expect(m.length).toBe(22 + len);
    let on = { 36: 0, 38: 0, 42: 0 } as Record<number, number>;
    for (let i = 22; i < m.length - 2; i++) if (m[i] === 0x99) on[m[i + 1]]++;
    expect(on).toEqual({ 36: 2, 38: 2, 42: 8 });
    // tempo 90 BPM = 666667 µs par noire
    const t = m.indexOf(0x51);
    expect((m[t + 2] << 16) | (m[t + 3] << 8) | m[t + 4]).toBe(666667);
  });
});
