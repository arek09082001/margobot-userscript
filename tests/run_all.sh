#!/usr/bin/env bash
# Alle Simulationen nacheinander. Gibt pro Datei die Ergebniszeilen aus und meldet Abstürze.
cd "$(dirname "$0")" || exit 1
fail=0
for f in *_sim.js bench2.js sug_test.js; do
  echo "== $f"
  if ! node "$f"; then echo "FEHLER in $f"; fail=1; fi
done
exit $fail
