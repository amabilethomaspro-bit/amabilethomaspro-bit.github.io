# Briefing Claude Code — Beatbox Studio (app beatmaking IA)

Lis ce fichier en entier avant toute action. Il résume tout ce qui a été fait dans la conversation Claude du 3 au 4 novembre 2026, où se trouve chaque chose, et ce qu'il reste à faire.

## Le projet en une phrase
Un mentor beatmaker IA dans une appli : l'utilisateur beatboxe, fredonne, parle et pointe du doigt ; l'IA transforme ses idées en vraies pistes et le conseille comme un beatmaker expérimenté conseillerait un jeune. L'humain reste le créateur, l'IA exécute et fait progresser (positionnement opposé à Suno/Udio qui génèrent le morceau à sa place). Modèle visé : abonnement 10-15 €/mois.

## L'utilisateur
Thomas, francophone, tutoiement, ton direct et familier accepté. Pas développeur de métier : explique en une phrase ce que tu fais, donne du code qui tourne tel quel, teste avant de dire que c'est fini. Sessions courtes (quelques heures par semaine) : une étape à la fois, il valide en testant. Matériel : Mac Mini M4 (dev), iPhone (tests au quotidien), iPad Pro.

## Où se trouve tout
- **Ce dossier** (`beatbox-proto/`) : le code complet. Livré à Thomas en zip, à poser sur son bureau ; c'est le dossier parent du projet.
- **Page en ligne actuelle** (prototype jouable sur iPhone, publiée dans Claude, privée) : https://claude.ai/artifact/UqXenXEpaDvjM5zxCje5q7 — c'est le build `npm run build:artifact` (fichier unique `dist-artifact/beatbox-boucle.html`).
- **Dossier de conception** (vision, déroulé d'une session, faisabilité, tâches) : https://claude.ai/artifact/8sHoZzkppg3YSAV6aWVKEy
- **Rappels iPhone** (liste « Chose à faire ») : enregistrer des beatbox de test, dézipper le projet, ouvrir Claude Code.
- **Comptes** : compte Vercel créé (équipe « sama », plan gratuit), GitHub pas encore relié à Vercel. Clé API Google Gemini créée sur AI Studio mais exposée dans une conversation : elle doit être supprimée et recréée, ne jamais la réutiliser. Clé Anthropic : Thomas pense en avoir une ancienne, crédits inconnus (aucun reçu trouvé dans son Gmail ; les crédits Anthropic expirent au bout d'un an).
- **Clés API** : jamais dans le code, jamais dans le dépôt, jamais côté navigateur. Uniquement en variables d'environnement Vercel (ou `.env.local` ignoré par git en local).

## Ce qui est construit et testé
- **Moteur** (`src/analysis.ts`, sans API navigateur) : détection des coups par flux spectral par bande (grave/médium/aigu normalisées séparément) + porte de bruit à ~15 dB et contrôle de montée d'énergie ; classification par règles (`DEFAULT_CLASSIFIER` : énergie < 250 Hz ≥ 0,35 → kick ; énergie > 5 kHz ≥ 0,65 ou centroïde ≥ 9 kHz → charley ; sinon caisse claire) ; tempo par ajustement d'une grille de doubles-croches entre 70 et 160 BPM (le plus lent parmi les quasi-ex-aequo, affinage au 1/20e, arrondi à l'entier si proche) ; quantification 16 pas par mesure, 1 à 4 mesures.
- **Fiabilité mesurée sur faux beatbox** (`src/synth.ts`) : grilles parfaites 20/20 jusqu'à ±20 ms de décalage, 19/20 à ±25 ms, 6/20 à ±30 ms avec bruit fort. **Jamais testé sur une vraie voix** : c'est la grosse inconnue.
- **Interface** (`index.html`, `src/main.ts`, `src/style.css`) : façon conversation avec un assistant IA. Boucle épinglée en haut (lecture/stop, BPM, grille cliquable, forme d'onde avec coups colorés, menu Plus : superposer la voix, mesures, sensibilité, export MIDI/JSON), fil de discussion au centre (le « Mentor »), barre de saisie en bas (trombone pour importer un audio, micro en version locale, texte, suggestions rapides). Clair/sombre, format téléphone.
- **Mentor** : actions sur la boucle centralisées dans `src/edit.ts` (régler le tempo, écrire une piste avec un motif `x...`, ajouter/retirer des pas, lecture). Dans la page en ligne, le mentor passe par la capacité `sample` de Claude avec ces actions comme outils (modèle rapide). Sans IA, `localCommand` comprend quelques commandes en français (« joue », « tempo 95 », « ajoute des charleys », « enlève le kick », « explique »).
- **Sons** : kit synthétisé Tone.js (`src/drums.ts`) ; samples perso possibles dans `public/samples/` (kick.wav, snare.wav, hihat.wav) en version locale.
- **Exports** : MIDI standard (`src/midi.ts`, notes GM 36/38/42) ; dans la page en ligne, emballé en zip (`src/zip.ts`) car le .mid seul n'y est pas accepté.
- **Deux builds** : `npm run dev` / `npm run build` (local, micro actif) et `npm run build:artifact` (page en ligne : pas de micro, import d'un mémo du Dictaphone ; `scripts/inline.mjs` assemble un seul fichier HTML).
- **Tests** : `npm test` = 23 tests verts (détection, classification, tempo, grille, MIDI, zip, actions du mentor, commandes simples). `npm run build` passe.

## Décisions prises
- Prototype dans le navigateur d'abord, pas d'appli native. Peaufiner avant de sortir.
- L'IA est louée, pas créée : la valeur propre du produit = le moteur d'analyse du beatbox, l'interface, la personnalité du mentor.
- **Appel IA derrière un seul fichier interchangeable** (ex. `src/ai.ts` côté client + une fonction serveur) pour passer de Gemini à Claude ou autre en changeant une ligne. Prototype sur le quota gratuit de l'API Gemini, passage payant quand il y aura des utilisateurs.
- Le mode vocal impose de quitter la page publiée dans Claude (pas d'accès micro là-bas) : hébergement sur Vercel en HTTPS, installable sur l'écran d'accueil de l'iPhone.

## Règles de travail
- Le moteur reste sans API navigateur pour rester testable dans Node. Toute nouvelle logique = un test dans `tests/`.
- Lancer `npm test` et `npm run build` avant de rendre la main.
- Pas de nouvelle dépendance sans raison claire. Commits petits et clairs.

## Prochaines étapes, dans l'ordre
1. **Mise en place** : vérifier Node.js, `npm install`, `npm test`, `npm run dev`, faire tester l'interface à Thomas sur le Mac. Initialiser git, créer le dépôt GitHub, le relier à Vercel (compte « sama ») pour un déploiement automatique.
2. **Brancher l'IA hors de Claude** : créer `src/ai.ts` (interface unique) + une fonction serveur Vercel (`api/mentor`) qui appelle Gemini avec la clé en variable d'environnement et gère les outils de `src/edit.ts`. Thomas crée une nouvelle clé Gemini et la colle lui-même dans Vercel. Garder le chemin `sample` pour la page publiée dans Claude.
3. **Calibrage sur la vraie voix de Thomas** : ses enregistrements vont dans `samples-test/` (10 s, nommés avec l'intention, ex. `boum-tchac-90.m4a`). Analyser chacun, montrer ce qui est détecté, ajuster `DEFAULT_CLASSIFIER`. Si les règles ne suffisent pas : mode « apprentissage » (5 kicks, 5 caisses claires, 5 charleys, puis plus proche voisin).
4. **Mode vocal** (priorité de Thomas) : un seul bouton micro qui sert à la fois à parler au mentor et de dictaphone. Démarrer avec un mode explicite (appui long = beatbox, appui court = parole), puis tri automatique parole/beatbox. Reconnaissance et synthèse vocale via Web Speech API (Safari iOS et Chrome) pour aller vite ; le mentor répond à voix haute ; « attends » coupe la lecture.
5. **Mélodie fredonnée** : `@spotify/basic-pitch` dans le navigateur, recalage tempo et gamme, synthé Tone.js, piano roll éditable, export MIDI.
6. **Correction en direct** : pendant la lecture, « attends », sélection d'une note ou d'un passage à l'écran, on refredonne ce passage et il remplace l'ancien. L'appli envoie à l'IA l'état structuré (pistes, sélection, position de lecture), jamais une capture d'écran.

## Premier message conseillé
« Lis CLAUDE.md. On commence par l'étape 1 : mise en place, git, GitHub et Vercel. »
