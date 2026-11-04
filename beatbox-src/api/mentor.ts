// Fonction serveur Vercel : recoit la conversation + les outils du navigateur,
// interroge Gemini (function calling), et renvoie la reponse brute (texte ou appel
// d'outil). La cle API vit UNIQUEMENT ici, en variable d'environnement GEMINI_KEY :
// jamais dans le code, jamais dans le depot, jamais cote navigateur.
//
// Variables d'environnement a regler dans Vercel :
//   GEMINI_KEY    (obligatoire) ta cle Google AI Studio, qui commence par AIza...
//   GEMINI_MODEL  (optionnel)   defaut : gemini-3.8-flash

const RULES = `Tu es un beatmaker hip-hop experimente qui coache un jeune beatmaker plein d'idees mais peu technique, dans une appli de MAO. Il beatboxe ses rythmes, l'appli les transforme en boucle de batterie (pistes kick, snare, hihat ; grille de 16 pas par mesure, x = coup).
Regles :
- Reponds en francais, tutoiement, ton direct et chaleureux de studio. 2 a 4 phrases maximum, pas de listes, pas de titres.
- Quand il demande un changement, fais-le toi-meme avec les outils, puis dis en une phrase ce que tu as change et pourquoi ca sonne mieux.
- Pas numerotes de 1 a 16 par mesure (temps forts : 1, 5, 9, 13 ; caisse claire classique sur 5 et 13).
- Donne des conseils concrets de beatmaker (groove, placement, references de style) sans jargon inutile.
- L'appli ne fait que la batterie pour l'instant : pas encore de melodie, de basse ni de samples. Si on te le demande, dis que ca arrive bientot.`;

function readBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c: any) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Methode non autorisee' });
    return;
  }
  const key = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'GEMINI_KEY manquante cote serveur (a regler dans Vercel).' });
    return;
  }

  const body = await readBody(req);
  const contents = Array.isArray(body?.contents) ? body.contents : [];
  const toolDecls = Array.isArray(body?.tools) ? body.tools : [];
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  const payload: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: RULES }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
  };
  if (toolDecls.length) payload.tools = [{ functionDeclarations: toolDecls }];

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) +
    ':generateContent?key=' +
    encodeURIComponent(key);

  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
  // Gemini renvoie parfois 503 (surcharge) ou 429 : on reessaie quelques fois
  // avec une petite attente avant d'abandonner.
  let r: Response | null = null;
  let netFail = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((done) => setTimeout(done, 700 * attempt));
    try {
      r = await fetch(url, init);
    } catch {
      netFail = 'reseau';
      r = null;
      continue;
    }
    if (r.status === 503 || r.status === 429) continue; // surcharge -> nouvel essai
    break;
  }

  if (!r) {
    res.status(502).json({ error: 'Impossible de joindre Gemini.', detail: netFail });
    return;
  }
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 300);
    const overloaded = r.status === 503 || r.status === 429;
    res.status(overloaded ? 503 : 502).json({
      error: overloaded
        ? 'Gemini est surcharge la (' + r.status + '), reessaie dans un instant.'
        : 'Gemini a renvoye ' + r.status,
      detail,
    });
    return;
  }

  const data: any = await r.json().catch(() => null);
  const parts = data?.candidates?.[0]?.content?.parts ?? [
    { text: "Je n'ai pas de reponse la, reessaie." },
  ];
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ parts });
}
