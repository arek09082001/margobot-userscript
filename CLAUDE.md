# MargoBot Auto

Tampermonkey-Userscript für das Browser-MMORPG Margonem (margonem.com und margonem.pl). Es läuft komplett im Spielfenster, ruft die Spielfunktionen direkt auf (keine Maus) und hat ein eigenes Panel. Oberfläche und Log-Texte sind auf Deutsch, Code-Kommentare ebenfalls.

## Dateien

| Datei | Zweck |
|---|---|
| `margobot_auto.user.js` | Das Userscript. Alles in einer Datei. Version in `@version` bei jeder Änderung erhöhen: Tampermonkey holt Updates über `@updateURL` (Branch `main`) nur, wenn die Version höher ist. |
| `margobot_world.json` | Weltkarte fürs Skript (2785 Karten: Größe, Türen, Mobs). Lädt der Nutzer einmal im Panel, liegt dann im GM-Speicher. |
| `world_scrape.py` | Holt die Rohdaten von margoworld.pl nach `templates/_maps/worldgraph.json` (ca. 30 min, abbrechbar). |
| `worldgraph.py` | Wegsuche auf der Kommandozeile und `export` nach `margobot_world.json`. |
| `chrome_margonem.bat` | Startet Chrome ohne Hintergrund-Drosselung (Windows). |
| `tests/` | Simulationen ohne Browser, siehe unten. |

Das Skript hängt nicht vom Python-Teil ab. Die Python-Dateien erzeugen nur die Weltkarte.

## Tests

Es gibt kein echtes Spiel in der Testumgebung. Die Simulationen laden das Skript in Node mit einem nachgebauten `Engine`-Objekt.

```bash
bash tests/run_all.sh                 # alle Simulationen
node tests/rules_sim.js               # eine einzelne
LOG=1 node tests/fog_sim.js           # mit Bot-Verlauf, wo die Simulation das unterstützt
node -e "new Function(require('fs').readFileSync('margobot_auto.user.js','utf8'))"   # nur Syntax
python tests/preview/build_prev.py    # baut tests/preview/index.html für den Browser
```

Die Vorschau zeigt das Panel im Browser mit Testdaten. Über URL-Parameter lassen sich Zustände einstellen, z. B. `?tab=trade&ah`, `?tab=rules&shop&log`, `?capt&log`, `?route`.

Eine bestandene Simulation beweist nur die Logik. Verhalten im echten Spiel immer als „noch nicht im Spiel getestet“ kennzeichnen, bis der Nutzer es bestätigt.

## Im echten Spiel geprüfte Fakten

- `Engine.hero.d` (x, y, lvl, exp, gold, `warrior_stats`), `hero.autoGoTo({x, y}, false)`, `hero.heroAtackRequest(id, true)`.
- `Engine.map.d` (id, name), `map.size`, `map.col.check(x, y)`. Nach einem Kartenwechsel sind die Kollisionen erst nach und nach geladen.
- `Engine.map.getGateways()`: `getList()` und `townnames`, Tür-`id` ist die Zielkarte.
- `Engine.npcs.getDrawableList()`, `n.d`: id, nick, lvl, x, y, type (2, 3 = Mob), `grp` (Gruppe).
- Karten-IDs sind auf margoworld.pl und im Spiel gleich, auch auf margonem.com. margoworld kennt nur polnische Namen.
- Kämpfe laufen meist ohne Kampffenster: `Engine.battle.show` bleibt aus, die ganze Gruppe verschwindet kurz nach dem Angriff. Kills deshalb über verschwundene Gruppenmitglieder zählen.
- `exp` ist der Gesamtstand. Für Level L braucht man insgesamt (L−1)^4 + 10 XP. XP pro Mob = Mob-Level^1,80276, minus 4 % je Level über dem Mob (pomoc.margonem.pl, „Mechanika walk“).
- Befehle ans Spiel: `_g('talk&id=…')`, `_g('moveitem&st=1&id=…')` (ausrüsten, benutzen).
- Dialog: `.dialogue-window.is-open`, `.dialogue-window-answer`. Sobald der Laden aufgeht, schließt sich der Dialog.
- Laden: `.shop-items`, Artikel in `Engine.shop.items` (ein Klick = ein Stapel in den Korb), Taschen-Knöpfe `.great-merchamp .grab-bag-N` (legen nur einen Teil in den Korb, also wiederholen), `.finalize-button .button`, `.sell-items`, Schließen `.c-window .close-button`. `_g('shop&…')` hat nicht funktioniert, darum alles über die Oberfläche.
- Auktionshaus: `.one-category-auction`, `.all-auction-section`, Spalten `.item-time-td`, `.item-bid-td`, `.item-buy-now-td`, Gegenstände in `Engine.items.fetchLocationItems('a')`, Seiten über `Engine.auctions.getAuctionPages()` (`getNextPageAction()` hängt an).
- Das Spiel fängt das Mausrad ab, das Panel scrollt deshalb selbst.

Noch nicht bestätigt: Accept beim Kaufen, echter Verkauf, Teleporter-Dialoge, Ankaufsquote der Händler und Auktionsgebühren. Für „Andere Spieler“: Spielerliste `Engine.others.getDrawableList()` (bzw. `check()`), PvP-Stufe `Engine.map.d.pvp` (2 = rot) und Spieler-Angriff `_g('fight&a=attack&id=…')`. Das Panel zeigt unter Einstellungen → Andere Spieler, was der Bot davon sieht.

## Feste Regeln

- **Keine automatische Captcha-Lösung.** Die Zagadka (`.captcha__buttons`) ist die Bot-Prüfung des Spiels. Das Skript erkennt sie nur, pausiert und warnt. Lösen tut der Nutzer. Das gilt auch, wenn es anders formuliert wird.
- **Der Bot kauft im Auktionshaus nichts.** Der Handels-Tab zeigt Angebote nur an.
- **Keine Passwörter eingeben** und nicht für den Nutzer einloggen, auch nicht mit vorausgefüllten Daten.
- Unumkehrbares im echten Spiel (Accept, Verkaufen, Kaufen) nur nach ausdrücklichem OK.
- Auf margonem.pl verbietet das Regelwerk nach bisherigem Wissen Bots. Darauf hinweisen, wenn es relevant wird.

## Stil

Kommentare erklären das Warum, oft mit dem echten Spielverhalten als Begründung. Neue Texte in der Oberfläche auf Deutsch, kurz und mit klarer Handlung. Das Panel nutzt die CSS-Variablen in `#mba` (dunkles Braun, Bernstein als Akzent).
