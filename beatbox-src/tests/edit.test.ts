import { describe as group, it, expect } from 'vitest';
import { emptyPattern, setTrack, setSteps, setTempo, localCommand, describe } from '../src/edit';

group('actions sur la boucle', () => {
  it('setTrack répète un motif de 16 pas sur 2 mesures', () => {
    const p = emptyPattern(90, 2);
    setTrack(p, 'kick', 'x.......x.......');
    expect(p.grid.kick.map((v) => (v > 0 ? 'x' : '.')).join('')).toBe('x.......x.......x.......x.......');
  });
  it('setSteps ajoute et retire des coups (pas numérotés à partir de 1)', () => {
    const p = emptyPattern();
    setSteps(p, 'caisse claire', [5, 13], true);
    expect(p.grid.snare[4]).toBeGreaterThan(0);
    const r = setSteps(p, 'snare', [5], false);
    expect(p.grid.snare[4]).toBe(0);
    expect(r.changed).toEqual([4]);
  });
  it('refuse un tempo absurde et une piste inconnue', () => {
    const p = emptyPattern();
    expect(() => setTempo(p, 500)).toThrow();
    expect(() => setTrack(p, 'guitare', 'x')).toThrow();
  });
  it('describe donne une grille lisible', () => {
    const p = emptyPattern();
    setTrack(p, 'kick', 'x...');
    expect(describe(p)).toContain('kick  |x...|x...|x...|x...');
  });
});

group('commandes sans IA', () => {
  it('« passe à 95 bpm »', () => {
    const p = emptyPattern();
    localCommand('passe à 95 bpm', p);
    expect(p.bpm).toBe(95);
  });
  it('« ajoute des charleys » puis « enlève les charleys »', () => {
    const p = emptyPattern();
    localCommand('ajoute des charleys', p);
    expect(p.grid.hihat.filter((v) => v > 0).length).toBe(8);
    localCommand('enlève les charleys', p);
    expect(p.grid.hihat.filter((v) => v > 0).length).toBe(0);
  });
  it('« joue » et « stop »', () => {
    expect(localCommand('joue', null).play).toBe(true);
    expect(localCommand('stop', null).stop).toBe(true);
  });
});
