# Beatbox → Boucle (prototype)

Tu beatboxes, l'appli détecte chaque coup, reconnaît kick / caisse claire / charley, trouve le tempo, cale tout sur une grille et te rejoue une vraie boucle de batterie. Exportable en MIDI pour ton logiciel de prod.

## Lancer (Mac)

1. Installer Node.js si absent : https://nodejs.org (version LTS), ou `brew install node`.
2. Double-cliquer sur `lancer.command` (la 1re fois : clic droit → Ouvrir, pour passer la sécurité macOS).
   Ou dans le Terminal, depuis ce dossier : `npm install` puis `npm run dev`.
3. Ouvrir http://localhost:5173 dans Chrome, autoriser le micro.

## Utiliser

- **Enregistrer** : beatboxe ton rythme 2 fois de suite, puis Arrêter. Micro proche de la bouche, pièce calme.
- **Importer un audio** : un mémo vocal du téléphone (.m4a, .wav, .mp3) marche direct.
- **Essayer avec un exemple** : rejoue « boum tchac tchac boum tchac boum tchac tchac » à 90 BPM, sans micro.
- La grille se corrige au clic. Si le tempo est au double ou à la moitié, bouton ÷2 / ×2.
- **Sensibilité** : à monter si des coups faibles sont ratés, à baisser si le bruit fait des faux coups.
- Barre d'espace = lecture / stop. « Superposer ma voix » rejoue ton enregistrement calé sur la boucle.
- **Exporter MIDI** : notes de batterie standard (36 kick, 38 caisse claire, 42 charley), à glisser dans FL Studio, Ableton, Logic.
- **Tes propres sons** : dépose `kick.wav`, `snare.wav`, `hihat.wav` dans `public/samples/`, ils remplacent les sons synthétisés.

## Ce qui est vérifié

`npm test` lance 23 tests sur de faux beatbox générés (bruit de fond, timing humain ±15 ms) : détection des coups, classification, tempo de 80 à 140 BPM, grille exacte, export MIDI. Crash-test : grilles parfaites à 100 % jusqu'à un timing décalé de ±20 ms, 99,9 % des cases justes à ±25 ms ; ça décroche seulement sur un enregistrement très bruité.

Limite connue : les règles kick / caisse claire / charley sont réglées sur des sons « types ». Sur ta vraie voix, il faudra peut-être ajuster les seuils (`DEFAULT_CLASSIFIER` dans `src/analysis.ts`) : c'est le premier boulot de la prochaine session.

## Structure

- `src/analysis.ts` : le moteur (détection, classification, tempo, grille). Sans dépendance navigateur.
- `src/drums.ts` : kit de batterie (synthé ou tes samples).
- `src/midi.ts` : export MIDI.
- `src/synth.ts` : générateur de faux beatbox (tests + bouton exemple).
- `src/main.ts`, `index.html`, `src/style.css` : l'interface.
- `tests/` : les tests automatiques.
- `CLAUDE.md` : le briefing pour Claude Code.
