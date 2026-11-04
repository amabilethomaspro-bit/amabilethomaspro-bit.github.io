// Mentor IA hors de l'appli Claude : parle a la fonction serveur /api/mentor (Gemini),
// execute les outils cote navigateur, puis renvoie la reponse finale. Meme contrat que
// la capacite `sample` de Claude, pour que main.ts n'ait presque rien a changer.

export type SampleTool = {
  name: string;
  description: string;
  inputSchema?: object;
  execute(input: Record<string, unknown>): unknown;
};

export type Sample = (
  input: { role: 'user' | 'assistant'; content: string }[],
  opts: object,
) => Promise<{ text: string }>;

type Part =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: string } } };

type Content = { role: 'user' | 'model'; parts: Part[] };

type SampleOpts = {
  tools?: SampleTool[];
  signal?: AbortSignal;
  onText?: (x: { text: string }) => void;
};

type MentorError = Error & { code?: string; text?: string };

function fail(message: string, code: string, text?: string): never {
  const e = new Error(message) as MentorError;
  e.code = code;
  if (text) e.text = text;
  throw e;
}

/**
 * Fabrique une fonction compatible avec la capacite `sample` de Claude, mais qui
 * passe par notre fonction serveur Gemini. Les outils (modifier la boucle, jouer...)
 * sont executes dans le navigateur ; le serveur decide seulement lequel appeler.
 */
export function createRemoteSample(endpoint = '/api/mentor'): Sample {
  return async (input, opts) => {
    const { tools = [], signal, onText } = opts as SampleOpts;

    // input[0] = les consignes (RULES), portees par le serveur -> on les retire ici.
    const contents: Content[] = input.slice(1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const toolDecls = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema ?? { type: 'object', properties: {} },
    }));

    let lastText = '';
    for (let round = 0; round < 6; round++) {
      let res: Response;
      try {
        const timeout = AbortSignal.timeout(45000);
        const reqSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        res = await fetch(endpoint, {
          method: 'POST',
          signal: reqSignal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents, tools: toolDecls }),
        });
      } catch {
        if (signal?.aborted) fail('Arrete.', 'cancelled');
        fail('Le mentor a mis trop de temps a repondre, reessaie.', 'connection');
      }
      if (res.status === 404) fail('Mentor indisponible ici.', 'capability_disabled');
      if (!res.ok) {
        const info = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        const d = info
          ? (info.error ?? '') + (info.detail ? ' — ' + info.detail : '')
          : 'HTTP ' + res.status;
        fail('Erreur serveur.', 'connection', d || 'HTTP ' + res.status);
      }

      const data = (await res.json()) as { parts?: Part[]; error?: string };
      if (data.error) fail(data.error, 'connection', data.error);
      const parts = data.parts ?? [];

      const text = parts
        .map((p) => ('text' in p ? p.text : ''))
        .join(' ')
        .trim();
      const calls = parts.filter(
        (p): p is { functionCall: { name: string; args?: Record<string, unknown> } } =>
          'functionCall' in p,
      );

      contents.push({ role: 'model', parts });

      if (text) {
        lastText = text;
        onText?.({ text });
      }
      if (calls.length === 0) return { text: lastText || 'OK.' };

      const responses: Part[] = [];
      for (const c of calls) {
        const tool = tools.find((t) => t.name === c.functionCall.name);
        let result: string;
        try {
          result = String(
            tool ? await tool.execute(c.functionCall.args ?? {}) : 'Outil inconnu.',
          );
        } catch (e) {
          result = 'Erreur : ' + ((e as Error)?.message ?? e);
        }
        responses.push({ functionResponse: { name: c.functionCall.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    return { text: lastText || "J'ai fait les ajustements. Dis-moi la suite." };
  };
}
