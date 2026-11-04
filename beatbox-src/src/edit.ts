// Actions sur la boucle, partagées par le mentor IA (outils) et le mode sans IA (commandes simples).
import { DRUMS, type DrumClass, type Pattern } from './analysis';

export const TRACK_FR: Record<DrumClass, string> = { kick: 'kick', snare: 'caisse claire', hihat: 'charley' };

export function emptyPattern(bpm = 90, bars = 1): Pattern {
  const steps = bars * 16;
  return { bpm, bars, steps, offset: 0, grid: { kick: new Array(steps).fill(0), snare: new Array(steps).fill(0), hihat: new Array(steps).fill(0) } };
}

export function parseTrack(v: unknown): DrumClass {
  const s = String(v ?? '').toLowerCase();
  if (/kick|grosse|boum|bass ?drum/.test(s)) return 'kick';
  if (/snare|caisse|claire|clap|tchac/.test(s)) return 'snare';
  if (/hat|charley|charleston|cymb|ts/.test(s)) return 'hihat';
  throw new Error('Piste inconnue : ' + s + ' (kick, snare ou hihat)');
}

/** Grille lisible : une ligne par piste, x = coup, . = vide, | toutes les 4 doubles-croches. */
export function describe(p: Pattern): string {
  const lines = DRUMS.map((d) => d.padEnd(6) + p.grid[d].map((v, i) => (i % 4 === 0 ? '|' : '') + (v > 0 ? 'x' : '.')).join(''));
  return `tempo ${p.bpm} BPM, ${p.bars} mesure(s) de 16 pas (pas 1 = début de mesure, temps forts aux pas 1, 5, 9, 13)\n` + lines.join('\n');
}

export function setTempo(p: Pattern, bpm: unknown): string {
  const b = Number(bpm);
  if (!isFinite(b) || b < 40 || b > 220) throw new Error('Tempo entre 40 et 220 BPM');
  p.bpm = Math.round(b * 2) / 2;
  return `Tempo réglé à ${p.bpm} BPM.`;
}

/** Remplace une piste par un motif « x... » (répété sur toutes les mesures s'il fait 16 pas). */
export function setTrack(p: Pattern, track: unknown, motif: unknown): { track: DrumClass; changed: number[] } {
  const d = parseTrack(track);
  const m = String(motif ?? '').replace(/[^xX.\-o0]/g, '');
  if (!m.length) throw new Error('Motif vide : utilise x pour un coup et . pour un silence');
  const before = p.grid[d].slice();
  for (let i = 0; i < p.steps; i++) {
    const c = m[i % m.length];
    p.grid[d][i] = c === 'x' || c === 'X' || c === 'o' ? Math.max(before[i], 0.85) || 0.85 : 0;
  }
  return { track: d, changed: diff(before, p.grid[d]) };
}

/** Ajoute (on=true) ou retire des coups aux pas donnés (numérotés à partir de 1). */
export function setSteps(p: Pattern, track: unknown, steps: unknown, on: unknown): { track: DrumClass; changed: number[] } {
  const d = parseTrack(track);
  const list = (Array.isArray(steps) ? steps : [steps]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= p.steps);
  if (!list.length) throw new Error(`Pas invalides : donne des numéros entre 1 et ${p.steps}`);
  const before = p.grid[d].slice();
  for (const n of list) p.grid[d][n - 1] = on === false || on === 'false' ? 0 : 0.85;
  return { track: d, changed: diff(before, p.grid[d]) };
}

function diff(a: number[], b: number[]): number[] {
  const out: number[] = [];
  a.forEach((v, i) => (v > 0) !== (b[i] > 0) && out.push(i));
  return out;
}

export interface LocalReply { text: string; changed?: { track: DrumClass; changed: number[] }[]; play?: boolean; stop?: boolean }

/** Mode sans IA : quelques commandes en français courant. */
export function localCommand(text: string, p: Pattern | null): LocalReply {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\b(joue|lance|play|ecoute)/.test(t)) return { text: 'Je lance la boucle.', play: true };
  if (/\b(stop|arrete|pause)/.test(t)) return { text: 'Stop.', stop: true };
  if (!p) return { text: "Envoie-moi d'abord un beatbox avec le trombone, ou touche « Essayer l'exemple »." };
  const num = t.match(/(\d{2,3}(?:[.,]\d)?)\s*(bpm)?/);
  if (num && /(bpm|tempo|vitesse|passe a|mets a|mets le)/.test(t)) return { text: setTempo(p, num[1].replace(',', '.')) + ' Écoute si le groove tient toujours.' };
  if (/plus (vite|rapide)|accelere/.test(t)) return { text: setTempo(p, p.bpm + 5) };
  if (/plus lent|ralenti|moins vite/.test(t)) return { text: setTempo(p, p.bpm - 5) };
  const removing = /(enleve|retire|supprime|vire|sans|coupe)/.test(t);
  let track: DrumClass | null = null;
  try { track = parseTrack(t); } catch { track = null; }
  if (track && removing) {
    const r = setTrack(p, track, '.');
    return { text: `J'ai vidé la piste ${TRACK_FR[track]}.`, changed: [r] };
  }
  if (track === 'hihat' && /(ajoute|mets|rajoute|des)/.test(t)) {
    const dbl = /double|16|rapide|serre/.test(t);
    const r = setTrack(p, 'hihat', dbl ? 'x' : 'x.');
    return { text: dbl ? "Charleys en doubles-croches : ça pousse plus, pratique pour la trap." : "Charleys sur chaque croche. C'est la base du boom bap : ça colle le kick et la caisse claire ensemble.", changed: [r] };
  }
  if (/explique|analyse|conseil|avis/.test(t)) {
    const n = (d: DrumClass) => p.grid[d].filter((v) => v > 0).length;
    const backbeat = p.grid.snare[4] > 0 && p.grid.snare[12] > 0;
    return { text: `${n('kick')} kicks, ${n('snare')} caisses claires, ${n('hihat')} charleys à ${p.bpm} BPM. ` + (backbeat ? 'Tes caisses claires tombent sur les temps 2 et 4 : c\'est le squelette classique du hip-hop.' : 'Tes caisses claires ne tombent pas toutes sur les temps 2 et 4 : ça donne un groove plus cassé, assume-le ou recale-les.') };
  }
  return { text: 'Sans IA, je comprends : « joue », « stop », « tempo 95 », « plus lent », « ajoute des charleys », « enlève le kick », « explique ». Dans l\'appli Claude, je comprends tout le reste.' };
}
