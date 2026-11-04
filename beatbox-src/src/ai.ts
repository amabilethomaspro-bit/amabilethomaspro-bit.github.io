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

type MentorError = Error & { code?: string };

function fail(message: string, code: string): never {
  const e = new Error(message) as MentorError;
  e.code = code;
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
        res = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents, tools: toolDecls }),
        });
      } catch (e) {
        if ((e as MentorError)?.name === 'AbortError') fail('Arrete.', 'cancelled');
        fail('Pas de connexion au mentor.', 'connection');
      }
      if (res.status === 404) fail('Mentor indisponible ici.', 'capability_disabled');
      if (!res.ok) fail('Le mentor a renvoye une erreur (' + res.status + ').', 'connection');

      const data = (await res.json()) as { parts?: Part[]; error?: string };
      if (data.error) fail(data.error, 'connection');
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
