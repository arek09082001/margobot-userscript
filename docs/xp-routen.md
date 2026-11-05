# XP-Routen aus dem Forum

Im XP-Tab stehen Vorschläge aus dem vom Nutzer bereitgestellten Forenauszug:
<https://forum.margonem.pl/?task=forum&show=posts&id=514156>, Stand 23.06.2026.
Der Katalog enthält **119 Gebiete**, davon **45 im Forum empfohlen**, und
**131 getrennte Teilrouten**. Die Daten sind im Userscript 7.10 eingebettet;
ein zusätzlicher Download ist nicht erforderlich. Die Weltkarte muss im Bot
weiterhin geladen sein.

„Automatisch passend zu meinem Level“ folgt dem Heldenlevel mit einem
Mob-Bereich von −5 bis +3. Ausgeschaltet gilt der eingestellte Bereich.
Passende, erreichbare Forumgebiete werden zuerst vorgeschlagen, empfohlene
Gebiete bevorzugt. Entfernung und geschätzte XP bestimmen die weitere
Reihenfolge. „Alle 119 Forum-Gebiete anzeigen“ öffnet den vollständigen Katalog.
Gibt es für den gewählten Bereich keinen erreichbaren Forumtreffer, werden
weiterhin Routen direkt aus der Weltkarte berechnet und entsprechend bezeichnet.

Die Forenangabe „~40“ ist der durchschnittliche **Mob-Level**, keine Empfehlung
für einen Helden auf Level 40. Der übernommene Angriffsbereich stammt aus den
zugeordneten Mob-Daten und enthält den im Forum angegebenen Durchschnitt.
Ein Klick übernimmt Route und Level-Bereich. Erst „Route … starten“ startet
den Bot. Eigene Routen gleichen Namens bleiben erhalten.

## Karten und Rundgänge

Der Import gleicht die genannten Karten einschließlich Etagen mit der Weltkarte
ab. Dokumentierte Schreibvarianten stehen in `ALIASES` in `expowiska.py`.
Die Mob-Bilder aus dem Forenauszug ermöglichen zusätzliche Zuordnungen von
Höhlen und unspezifisch beschriebenen Regionen. Diese Zuordnungen sind aus den
vorhandenen Daten abgeleitet und nicht im Spiel überprüft. Nicht gefundene
Ortsnamen bleiben unter `unresolved` im JSON erhalten; sie werden nicht durch
ungeprüfte Fuzzy-Treffer ersetzt. Im Forum und in der Weltkarte können Namen,
Grafiken und Gegner unterschiedlich aktuell sein.

Ein Rundgang besucht alle Karten eines verbundenen Teilgebiets und kehrt über
bekannte beidseitige Türen zum Anfang zurück. Verzweigungen erzeugen Rückwege
über bereits besuchte Karten. Getrennte Teile bleiben separate Vorschläge; ein
nicht belegter Teleport verbindet sie nicht. Bekannte gesperrte Türen werden
berücksichtigt. Eine einzelne Karte ist ein Jagdort ohne Kartenwechsel.
Unbekannte Anreisewege sind im vollständigen Katalog sichtbar und gesperrt;
auf der Zielinsel kann ein Gebiet durch den neuen Standort erreichbar werden.

Bei **Orły (~90), Złudny Trakt** fehlen passende Mob-Daten in der vorhandenen
Weltkarte. Der Eintrag bleibt sichtbar, ist aber gesperrt und wird nicht
automatisch empfohlen. Karten- und Questbedingungen, Kollisionen und tatsächliche
Erreichbarkeit müssen weiterhin im Spiel geprüft werden.

XP und Mob-Zahlen zählen jede Karte einmal; Rückwege bedeuten keinen sofortigen
Respawn. Laufzeiten, Boni und Respawnraten sind nicht berücksichtigt. Die
Schätzungen sind keine Messung von XP pro Minute. **Noch nicht im Spiel getestet.**
Premium-Instanzen aus dem Abschnitt „INNE EXPOWISKA“ werden nicht als
wiederholbare Routen übernommen: Ihre Gegner respawnen laut Forum nicht.

## Daten aktualisieren und prüfen

- Normalisierte Quelle: `docs/expowiska-source.json`.
- Kartenzuordnung und vorbereitete Rundgänge: `margobot_expowiska.json`.
- Neu aufbauen und im Userscript aktualisieren: `python3 expowiska.py --embed`.
- Neuen lokalen HTML-Auszug einlesen: `python3 expowiska.py --html /pfad/forum.html --embed`.
- Alle Prüfungen: `bash tests/run_all.sh`.

Der Import nutzt ausschließlich Python-Standardbibliotheken und führt keine
Netzwerkzugriffe aus. Die Tests prüfen Import, Empfehlungen, Levelbereiche,
Reproduzierbarkeit, die eingebettete Kopie, Kartenabdeckung, Türen und
Kreisschluss, getrennte Gebiete, automatische Vorschläge und die Übernahme.
