#!/bin/zsh
cd "${0:A:h}"
if curl --silent --fail http://localhost:5188/ | /usr/bin/grep -q '<title>LiraSnap'; then
  open http://localhost:5188
  exit 0
fi
lirasnap_node="$(command -v node)"
if [[ -z "$lirasnap_node" ]]; then
  lirasnap_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$lirasnap_node" ]]; then
  print 'Node.js saknas. Installera Node.js och öppna den här filen igen.'
  read '?Tryck Enter för att stänga.'
  exit 1
fi
print 'LiraSnap: http://localhost:5188'
print 'Behåll det här fönstret öppet medan du använder LiraSnap.'
"$lirasnap_node" scripts/pwa-worker.mjs
"$lirasnap_node" server.mjs --open
