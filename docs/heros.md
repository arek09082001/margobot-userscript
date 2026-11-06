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

## Vorinstallierte Spawnpunkte (ab 7.15)

Die vom Nutzer bereitgestellten Margoworld-Listen vom 06.11.2026 sind direkt im
Userscript eingebaut und unter `docs/heros-spawns.json` nachvollziehbar gespeichert:

| Hero | Spawnpunkte | Karten |
|---|---:|---:|
| Złodziej | 32 | 23 |
| Karmazyn | 39 | 14 |

Die erste Liste wurde im Gespräch Złodziej, die zweite Karmazyn zugeordnet.
Nur Karten mit ausdrücklich angegebenen Koordinaten sind Spawnpunkte. Eder
(Karte 33) ist lediglich eine Überschrift; Fort Eder (244) ist nur in der
Złodziej-Liste selbst ein Spawnpunkt. Mehrere Koordinaten derselben Karte bleiben
separate Besuchsziele. Alle Koordinaten passen zur vorhandenen Weltkarte; alle
71 Punkte sind über deren Kartentüren von Eder aus erreichbar. Das belegt die
hinterlegten Kartenwege, nicht freigeschaltete Questtüren oder die tatsächliche
Begehbarkeit im Spiel.

Beide Heros sind ohne zusätzlichen Import auswählbar. Der Fundalarm vergleicht
den NPC-Namen mit dem ausgewählten Namen und ausdrücklich hinterlegten Alternativnamen, unabhängig von der NPC-Typnummer. Bei „Karmazyn“ wird auch der vollständige Name „Karmazynowy Mściciel“ erkannt.
Die Punkte sind vom Nutzer vorgegeben und wurden nicht extern neu recherchiert;
weitere Heros sind noch nicht vorinstalliert. Die bisherigen Quellen Margoworld
und Margoatlas waren beim vorherigen Rechercheversuch vom Proxy gesperrt.

## Importformat

„Spawnliste importieren“ liest eine JSON-Datei mit einer Liste von Objekten:

- `name`: Name des Heros wie im Spiel, zum Beispiel `Złodziej`.
- `aliases`: optionale Liste alternativer exakter NPC-Namen.
- `source`: Quellen-URL oder Beschreibung des Herkunftsnachweises.
- `points`: Liste mit `map` (numerische Karten-ID), `x` und `y` (ganzzahlige Kachelkoordinaten).

Alle Karten und Koordinaten müssen zur geladenen Weltkarte passen. Leere,
doppelte oder ungültige Einträge werden abgewiesen, ohne den bisherigen Katalog
zu überschreiben. Importierte Einträge ergänzen die vorinstallierten Heros; bei gleichem Namen hat die eigene importierte Liste Vorrang. Der eigene Katalog liegt global im GM-Speicher `mbheros`; Auswahl,
Suchzustand und Wiederholung gelten pro Held unter `cfg.heros`.

`tests/heros_sim.js` verwendet für Ablaufprüfungen künstliche Testkarten und
Testnamen. Zusätzlich prüft der Test die beiden echten Listen gegen die
Weltkarte auf Koordinaten, vollständige Besuchsreihenfolge und Erreichbarkeit. Die Tests prüfen Navigation, einmaliges Suchen, Wiederholung,
Fundmeldung ohne Angriff, Stoppen, Tod, validierten Import und unerreichbare
Punkte. Die tatsächlichen Spawnorte und das Verhalten im echten Spiel sind damit nicht bestätigt.
