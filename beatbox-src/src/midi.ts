// Export MIDI (fichier .mid standard, canal batterie 10) : à glisser dans FL Studio, Ableton, Logic…
import { DRUMS, type DrumClass, type Pattern } from './analysis';

export const GM_NOTE: Record<DrumClass, number> = { kick: 36, snare: 38, hihat: 42 };

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

export function patternToMidi(p: Pattern, loops = 1): Uint8Array {
  const ppq = 96;
  const stepTicks = ppq / 4;
  const events: { tick: number; data: number[] }[] = [];
  const tempo = Math.round(60_000_000 / p.bpm);
  events.push({ tick: 0, data: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] });
  for (let l = 0; l < loops; l++) {
    for (const d of DRUMS) {
      p.grid[d].forEach((v, i) => {
        if (v <= 0) return;
        const tick = (l * p.steps + i) * stepTicks;
        const vel = Math.max(1, Math.min(127, Math.round(v * 127)));
        events.push({ tick, data: [0x99, GM_NOTE[d], vel] });
        events.push({ tick: tick + stepTicks - 1, data: [0x89, GM_NOTE[d], 0] });
      });
    }
  }
  events.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
  const track: number[] = [];
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const len = track.length;
  const trk = [0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return new Uint8Array([...header, ...trk, ...track]);
}
