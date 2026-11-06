# MargoBot Auto

Tampermonkey-Userscript für das Browser-MMORPG Margonem (margonem.com und margonem.pl). Es läuft komplett im Spielfenster, ruft die Spielfunktionen direkt auf (keine Maus) und hat ein eigenes Panel. Oberfläche und Log-Texte sind auf Deutsch, Code-Kommentare ebenfalls.

## Dateien

| Datei | Zweck |
|---|---|
| `margobot_auto.user.js` | Das Userscript. Alles in einer Datei. Version in `@version` bei jeder Änderung erhöhen: Tampermonkey holt Updates über `@updateURL` (Branch `main`) nur, wenn die Version höher ist. |
| `margobot_world.json` | Weltkarte fürs Skript (2785 Karten: Größe, Türen, Mobs). Lädt der Nutzer einmal im Panel, liegt dann im GM-Speicher. |
| `world_scrape.py` | Holt die Rohdaten von margoworld.pl nach `templates/_maps/worldgraph.json` (ca. 30 min, abbrechbar). |
| `worldgraph.py` | Wegsuche auf der Kommandozeile und `export` nach `margobot_world.json`. |
| `margobot_expowiska.json` | Generierter Forum-Katalog: 119 Gebiete und 131 Teilrouten; im Userscript eingebettet. |
| `expowiska.py` | Baut den Katalog offline aus `docs/expowiska-source.json` und der Weltkarte; `--embed` aktualisiert das Userscript. |
| `chrome_margonem.bat` | Startet Chrome ohne Hintergrund-Drosselung (Windows). |
| `tests/` | Simulationen ohne Browser, siehe unten. |

Das Skript hängt nicht vom Python-Teil ab. Die Python-Dateien erzeugen nur die Weltkarte.

Einstellungen im GM-Speicher: `mbauto` enthält alles (Stand des zuletzt aktiven Helden, Vorlage für neue Helden), `mbhero:<Welt-Host>#<Held-ID>` den Teil pro Held, `mbauto_last` den zuletzt aktiven Helden (gilt auf Seiten ohne Spiel, z. B. E2 offline). Was für alle Helden gilt (Kartenwissen, Panel-Lage, Handel), steht in `GLOBAL` im Skript. Änderungen immer über `save()`.

## Tests

Es gibt kein echtes Spiel in der Testumgebung. Die Simulationen laden das Skript in Node mit einem nachgebauten `Engine`-Objekt.

```bash
bash tests/run_all.sh                 # alle Simulationen
node tests/rules_sim.js               # eine einzelne
LOG=1 node tests/fog_sim.js           # mit Bot-Verlauf, wo die Simulation das unterstützt
node -e "new Function(require('fs').readFileSync('margobot_auto.user.js','utf8'))"   # nur Syntax
python tests/preview/build_prev.py    # baut tests/preview/index.html für den Browser
```

XP-Rundgänge (ab 7.10): Der normalisierte Forenauszug (`docs/expowiska-source.json`, Stand 23.06.2026) enthält 119 Gebiete, davon 45 empfohlen. `expowiska.py` erzeugt `margobot_expowiska.json`; `python3 expowiska.py --embed` aktualisiert zusätzlich den eingebetteten Katalog im Userscript, ohne weitere Laufzeit-Downloads. Nicht die Quelldaten aus den generierten Dateien zurückschreiben. Der Import bewahrt Durchschnittslevel und Empfehlungen; Kartennamen/Etagen, dokumentierte Schreibvarianten und Mob-Grafiken werden gegen die Weltkarte abgeglichen. Unaufgelöste Ortsnamen stehen im Katalog.

Vorschläge stehen in beiden XP-Modi. `suggestAuto` folgt dem Heldenlevel (−5 bis +3), ausgeschaltet gilt der eingestellte Bereich. `expoAll` zeigt alle Forumgebiete inklusive getrennter Teilrouten, unbekannter Anreise und fehlender Mob-Daten. `forumRoutes` nutzt den gemeinsamen Rundgang-Algorithmus `suggestRoutes(..., area)`, mit allen Gebietskarten einschließlich Durchgangskarten. Ohne Forumtreffer bleiben die automatisch berechneten Weltkarten-Vorschläge. Kreuzungen können mehrfach in `maps` vorkommen; `cards` zählt eindeutige Karten, `mode` ist `loop`. Einzelkarten bleiben Jagdorte ohne Kartenwechsel. Mob-Zahlen und XP werden pro Karte nur einmal geschätzt. Übernahme startet den Bot nicht und ist während laufender Aktionen oder ohne Anreise/Mob-Daten gesperrt. Tests: `node tests/xproutes_sim.js` und `python3 tests/expowiska_test.py` (beide in `tests/run_all.sh`). Details: `docs/xp-routen.md`.

Die Vorschau zeigt das Panel im Browser mit Testdaten. Über URL-Parameter lassen sich Zustände einstellen, z. B. `?tab=trade&ah`, `?tab=rules&shop&log`, `?capt&log`, `?route`.

Eine bestandene Simulation beweist nur die Logik. Verhalten im echten Spiel immer als „noch nicht im Spiel getestet“ kennzeichnen, bis der Nutzer es bestätigt.

Unerreichbare Mobs (ab 7.11): Keine erreichbaren Ziele nach erneuter Kollisionsprüfung → 30 s überspringen und wie bei leerer Karte weiterarbeiten. Ein Laufauftrag ohne Heldbewegung wird nach 6 s übersprungen; die Frist beginnt beim Zielwechsel und berücksichtigt nachfolgende Schritte. Nebel-Erkundung darf übersprungene Geisterziele nicht erneut festhalten. Bei blockierter Mob-Kachel wird ein erreichbares Angriffs-Nachbarfeld angelaufen. Überspringen/Angriffsversuche sind pro Kartenbesuch und werden beim Kartenwechsel zurückgesetzt. Regression: `node tests/unreachable_mobs_sim.js` (in der Gesamtsuite).

Gelbe Karten (ab 7.12): Bei `pk.mode=follow`, erkanntem Verfolger innerhalb `heroLvl + pk.maxUp` und aktiver Route mit nächster Karte wird die aktuelle Karte ohne weitere Jagd verlassen. `pkRouteSkip` hält diesen Auftrag bis zum Kartenwechsel fest; danach normal weiterjagen. Keine zufällige Höhlenflucht und kein automatischer Rückweg. Fehlende Routentür melden und warten. Andere PvP-Fälle behalten ihre bisherige Reaktion. Tests: `tests/pvp_sim.js`.

E2-Logout (ab 7.13): Leitet die Startseite sofort zurück ins Spiel, wird `noLeaveUntil` auf jetzt + 2 min gesetzt; ältere längere Sperren werden beim Laden auf maximal 2 min Restzeit gekürzt. Danach ohne neuen Kill erneut verlassen, sofern bis zur Rückkehr noch genügend Zeit gemäß `leaveMin` bleibt. Die kurze Pause verhindert Neulade-Schleifen. Regressionen stehen in `tests/e2_sim.js`.

Heros (ab 7.14): Neuer Tab mit validiertem JSON-Spawnlistenimport (`mbheros`, global) und pro-Held-Zustand `cfg.heros`. Einmalige oder wiederholte Suchrunden, Kartenweg-Heuristik, Fund per normalisiertem exakten NPC-Namen, Ton und Benachrichtigung; keine Angriffe. Fehlende Wege bleiben ungeprüft. Seit 7.15 sind die vom Nutzer vorgegebenen Spawnlisten für Złodziej (32 Punkte) und Karmazyn (39 Punkte) eingebettet; dokumentierte Daten: `docs/heros-spawns.json`. Eigene `mbheros`-Einträge ergänzen die eingebauten Heros und haben bei gleichem Namen Vorrang. Die vollständigen Punktlisten und Kartenwege werden gegen die Weltkarte getestet. Keine Spawnpunkte aus normalen Mob-Daten ableiten. Dokumentation: `docs/heros.md`; synthetische Regressionstests: `tests/heros_sim.js`.

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
- Fähigkeiten (Paladin, classic.margonem.pl; Details in `docs/skills_api.md`): `Engine.skills.getSkills()` mit `skill_<id>` (`cLvl`, `mLvl`, `grp`, `allStats`, `regs`), `getGroupedSkills()` mit den Reihen. Punkte stehen nur im Fenster (`.skills_learnt`, `.skills_total`). Öffnen sendet `_g('skillshop')`, Punkt setzen `_g('skills&learn=<id>&lvl=<neue Stufe>')` ohne Rückfrage, Kosten `floor(Level^1,9)` Gold (bei Level 232 am echten Punkt bestätigt). Mistrzostwo walk: `_g('skills&battleaction=set&battleskills=<ids>&rpt=1')`. Ist „Edytuj“ offen, sendet jeder Klick auf eine Fähigkeit sofort eine geänderte Kette. margolab-`game_id` = Spiel-ID (42 von 42 beim Paladin). Waffe: angelegt mit `st = 5`.

Noch nicht bestätigt: Zagadka automatisch lösen (Antworten mit `*…*` anklicken; `.captcha__confirm .button` nur mit eigener Option; beides standardmäßig aus), Accept beim Kaufen, echter Verkauf, Teleporter-Dialoge, Ankaufsquote der Händler und Auktionsgebühren. Für „Andere Spieler“: Spielerliste `Engine.others.getDrawableList()` (bzw. `check()`), PvP-Stufe `Engine.map.d.pvp` (2 = rot) und Spieler-Angriff `_g('fight&a=attack&id=…')`. Das Panel zeigt unter Einstellungen → Andere Spieler, was der Bot davon sieht. E2-Jagd (Tab „E2“): E2-Liste aus der Weltkarte (Mob-Icon im Ordner `e2/`), Erkennung der E2 im Spiel über den Namen, „Spiel verlassen“ = von [server].margonem.pl/.com auf www.margonem.pl/.com, zur Rückkehrzeit öffnet der Bot wieder die gemerkte Spielseite (bestehende Sitzung, kein Login). Login-Formulare fasst er nie an: Erscheint statt des Spiels eine Anmeldung, erinnert er nur. Respawn-Richtwert: t = 0,7 + 0,18·lvl − 0,00045·lvl² Minuten, ab Lvl 200 konstant ~18,7 (Spieler-Wiki, passt zu den Messungen auf margoatlas.pl/potwory/elity-ii), geteilt durch das Respawn-Tempo der Welt; pro E2 überschreibbar, nicht aus dem Spiel gelesen.

## Feste Regeln

- **Der Bot kauft im Auktionshaus nichts.** Der Handels-Tab zeigt Angebote nur an.
- **Keine Passwörter eingeben** und nicht für den Nutzer einloggen, auch nicht mit vorausgefüllten Daten.
- Unumkehrbares im echten Spiel (Accept, Verkaufen, Kaufen) nur nach ausdrücklichem OK.
- Auf margonem.pl verbietet das Regelwerk nach bisherigem Wissen Bots. Darauf hinweisen, wenn es relevant wird.

## Stil

Kommentare erklären das Warum, oft mit dem echten Spielverhalten als Begründung. Neue Texte in der Oberfläche auf Deutsch, kurz und mit klarer Handlung. Das Panel nutzt die CSS-Variablen in `#mba` (dunkles Braun, Bernstein als Akzent).
