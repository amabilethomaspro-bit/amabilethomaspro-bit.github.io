// Moteur d'analyse du beatbox : audio brut -> coups détectés -> classés -> calés sur une grille.
// Aucune dépendance au navigateur : tout est testable dans Node (voir tests/).

export type DrumClass = 'kick' | 'snare' | 'hihat';
export const DRUMS: DrumClass[] = ['kick', 'snare', 'hihat'];

export interface Hit {
  time: number; // secondes depuis le début de l'enregistrement
  cls: DrumClass;
  strength: number; // 0..1, sert de vélocité
  features: { low: number; centroid: number; high: number };
}

export interface Pattern {
  bpm: number;
  bars: number;
  steps: number; // 16 par mesure
  grid: Record<DrumClass, number[]>; // vélocité 0..1 par pas, 0 = vide
  offset: number; // temps (s) du pas 0 dans l'enregistrement
}

const FRAME = 1024;
const HOP = 256;

// ---------- FFT radix-2 (en place) ----------
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
const HANN = hann(FRAME);

function magnitude(signal: Float32Array, start: number): Float64Array {
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const s = start + i;
    re[i] = s >= 0 && s < signal.length ? signal[s] * HANN[i] : 0;
  }
  fft(re, im);
  const mag = new Float64Array(FRAME / 2);
  for (let i = 0; i < FRAME / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// ---------- 1. Détection des coups (spectral flux + seuil adaptatif) ----------
export function detectOnsets(signal: Float32Array, sr: number, sensitivity = 1): number[] {
  const nFrames = Math.max(0, Math.floor((signal.length - FRAME) / HOP) + 1);
  if (nFrames < 3) return [];
  // Flux spectral calculé par bande (grave / médium / aigu), chaque bande normalisée à part :
  // un « boum » grave pèse autant qu'un « tss » aigu, même si son énergie tient dans 2 cases de FFT.
  const binHz = sr / FRAME;
  const bandOf = (k: number) => (k * binHz < 250 ? 0 : k * binHz < 5000 ? 1 : 2);
  const bands = [new Float64Array(nFrames), new Float64Array(nFrames), new Float64Array(nFrames)];
  let prev = magnitude(signal, 0);
  for (let f = 1; f < nFrames; f++) {
    const cur = magnitude(signal, f * HOP);
    for (let k = 1; k < cur.length; k++) {
      const d = Math.log1p(100 * cur[k]) - Math.log1p(100 * prev[k]);
      if (d > 0) bands[bandOf(k)][f] += d;
    }
    prev = cur;
  }
  const flux = new Float64Array(nFrames);
  for (const b of bands) {
    const m = Math.max(...b);
    if (m > 0) for (let f = 0; f < nFrames; f++) flux[f] = Math.max(flux[f], b[f] / m);
  }
  const max = Math.max(...flux);
  if (max <= 0) return [];
  for (let f = 0; f < nFrames; f++) flux[f] /= max;

  // Énergie par trame : sert à rejeter le bruit de fond et les queues de son
  const rms = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let e = 0;
    for (let i = f * HOP; i < f * HOP + FRAME; i++) e += signal[i] * signal[i];
    rms[f] = Math.sqrt(e / FRAME);
  }
  const sortedRms = Array.from(rms).sort((a, b) => a - b);
  const floor = Math.max(1e-6, sortedRms[Math.floor(sortedRms.length * 0.1)]);
  const gate = 6 / sensitivity; // un coup doit dépasser ~15 dB au-dessus du bruit de fond
  const peakAfter = (f: number) => Math.max(...rms.subarray(f, Math.min(nFrames, f + 6)));
  const before = (f: number) => Math.max(...rms.subarray(Math.max(0, f - 8), Math.max(1, f - 3)));

  // Seuil adaptatif : médiane locale + delta, ajusté par la sensibilité (1 = défaut, >1 = plus de coups)
  const win = Math.round(0.1 * sr / HOP); // ~100 ms de part et d'autre
  const delta = 0.12 / sensitivity;
  const minGap = Math.round(0.07 * sr / HOP); // 70 ms mini entre deux coups
  const onsets: number[] = [];
  let last = -Infinity;
  for (let f = 1; f < nFrames - 1; f++) {
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue; // pic local
    const lo = Math.max(0, f - win);
    const hi = Math.min(nFrames, f + win + 1);
    const local = Array.from(flux.subarray(lo, hi)).sort((a, b) => a - b);
    const median = local[Math.floor(local.length / 2)];
    if (flux[f] < median + delta) continue;
    if (f - last < minGap) continue;
    const pk = peakAfter(f);
    if (pk < floor * gate) continue; // trop faible : bruit de fond
    if (pk < before(f) * 1.4) continue; // pas de vraie montée : queue du son précédent
    onsets.push((f * HOP + FRAME / 2) / sr - 0.005);
    last = f;
  }
  return onsets.map((t) => Math.max(0, t));
}

// ---------- 2. Caractéristiques + classification par règles ----------
export function extractFeatures(signal: Float32Array, sr: number, time: number) {
  // Fenêtre de ~45 ms juste après l'attaque (2 trames FFT moyennées)
  const start = Math.round(time * sr);
  const a = magnitude(signal, start);
  const b = magnitude(signal, start + FRAME);
  const binHz = sr / FRAME;
  let total = 0, low = 0, high = 0, weighted = 0, peak = 0;
  for (let k = 1; k < a.length; k++) {
    const p = a[k] * a[k] + b[k] * b[k];
    const hz = k * binHz;
    total += p;
    weighted += p * hz;
    if (hz < 250) low += p;
    if (hz > 5000) high += p;
  }
  for (let i = start; i < Math.min(signal.length, start + 2 * FRAME); i++) peak = Math.max(peak, Math.abs(signal[i]));
  if (total === 0) return { low: 0, centroid: 0, high: 0, peak: 0 };
  return { low: low / total, centroid: weighted / total, high: high / total, peak };
}

export interface ClassifierSettings {
  kickLow: number; // part d'énergie < 250 Hz au-dessus de laquelle c'est un kick
  hatHigh: number; // part d'énergie > 5 kHz au-dessus de laquelle c'est un charley
}
export const DEFAULT_CLASSIFIER: ClassifierSettings = { kickLow: 0.35, hatHigh: 0.65 };

export function classify(f: { low: number; centroid: number; high: number }, s = DEFAULT_CLASSIFIER): DrumClass {
  if (f.low >= s.kickLow && f.centroid < 1500) return 'kick';
  if (f.high >= s.hatHigh || f.centroid >= 9000) return 'hihat';
  return 'snare';
}

export function analyzeHits(signal: Float32Array, sr: number, sensitivity = 1, s = DEFAULT_CLASSIFIER): Hit[] {
  const onsets = detectOnsets(signal, sr, sensitivity);
  const raw = onsets.map((time) => {
    const f = extractFeatures(signal, sr, time);
    return { time, f };
  });
  const maxPeak = Math.max(1e-9, ...raw.map((r) => r.f.peak));
  return raw.map(({ time, f }) => ({
    time,
    cls: classify(f, s),
    strength: Math.min(1, Math.max(0.3, f.peak / maxPeak)),
    features: { low: f.low, centroid: f.centroid, high: f.high },
  }));
}

// ---------- 3. Tempo : on cherche le BPM dont la grille de doubles-croches colle le mieux aux coups ----------
export function estimateBpm(times: number[], min = 70, max = 160): number {
  if (times.length < 3) return 90;
  const t0 = times[0];
  const scores: { bpm: number; err: number }[] = [];
  for (let bpm = min; bpm <= max + 1e-9; bpm += 0.5) {
    const step = 60 / bpm / 4;
    let err = 0;
    for (const t of times) {
      const x = (t - t0) / step;
      const d = x - Math.round(x);
      err += d * d;
    }
    scores.push({ bpm, err: err / times.length });
  }
  const best = Math.min(...scores.map((s) => s.err));
  // Ambiguïté d'octave (80 vs 160) : parmi les quasi-ex-aequo, on garde le plus lent
  const ok = scores.filter((s) => s.err <= best + 0.004);
  // Affinage au 1/20e de BPM autour du candidat, puis on arrondit à l'entier si c'est proche
  const coarse = ok[0].bpm;
  let fine = coarse, fineErr = Infinity;
  for (let bpm = coarse - 0.75; bpm <= coarse + 0.75; bpm += 0.05) {
    const step = 60 / bpm / 4;
    // ancrage moyen (et pas seulement le 1er coup) pour encaisser un premier coup en retard
    let err = 0;
    const phases = times.map((t) => { const x = t / step; return x - Math.round(x); });
    const mean = Math.atan2(phases.reduce((a, d) => a + Math.sin(2 * Math.PI * d), 0), phases.reduce((a, d) => a + Math.cos(2 * Math.PI * d), 0)) / (2 * Math.PI);
    for (const d of phases) { let e = d - mean; e -= Math.round(e); err += e * e; }
    if (err < fineErr) { fineErr = err; fine = bpm; }
  }
  const rounded = Math.round(fine);
  return Math.abs(fine - rounded) <= 0.35 ? rounded : Math.round(fine * 10) / 10;
}

// ---------- 4. Quantification sur la grille ----------
export function quantize(hits: Hit[], bpm: number, barsOverride?: number): Pattern {
  const step = 60 / bpm / 4;
  const offset = hits.length ? hits[0].time : 0;
  const span = hits.length ? hits[hits.length - 1].time - offset + step : step * 16;
  const bars = barsOverride ?? Math.min(4, Math.max(1, Math.ceil(span / (step * 16) - 0.05)));
  const steps = bars * 16;
  const grid = Object.fromEntries(DRUMS.map((d) => [d, new Array(steps).fill(0)])) as Record<DrumClass, number[]>;
  for (const h of hits) {
    const idx = ((Math.round((h.time - offset) / step) % steps) + steps) % steps;
    grid[h.cls][idx] = Math.max(grid[h.cls][idx], h.strength);
  }
  return { bpm, bars, steps, grid, offset };
}

export function analyze(signal: Float32Array, sr: number, opts: { sensitivity?: number; bpm?: number; bars?: number; classifier?: ClassifierSettings } = {}) {
  const hits = analyzeHits(signal, sr, opts.sensitivity ?? 1, opts.classifier);
  const bpm = opts.bpm ?? estimateBpm(hits.map((h) => h.time));
  return { hits, pattern: quantize(hits, bpm, opts.bars) };
}

// Mixe un AudioBuffer (ou des canaux) en mono
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

export function patternToText(p: Pattern): string {
  const label: Record<DrumClass, string> = { kick: 'KICK ', snare: 'SNARE', hihat: 'HAT  ' };
  return DRUMS.map((d) => label[d] + ' ' + p.grid[d].map((v, i) => (i % 4 === 0 ? '|' : '') + (v > 0 ? 'x' : '.')).join('')).join('\n');
}
