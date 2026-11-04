// Kit de batterie : synthétisé par défaut (zéro fichier à télécharger).
// Pour utiliser tes propres samples : dépose kick.wav, snare.wav, hihat.wav dans public/samples/
// — ils sont chargés automatiquement à la place des sons synthétisés.
import * as Tone from 'tone';
import type { DrumClass } from './analysis';

export interface Kit {
  trigger(d: DrumClass, time: number, velocity: number): void;
  source: 'samples' | 'synth';
}

function synthKit(out: Tone.ToneAudioNode): Kit {
  const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 } }).connect(out);
  const snareFilter = new Tone.Filter(1800, 'bandpass').connect(out);
  const snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.18, sustain: 0 } }).connect(snareFilter);
  const snareBody = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(out);
  snareBody.volume.value = -10;
  const hatFilter = new Tone.Filter(7000, 'highpass').connect(out);
  const hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(hatFilter);
  hat.volume.value = -8;
  return {
    source: 'synth',
    trigger(d, time, v) {
      if (d === 'kick') kick.triggerAttackRelease('C1', '8n', time, v);
      else if (d === 'snare') {
        snare.triggerAttackRelease('16n', time, v);
        snareBody.triggerAttackRelease('G2', '16n', time, v);
      } else hat.triggerAttackRelease('32n', time, v * 0.8);
    },
  };
}

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export async function loadKit(): Promise<Kit> {
  const out = new Tone.Compressor(-12, 3).toDestination();
  if (import.meta.env.MODE === 'artifact') return synthKit(out);
  const base = import.meta.env.BASE_URL + 'samples/';
  const names: DrumClass[] = ['kick', 'snare', 'hihat'];
  // On teste d'abord le kick seul : sans lui, inutile de chercher les autres (moins de 404 en console)
  if (!(await exists(base + 'kick.wav'))) return synthKit(out);
  const found = await Promise.all(names.slice(1).map((n) => exists(base + n + '.wav')));
  if (!found.every(Boolean)) return synthKit(out);
  const players = new Tone.Players(Object.fromEntries(names.map((n) => [n, base + n + '.wav']))).connect(out);
  await Tone.loaded();
  return {
    source: 'samples',
    trigger(d, time, v) {
      const p = players.player(d);
      p.volume.value = Tone.gainToDb(v);
      p.start(time);
    },
  };
}
