# Heros-Suche – Suchablauf und Datenstand

Der Tab „Heros“ unterstützt die Auswahl eines Heros aus einer geladenen Spawnliste,
einmalige Suchrunden und automatische Wiederholung. Die Reihenfolge bevorzugt
jeweils den nächsten über die Weltkarte erreichbaren Spawnpunkt. Es ist eine
Heuristik, keine Garantie für die global kürzeste Route. Auf den Karten läuft der
Bot jeden Punkt bis auf Angriffs-/Sichtnähe an und wartet kurz auf die NPC-Liste.

Sobald ein NPC mit dem gewählten Namen sichtbar ist (auch unterwegs auf einer
Durchgangskarte), endet die Suche. Ein dreifacher Ton und eine Benachrichtigung
melden Karte und Koordinaten. Der Bot greift den Hero nicht an. Bei einmaligem
Absuchen ohne Fund endet die Runde ohne Fundton. Wiederholung beginnt eine neue
Runde. Nicht erreichbare Karten/Punkte werden als ungeprüft gezählt. Sind gar
keine Punkte prüfbar, läuft keine Endlosschleife. Die Standardeinstellung stoppt
bei Tod; „zurücklaufen“ setzt die Suche nach Wiederbelebung fort.

Der Ton wird beim Start-Klick im Browser vorbereitet. „Ton testen“ prüft die
Browser-Freigabe. Stummgeschaltete Tabs, blockierte Audiowiedergabe und
Systemlautstärke können die Ausgabe verhindern. Noch nicht im echten Spiel geprüft.

## Noch fehlend: recherchierter Spawnkatalog

Die vorhandene `margobot_world.json` enthält keine belastbare Hero-Spawnliste,
auch nicht für Złodziej. Eine solche Liste ist ausdrücklich **nicht vorinstalliert**.
Die früheren Kartenquellen Margoworld (`https://margoworld.pl`) und Margoatlas
(`https://margoatlas.pl`) wurden geprüft, sind in der aktuellen Laufzeit jedoch
vom Netzwerkproxy mit HTTP 403 gesperrt. Die erforderlichen Domainfreigaben sind
im Umgebungsentwurf vorgemerkt. Die Recherche und der Einbau des vollständigen
Katalogs bleiben offen, bis die Quellen zugänglich sind oder ein Quellenauszug
vorliegt. Aus normalen Mob-Positionen werden keine Hero-Spawnpunkte erfunden.

## Importformat

„Spawnliste importieren“ liest eine JSON-Datei mit einer Liste von Objekten:

- `name`: Name des Heros wie im Spiel, zum Beispiel `Złodziej`.
- `source`: Quellen-URL oder Beschreibung des Herkunftsnachweises.
- `points`: Liste mit `map` (numerische Karten-ID), `x` und `y` (ganzzahlige Kachelkoordinaten).

Alle Karten und Koordinaten müssen zur geladenen Weltkarte passen. Leere,
doppelte oder ungültige Einträge werden abgewiesen, ohne den bisherigen Katalog
zu überschreiben. Der Katalog liegt global im GM-Speicher `mbheros`; Auswahl,
Suchzustand und Wiederholung gelten pro Held unter `cfg.heros`.

`tests/heros_sim.js` verwendet ausschließlich künstliche Testkarten und
Testnamen. Die Tests prüfen Navigation, einmaliges Suchen, Wiederholung,
Fundmeldung ohne Angriff, Stoppen, Tod, validierten Import und unerreichbare
Punkte. Sie belegen keine echten Spawnkoordinaten.
