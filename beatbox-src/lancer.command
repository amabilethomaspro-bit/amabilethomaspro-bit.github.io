#!/bin/bash
# Double-clic pour lancer le prototype (Mac)
cd "$(dirname "$0")"
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Télécharge la version LTS sur https://nodejs.org puis relance."
  open "https://nodejs.org"
  read -p "Appuie sur Entrée pour fermer."
  exit 1
fi
[ -d node_modules ] || npm install
(sleep 3 && open "http://localhost:5173") &
npm run dev
