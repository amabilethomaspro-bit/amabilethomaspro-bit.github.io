import { describe as group, it, expect, vi } from 'vitest';
import { createRemoteSample, type SampleTool } from '../src/ai';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const RULES = { role: 'user' as const, content: 'CONSIGNES SYSTEME' };

group('mentor distant (/api/mentor)', () => {
  it('renvoie le texte quand Gemini ne demande aucun outil', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ parts: [{ text: 'Salut, envoie un beatbox.' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const sample = createRemoteSample('/api/mentor');
    const res = await sample([RULES, { role: 'user', content: 'coucou' }], {});

    expect(res.text).toBe('Salut, envoie un beatbox.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Les consignes (input[0]) ne doivent PAS partir dans contents.
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.contents).toHaveLength(1);
    expect(sent.contents[0].parts[0].text).toBe('coucou');
  });

  it('execute un outil cote client puis renvoie la reponse finale', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ parts: [{ functionCall: { name: 'regler_tempo', args: { bpm: 100 } } }] }))
      .mockResolvedValueOnce(jsonResponse({ parts: [{ text: 'Tempo passe a 100, ca respire mieux.' }] }));
    vi.stubGlobal('fetch', fetchMock);

    let applied = 0;
    const tools: SampleTool[] = [
      {
        name: 'regler_tempo',
        description: 'Change le tempo',
        inputSchema: { type: 'object', properties: { bpm: { type: 'number' } } },
        execute: (i) => { applied = Number(i.bpm); return 'OK tempo ' + i.bpm; },
      },
    ];
    const sample = createRemoteSample('/api/mentor');
    const res = await sample([RULES, { role: 'user', content: 'mets 100 bpm' }], { tools });

    expect(applied).toBe(100);
    expect(res.text).toBe('Tempo passe a 100, ca respire mieux.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Au 2e appel, la reponse de l'outil doit avoir ete renvoyee au serveur.
    const second = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    const fr = second.contents.find((c: any) => c.parts?.[0]?.functionResponse);
    expect(fr.parts[0].functionResponse.response.result).toBe('OK tempo 100');
  });

  it('bascule en mode local (code capability_disabled) si /api/mentor est absent (404)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)));
    const sample = createRemoteSample('/api/mentor');
    await expect(sample([RULES, { role: 'user', content: 'hey' }], {})).rejects.toMatchObject({ code: 'capability_disabled' });
  });
});
