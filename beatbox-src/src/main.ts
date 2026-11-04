import './style.css';
import * as Tone from 'tone';
import { analyze, toMono, DRUMS, type DrumClass, type Hit, type Pattern } from './analysis';
import { patternToMidi } from './midi';
import { loadKit, type Kit } from './drums';
import { renderBeatbox, type Placed } from './synth';
import { zipStore } from './zip';
import { describe, localCommand, setSteps, setTempo, setTrack, TRACK_FR } from './edit';
import { createRemoteSample, type Sample, type SampleTool } from './ai';

// Version « page en ligne » (npm run build:artifact) : pas de micro, enregistrement via le Dictaphone puis import.
const ARTIFACT = import.meta.env.MODE === 'artifact';

// ---------- Capacités de la page en ligne (absentes en local) ----------
type Downloads = { save(r: { filename: string; data: string | Blob | ArrayBufferView }): Promise<unknown> };
const claudeRt = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
// Dans l'appli Claude : capacite `sample`. Ailleurs (github.io, Vercel) : notre fonction
// serveur Gemini via /api/mentor (qui tombe en commandes simples si elle n'existe pas).
const sampleReady = (claudeRt?.use('sample') as Promise<Sample | null> | undefined) ?? Promise.resolve(createRemoteSample());
const downloadsReady = (claudeRt?.use('downloads') as Promise<Downloads | null> | undefined) ?? Promise.resolve(null);
let aiOff = false; // true si l'IA est refusée ou indisponible : on bascule en commandes simples

// ---------- Interface ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  play: $<HTMLButtonElement>('play'), stop: $<HTMLButtonElement>('stop'), bpm: $<HTMLInputElement>('bpm'),
  toggleGrid: $<HTMLButtonElement>('toggleGrid'), menuBtn: $<HTMLButtonElement>('menuBtn'), menu: $<HTMLDivElement>('menu'),
  withOrig: $<HTMLInputElement>('withOrig'), bars: $<HTMLSelectElement>('bars'), sens: $<HTMLInputElement>('sens'),
  playOrig: $<HTMLButtonElement>('playOrig'), midi: $<HTMLButtonElement>('midi'), json: $<HTMLButtonElement>('json'),
  gridWrap: $<HTMLDivElement>('gridWrap'), empty: $<HTMLDivElement>('empty'), grid: $<HTMLDivElement>('grid'), wave: $<HTMLCanvasElement>('wave'),
  thread: $<HTMLElement>('thread'), chips: $<HTMLDivElement>('chips'), form: $<HTMLFormElement>('form'),
  file: $<HTMLInputElement>('file'), rec: $<HTMLButtonElement>('rec'), input: $<HTMLTextAreaElement>('input'), send: $<HTMLButtonElement>('send'),
};
const LABEL: Record<DrumClass, string> = { kick: 'Kick', snare: 'Snare', hihat: 'Hat' };
const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';

let signal: Float32Array | null = null;
let sampleRate = 44100;
let hits: Hit[] = [];
let pattern: Pattern | null = null;
let kit: Kit | null = null;
let seq: Tone.Sequence<number> | null = null;
let voice: Tone.Player | null = null;
let recorder: MediaRecorder | null = null;
let cells: HTMLButtonElement[][] = [];
let busy: AbortController | null = null;
const turns: { role: 'user' | 'assistant'; content: string }[] = [];

if (ARTIFACT) ui.rec.hidden = true;

// ---------- Fil de discussion ----------
const scrollDown = () => (ui.thread.scrollTop = ui.thread.scrollHeight);

function addMsg(role: 'user' | 'ai', text = '', extra?: HTMLElement) {
  const m = document.createElement('div');
  m.className = 'msg ' + role;
  if (role === 'ai') {
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = 'Mentor';
    m.appendChild(who);
  }
  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = text;
  m.appendChild(body);
  if (extra) m.appendChild(extra);
  ui.thread.appendChild(m);
  scrollDown();
  return { m, body };
}

function attachMsg(name: string) {
  const { body } = addMsg('user');
  body.className = 'attach';
  body.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  body.append(document.createTextNode(name));
}

function patternCard(p: Pattern, head: string) {
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('div');
  h.textContent = `${head} · ${p.bpm} BPM · ${p.bars} mesure${p.bars > 1 ? 's' : ''}`;
  const pat = document.createElement('div');
  pat.className = 'pat';
  const cls: Record<DrumClass, string> = { kick: 'k', snare: 's', hihat: 'h' };
  for (const d of DRUMS) {
    const line = document.createElement('div');
    const b = document.createElement('b');
    b.className = cls[d];
    b.textContent = LABEL[d].padEnd(6);
    line.append(b, document.createTextNode(p.grid[d].slice(0, 16).map((v, i) => (i % 4 === 0 ? ' ' : '') + (v > 0 ? 'x' : '·')).join('')));
    pat.appendChild(line);
  }
  card.append(h, pat);
  return card;
}

function setChips(list: string[]) {
  ui.chips.innerHTML = '';
  for (const label of list) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.textContent = label;
    c.onclick = () => (label === "Essayer l'exemple" ? runDemo() : sendText(label));
    ui.chips.appendChild(c);
  }
}

// ---------- Audio entrant ----------
async function decodeAndLoad(buf: ArrayBuffer, name: string) {
  const ctx = Tone.getContext().rawContext as BaseAudioContext;
  const audio = await ctx.decodeAudioData(buf);
  const chans = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  loadSignal(toMono(chans), audio.sampleRate, name);
}

function loadSignal(sig: Float32Array, sr: number, name: string) {
  stop();
  attachMsg(name);
  signal = sig;
  sampleRate = sr;
  runAnalysis();
  if (!pattern) return;
  if (!hits.length) {
    addMsg('ai', "Je n'ai entendu aucun coup. Rapproche le téléphone de ta bouche, tape plus franchement les « boum » et les « tchac », et renvoie-le.");
    return;
  }
  const counts = DRUMS.map((d) => `${hits.filter((h) => h.cls === d).length} ${TRACK_FR[d]}`).join(', ');
  const summary = `J'ai entendu ${hits.length} coups (${counts}), calés à ${pattern.bpm} BPM. Ta boucle est en haut : lance-la pour l'écouter, ou dis-moi ce que tu veux changer.`;
  addMsg('ai', summary, patternCard(pattern, `${hits.length} coups`));
  turns.push({ role: 'user', content: `[J'envoie un beatbox enregistré : ${name}]` }, { role: 'assistant', content: summary });
  setChips(['Joue la boucle', 'Ajoute des charleys', 'Explique mon rythme', 'Plus lent']);
}

ui.file.onchange = async () => {
  const f = ui.file.files?.[0];
  ui.file.value = '';
  if (!f) return;
  await Tone.start();
  try {
    await decodeAndLoad(await f.arrayBuffer(), f.name);
  } catch {
    addMsg('ai', 'Je ne sais pas lire ce fichier. Envoie un mémo du Dictaphone (.m4a), un .wav ou un .mp3.');
  }
};

ui.rec.onclick = async () => {
  await Tone.start();
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      ui.rec.classList.remove('recording');
      ui.input.placeholder = 'Dis-moi ce que tu veux changer…';
      try {
        await decodeAndLoad(await new Blob(chunks).arrayBuffer(), 'Enregistrement micro');
      } catch (e) {
        addMsg('ai', "Impossible de lire l'enregistrement : " + (e as Error).message);
      }
    };
    recorder.start();
    ui.rec.classList.add('recording');
    ui.input.placeholder = 'Ça enregistre… beatboxe 2 fois ton rythme, puis retouche le micro.';
  } catch (e) {
    addMsg('ai', 'Micro refusé ou indisponible : ' + (e as Error).message);
  }
};

async function runDemo() {
  await Tone.start();
  const cls: DrumClass[] = ['kick', 'snare', 'snare', 'kick', 'snare', 'kick', 'snare', 'snare'];
  const placed: Placed[] = cls.map((c, i) => ({ step: i * 2, cls: c }));
  const { signal: s, sr } = renderBeatbox(placed, { bpm: 90, loops: 2, jitterMs: 12, noise: 0.01, seed: 3 });
  loadSignal(s, sr, 'Exemple : boum tchac tchac boum tchac boum tchac tchac');
}

// ---------- Analyse et grille ----------
function runAnalysis(keepBpm = false) {
  if (!signal) return;
  const bars = ui.bars.value === 'auto' ? undefined : Number(ui.bars.value);
  const bpm = keepBpm && pattern ? pattern.bpm : undefined;
  const res = analyze(signal, sampleRate, { sensitivity: Number(ui.sens.value), bpm, bars });
  hits = res.hits;
  pattern = res.pattern;
  refreshStudio();
}
ui.sens.onchange = () => runAnalysis(true);
ui.bars.onchange = () => runAnalysis(true);

function refreshStudio(flash: { track: DrumClass; changed: number[] }[] = []) {
  const has = !!pattern;
  ui.empty.hidden = has;
  ui.grid.hidden = !has;
  ui.wave.hidden = !signal;
  for (const b of [ui.play, ui.stop, ui.bpm]) b.disabled = !has;
  if (!pattern) return;
  ui.bpm.value = String(pattern.bpm);
  if (seq) Tone.getTransport().bpm.value = pattern.bpm;
  buildGrid();
  for (const f of flash) {
    const row = cells[DRUMS.indexOf(f.track)];
    for (const i of f.changed) {
      const c = row[i];
      if (!c) continue;
      c.classList.remove('flash');
      void c.offsetWidth;
      c.classList.add('flash');
    }
  }
  drawWave();
  persist();
}
ui.bpm.onchange = () => {
  if (!pattern) return;
  try {
    setTempo(pattern, ui.bpm.value);
  } catch {
    /* hors limites : on garde l'ancien tempo */
  }
  refreshStudio();
};

function buildGrid() {
  if (!pattern) return;
  const p = pattern;
  ui.grid.innerHTML = '';
  ui.grid.style.gridTemplateColumns = `auto repeat(${p.steps}, minmax(14px, 1fr))`;
  cells = [];
  for (const d of DRUMS) {
    const lab = document.createElement('div');
    lab.className = 'lab';
    lab.textContent = LABEL[d];
    ui.grid.appendChild(lab);
    const row: HTMLButtonElement[] = [];
    for (let i = 0; i < p.steps; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cell ${d}` + (i % 4 === 0 ? ' beat' : '') + (i % 16 === 0 && i > 0 ? ' bar' : '');
      b.setAttribute('aria-label', `${TRACK_FR[d]}, pas ${i + 1}`);
      const paint = () => {
        b.classList.toggle('on', p.grid[d][i] > 0);
        b.setAttribute('aria-pressed', String(p.grid[d][i] > 0));
      };
      paint();
      b.onclick = () => {
        p.grid[d][i] = p.grid[d][i] > 0 ? 0 : 0.85;
        paint();
        persist();
      };
      row.push(b);
      ui.grid.appendChild(b);
    }
    cells.push(row);
  }
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function drawWave() {
  if (!signal || ui.wave.hidden) return;
  const c = ui.wave;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, c.clientWidth * dpr);
  c.height = 44 * dpr;
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.fillStyle = cssVar('--cell');
  g.fillRect(0, 0, W, H);
  const dur = signal.length / sampleRate;
  g.fillStyle = cssVar('--muted');
  const per = Math.max(1, Math.floor(signal.length / W));
  for (let x = 0; x < W; x++) {
    let m = 0;
    for (let i = x * per; i < Math.min(signal.length, (x + 1) * per); i++) m = Math.max(m, Math.abs(signal[i]));
    const h = Math.max(dpr, m * H * 0.9);
    g.fillRect(x, (H - h) / 2, 1, h);
  }
  for (const h of hits) {
    g.fillStyle = cssVar('--' + h.cls);
    g.fillRect((h.time / dur) * W - dpr, 0, 2 * dpr, H);
  }
}
window.addEventListener('resize', drawWave);

// ---------- Lecture ----------
function highlight(i: number) {
  for (const row of cells) row.forEach((c, j) => c.classList.toggle('now', j === i));
}
async function play() {
  if (!pattern) return;
  await Tone.start();
  if (!kit) kit = await loadKit();
  const k = kit;
  stop();
  const p = pattern;
  const transport = Tone.getTransport();
  transport.bpm.value = p.bpm;
  seq = new Tone.Sequence<number>((time, i) => {
    for (const d of DRUMS) if (p.grid[d][i] > 0) k.trigger(d, time, p.grid[d][i]);
    Tone.getDraw().schedule(() => highlight(i), time);
  }, Array.from({ length: p.steps }, (_, i) => i), '16n');
  seq.start(0);
  if (ui.withOrig.checked && signal) {
    const loopDur = (60 / p.bpm / 4) * p.steps;
    voice = new Tone.Player(toBuffer(signal, sampleRate)).toDestination();
    voice.volume.value = -6;
    voice.loop = true;
    voice.loopStart = Math.max(0, p.offset - 0.01);
    voice.loopEnd = voice.loopStart + loopDur;
    voice.sync().start(0, voice.loopStart);
  }
  transport.start('+0.05');
}
function stop() {
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  seq?.dispose();
  seq = null;
  if (voice) {
    voice.unsync();
    voice.stop();
    voice.dispose();
    voice = null;
  }
  highlight(-1);
}
function toBuffer(sig: Float32Array, sr: number) {
  const ctx = Tone.getContext().rawContext as BaseAudioContext;
  const b = ctx.createBuffer(1, sig.length, sr);
  b.copyToChannel(sig as Float32Array<ArrayBuffer>, 0);
  return new Tone.ToneAudioBuffer(b);
}
ui.play.onclick = () => play();
ui.stop.onclick = () => stop();
ui.playOrig.onclick = async () => {
  if (!signal) return;
  await Tone.start();
  stop();
  voice = new Tone.Player(toBuffer(signal, sampleRate)).toDestination();
  voice.start();
};
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
    e.preventDefault();
    if (seq) stop();
    else play();
  }
});

ui.toggleGrid.onclick = () => {
  const open = ui.gridWrap.hidden;
  ui.gridWrap.hidden = !open;
  ui.toggleGrid.setAttribute('aria-expanded', String(open));
  drawWave();
};
ui.menuBtn.onclick = () => {
  const open = ui.menu.hidden;
  ui.menu.hidden = !open;
  ui.menuBtn.setAttribute('aria-expanded', String(open));
};

// ---------- Mentor IA ----------
const RULES = `Tu es un beatmaker hip-hop expérimenté qui coache un jeune beatmaker plein d'idées mais peu technique, dans une appli de MAO. Il beatboxe ses rythmes, l'appli les transforme en boucle de batterie (pistes kick, snare, hihat ; grille de 16 pas par mesure, x = coup).
Règles :
- Réponds en français, tutoiement, ton direct et chaleureux de studio. 2 à 4 phrases maximum, pas de listes, pas de titres.
- Quand il demande un changement, fais-le toi-même avec les outils, puis dis en une phrase ce que tu as changé et pourquoi ça sonne mieux.
- Pas numérotés de 1 à 16 par mesure (temps forts : 1, 5, 9, 13 ; caisse claire classique sur 5 et 13).
- Donne des conseils concrets de beatmaker (groove, placement, références de style) sans jargon inutile.
- L'appli ne fait que la batterie pour l'instant : pas encore de mélodie, de basse ni de samples. Si on te le demande, dis que ça arrive bientôt.`;

function loopTools(): SampleTool[] {
  const after = (r: { track: DrumClass; changed: number[] }) => {
    refreshStudio([r]);
    return 'OK. Boucle maintenant :\n' + describe(pattern!);
  };
  const piste = { type: 'string', enum: ['kick', 'snare', 'hihat'] };
  return [
    { name: 'voir_boucle', description: 'Renvoie la boucle actuelle (tempo et grille de chaque piste).', execute: () => describe(pattern!) },
    {
      name: 'regler_tempo', description: 'Change le tempo de la boucle en BPM (40 à 220).',
      inputSchema: { type: 'object', properties: { bpm: { type: 'number' } }, required: ['bpm'] },
      execute: (i) => { const t = setTempo(pattern!, i.bpm); refreshStudio(); return t; },
    },
    {
      name: 'ecrire_piste', description: 'Remplace toute une piste par un motif de 16 caractères (x = coup, . = silence), répété sur chaque mesure. Ex : snare "....x.......x...".',
      inputSchema: { type: 'object', properties: { piste, motif: { type: 'string' } }, required: ['piste', 'motif'] },
      execute: (i) => after(setTrack(pattern!, i.piste, i.motif)),
    },
    {
      name: 'modifier_pas', description: 'Ajoute (actif=true) ou retire (actif=false) des coups sur une piste aux pas donnés, numérotés à partir de 1 sur toute la boucle.',
      inputSchema: { type: 'object', properties: { piste, pas: { type: 'array', items: { type: 'integer' } }, actif: { type: 'boolean' } }, required: ['piste', 'pas', 'actif'] },
      execute: (i) => after(setSteps(pattern!, i.piste, i.pas, i.actif)),
    },
    { name: 'lancer_lecture', description: 'Lance la lecture de la boucle en continu.', execute: () => { play(); return 'Lecture lancée.'; } },
    { name: 'arreter_lecture', description: 'Arrête la lecture.', execute: () => { stop(); return 'Lecture arrêtée.'; } },
  ];
}

function setBusy(on: boolean) {
  ui.send.innerHTML = on ? STOP_ICON : SEND_ICON;
  ui.send.setAttribute('aria-label', on ? 'Arrêter' : 'Envoyer');
}

function applyLocal(text: string) {
  const r = localCommand(text, pattern);
  if (r.play) play();
  if (r.stop) stop();
  refreshStudio(r.changed ?? []);
  addMsg('ai', r.text);
}

async function sendText(raw: string) {
  const text = raw.trim();
  if (!text || busy) return;
  addMsg('user', text);
  ui.input.value = '';
  autoGrow();
  const sample = aiOff ? null : await sampleReady;
  if (!sample) return applyLocal(text);

  const { m, body } = addMsg('ai', 'Je réfléchis');
  m.classList.add('thinking');
  busy = new AbortController();
  setBusy(true);
  const state = pattern
    ? `\n\n(État actuel de la boucle :\n${describe(pattern)})`
    : "\n\n(Pas encore de boucle : il doit envoyer un beatbox avec le trombone ou toucher « Essayer l'exemple ».)";
  turns.push({ role: 'user', content: text });
  const input = [{ role: 'user' as const, content: RULES }, ...turns.slice(-12, -1), { role: 'user' as const, content: text + state }];
  const opts: Record<string, unknown> = {
    signal: busy.signal,
    modelTier: 'quick',
    onText: ({ text: t }: { text: string }) => {
      m.classList.remove('thinking');
      body.textContent = t;
      scrollDown();
    },
  };
  if (pattern) opts.tools = loopTools();
  else opts.cache = false;
  try {
    const res = await sample(input, opts);
    m.classList.remove('thinking');
    body.textContent = res.text;
    turns.push({ role: 'assistant', content: res.text });
  } catch (e) {
    m.classList.remove('thinking');
    const err = e as { code?: string; text?: string };
    turns.pop();
    if (err.code === 'cancelled') {
      body.textContent = err.text || 'Arrêté.';
    } else if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'tools_unavailable'].includes(err.code ?? '')) {
      aiOff = true;
      m.remove();
      addMsg('ai', "L'IA n'est pas autorisée sur cette page, je passe en commandes simples.");
      applyLocal(text);
    } else if (err.code === 'rate_limited') {
      body.textContent = "Trop de demandes d'un coup : attends un instant et renvoie ton message.";
    } else if (err.code === 'refused') {
      body.textContent = 'Je ne peux pas répondre à ça. Reformule ta demande sur la boucle.';
    } else {
      body.textContent = (err.text ? err.text + '\n\n' : '') + 'La connexion a coupé. Renvoie ton message pour réessayer.';
    }
  } finally {
    busy = null;
    setBusy(false);
    scrollDown();
    persist();
  }
}

ui.form.onsubmit = (e) => {
  e.preventDefault();
  if (busy) busy.abort();
  else sendText(ui.input.value);
};
function autoGrow() {
  ui.input.style.height = 'auto';
  ui.input.style.height = Math.min(120, ui.input.scrollHeight) + 'px';
}
ui.input.oninput = autoGrow;
ui.input.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    ui.form.requestSubmit();
  }
};

// ---------- Export ----------
function localDownload(data: BlobPart, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function saveOnline(filename: string, data: string | Uint8Array) {
  const dl = await downloadsReady;
  if (!dl) {
    addMsg('ai', "L'enregistrement de fichiers n'est pas disponible ici.");
    return;
  }
  try {
    await dl.save({ filename, data });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== 'declined') addMsg('ai', "Impossible d'enregistrer le fichier (" + (code ?? 'erreur') + ').');
  }
}
ui.midi.onclick = () => {
  if (!pattern) return;
  const base = `beat-${Math.round(pattern.bpm)}bpm`;
  const midi = patternToMidi(pattern, 2);
  // Le .mid seul n'est pas accepté par la page en ligne : on l'emballe dans un .zip
  if (ARTIFACT) saveOnline(base + '-midi.zip', zipStore([{ name: base + '.mid', data: midi }]));
  else localDownload(midi as Uint8Array<ArrayBuffer>, base + '.mid', 'audio/midi');
};
ui.json.onclick = () => {
  if (!pattern) return;
  const name = `beat-${Math.round(pattern.bpm)}bpm.json`;
  const text = JSON.stringify({ pattern, hits }, null, 2);
  if (ARTIFACT) saveOnline(name, text);
  else localDownload(text, name, 'application/json');
};

// ---------- Sauvegarde locale (survit au rechargement de la page) ----------
const SAVE_KEY = 'beatbox-studio-v1';
function persist() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        pattern,
        turns,
        bpm: ui.bpm.value,
        bars: ui.bars.value,
        sens: ui.sens.value,
        withOrig: ui.withOrig.checked,
      }),
    );
  } catch {
    /* quota atteint ou navigation privee : on ignore */
  }
}
function restore(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const d = JSON.parse(raw) as {
      pattern?: Pattern | null;
      turns?: { role: 'user' | 'assistant'; content: string }[];
      bpm?: string;
      bars?: string;
      sens?: string;
      withOrig?: boolean;
    };
    if (d.bars) ui.bars.value = d.bars;
    if (d.sens) ui.sens.value = d.sens;
    if (typeof d.withOrig === 'boolean') ui.withOrig.checked = d.withOrig;
    if (d.pattern?.grid) {
      pattern = d.pattern;
      if (d.bpm) ui.bpm.value = d.bpm;
    }
    if (Array.isArray(d.turns)) {
      for (const t of d.turns) {
        turns.push(t);
        addMsg(t.role === 'assistant' ? 'ai' : 'user', t.content);
      }
    }
    return !!pattern || turns.length > 0;
  } catch {
    return false;
  }
}
ui.withOrig.addEventListener('change', persist);

// ---------- Accueil ----------
const restored = restore();
if (!restored) {
  addMsg(
    'ai',
    ARTIFACT
      ? "Salut ! Enregistre ton rythme au Dictaphone, puis envoie-le-moi avec le trombone en bas. Je le transforme en boucle de batterie, et ensuite tu me dis ce que tu veux changer."
      : 'Salut ! Touche le micro et beatboxe ton rythme deux fois, ou envoie un audio avec le trombone. Je le transforme en boucle, et ensuite tu me dis ce que tu veux changer.',
  );
}
setChips(["Essayer l'exemple"]);
refreshStudio();

// Accès console pour déboguer : window.beat
Object.assign(window, { beat: { get pattern() { return pattern; }, get hits() { return hits; }, sendText } });
