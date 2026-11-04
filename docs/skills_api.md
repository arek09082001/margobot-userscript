# Fähigkeiten (Umiejętności): technische Notizen

Untersucht am 04.11.2026 auf classic.margonem.pl, neues Interface (`Engine` vorhanden), Paladin, Level 232. Andere Professionen und Welten sind nicht geprüft.

## Geprüft (im Spiel gesehen)

### Daten lesen

Diese Funktionen geben laut Quelltext nur gespeicherte Daten zurück und ändern nichts:

| Aufruf | Inhalt |
|---|---|
| `Engine.skills.getSkills()` | Objekt mit den Schlüsseln `skill_<id>`, 42 Einträge |
| `Engine.skills.getGroupedSkills()` | Reihen `1`–`7`, je `{ skills, points, requiredLvl }` |
| `Engine.skills.getBasicSkills()` | `skill_-1` (Zwykły atak), `skill_-2` |
| `Engine.skills.getActiveSkills()` | aktive Fähigkeiten: `[-1, -2, 112, 38, 108, 197, 92, 202, 191, 249]` |

Felder einer Fähigkeit:

| Feld | Beispiel | Bedeutung |
|---|---|---|
| `id` | `201` | Spiel-ID |
| `name`, `desc` | `Niebiańska ochrona` | Texte in Spielsprache |
| `lvl` | `"4/10"` | Stufe als Text |
| `cLvl`, `mLvl` | `4`, `10` | aktuelle und höchste Stufe |
| `allStats` | Liste mit 10 Texten | Werte je Stufe, `key=wert;…` |
| `currentStatsIndex` | `3` | Index in `allStats` (hier `cLvl − 1`) |
| `type` | `active`, `passive` | Art |
| `grp` | `14` | Reihe, beim Paladin `9`–`15` |
| `xy` | `2` | Position in der Reihe |
| `attr` | `0`, `7`, `25` | Bedeutung unbekannt |
| `regs` | `reqp=p;reqw=sw;lvl=80` | Voraussetzungen: Profession, Waffe, Level |
| `kind` | `unav` oder Text mit `regs` und Werten | `unav` bei voller Stufe und bei gesperrter Reihe |

Beobachtete `reqw`-Werte: `fire`, `frost`, `light`, `sw`, `sh`, `1h`.

Beispiel für `allStats` (ID 108, Stufe 1 und 10): `sa_per` 2 → 20, `energy` 18 → 27, `combo_dmg_hpp-target` 1.6 → 3.0.

### Reihen

Laut Fenstertext. `requiredLvl` aus den Daten passt dazu.

| Reihe | Level | Punkte insgesamt |
|---|---|---|
| 1 | 25 | 1 |
| 2 | 35 | 10 |
| 3 | 50 | 25 |
| 4 | 80 | 55 |
| 5 | 120 | 95 |
| 6 | 170 | 145 |
| 7 | 230 | 205 |

`points` der Reihen ergeben in Summe die gesetzten Punkte: 40 + 33 + 30 + 28 + 47 + 14 = 192.

### Held und Ausrüstung

- `Engine.hero.d.prof`: Profession, Paladin = `p`. `lvl` und `oplvl` stehen daneben.
- `Engine.hero.d` hat **kein Feld für Fähigkeitspunkte**. Gesetzt und gesamt stehen im Fenster: `.skills_learnt`, `.skills_total`.
- `Engine.hero.d.warrior_stats`: u. a. `hp`, `maxhp`, `ac`, `sa`, `crit`, `critval`, `critmval`, `critmval_f`, `critmval_c`, `critmval_l`, `resfire`, `resfrost`, `reslight`, `mana`, `energy`, `attack`, `evade`.
- Angelegte Gegenstände: `Engine.items.fetchLocationItems('g')` mit `st > 0`.
  - Waffe: `st = 5`. Im Test `cl = 1` mit den Stats `dmg` und `light` (Blitzschaden).
  - Schildplatz: `st = 7`, im Test `cl = 14`.
  - Weitere gesehene Paare `st`/`cl`: Kopf 1/9, Ring 2/12, Hals 3/13, Hände 4/11, Rüstung 6/8, Schuhe 8/10, Talisman 9/22, Taschen 20–26/24.

### Fenster und Oberfläche

- Fenster: `.skills-window` in `.c-window`, links `.left-column`, rechts `.right-column`.
- Öffnen: `.widget-skills` in der Leiste. Das Öffnen schickt `_g('skillshop')`.
- Fähigkeit: `.skill` mit `id="skill_<id>"`, darin `.label-wrapper` mit `x/10`.
- Rechte Spalte nach Auswahl: `.skill-learn`, `.skill-learn-price`, `.skill-learn-btn`.
- Rücksetzen: Knopf `.reset`, Text „Reset punktów: 50“. Nicht benutzt.

### Punkt setzen

Vom Nutzer selbst ausgelöst und mitgeschrieben (Fähigkeit 201, von 3/10 auf 4/10):

```text
_g('skills&learn=201&lvl=4')
```

- `lvl` ist die **neue Stufe**, nicht die Anzahl der Punkte.
- Es gibt **keinen** Bestätigungsschritt.
- Danach: `.skills_learnt` 191 → 192, `cLvl` 3 → 4, Reihe 6 von 13 auf 14 Punkte.
- Das Lernen kostet Gold. Die nächste Stufe (5/10) zeigte `31k`. Das Gold fiel in dieser Zeit um 31.219.

### Mistrzostwo walk (Kampfkette)

Im Protokoll beim Klick auf eine Fähigkeit im offenen Bearbeiten-Modus:

```text
_g('skills&battleaction=set&battleskills=92,38,112,197,112,38,249,108&rpt=1')
```

- Der Klick auf eine Fähigkeit hängt sie **sofort** an die Kette an und sendet. Er zeigt nicht nur die Beschreibung.
- Oberfläche: „Edytuj“ öffnet den Modus, `.save-btn` („Zamknij“), `.clear-btn` („Wyczyść listę“), Kästchen „Powtarzaj“.
- Plätze ab 8 waren gesperrt: „Wykup: 5m / 150“ (`.buy-money-btn`, `.buy-sl-btn`).
- Die Reihenfolge der Kette steht in `battleskills`, wiederholte IDs sind erlaubt (112 und 38 je zweimal).

**Vorfall bei der Untersuchung:** Ein Klick auf `#skill_108` hat den Befehl oben ausgelöst und 108 an Platz 8 geschickt, obwohl dieser gesperrt ist. Die Anzeige blieb bei 7 Einträgen. Der Befehl stand danach ein zweites Mal im Protokoll, vermutlich vom Schließen. Ob der Server ihn angenommen hat, ist nicht geprüft.

### margolab.pl

- `https://margolab.pl/skills/paladyn`: HTML mit eingebetteten Daten für alle 6 Professionen, je 42 Fähigkeiten.
- Felder u. a.: `name`, `description`, `active`, `requirements`, `requires`, `id`, `profession` (`warrior`, `paladin`, `mage`, `blade_dancer`, `trailer`, `hunter`), `position.row`, `position.order`, `game_id`, `tags`.
- **`game_id` entspricht der Spiel-ID: 42 von 42 beim Paladin, mit gleichem Namen.** Andere Professionen sind nicht verglichen.
- `row` ist 0-basiert und entspricht der Reihe. `order` ist nicht immer `xy − 1` (191 und 249 teilen sich `xy = 3`, die letzte Spalte hat `xy = 8`). Für die Zuordnung also nur `game_id` verwenden.

### Paladin: alle IDs (Stand der Untersuchung)

| Reihe | ID | Name | Waffe | Stufe |
|---|---|---|---|---|
| 1 | 99 | Gorące uderzenie | fire | 0 |
| 1 | 86 | Pchnięcie mrozu | frost | 0 |
| 1 | 112 | Porażający cios | light | 10 |
| 1 | 38 | Szybki atak | sw | 10 |
| 1 | 185 | Moc sprawiedliwych | | 10 |
| 1 | 263 | Sprawność fizyczna | | 10 |
| 2 | 186 | Skupienie na celu | 1h | 2 |
| 2 | 187 | Błogosławiona ochrona | | 10 |
| 2 | 198 | Hart ducha | | 10 |
| 2 | 108 | Gniew bogów | sw | 1 |
| 2 | 25 | Prowokujący okrzyk | sh | 0 |
| 2 | 168 | Cios krytyczny | | 10 |
| 3 | 44 | Strażnik boskich mocy | | 10 |
| 3 | 200 | Łaska Gerdeth | | 0 |
| 3 | 191 | Srebrzysty blask | | 5 |
| 3 | 249 | Odnowa mocy | | 5 |
| 3 | 76 | Aura ochrony | | 0 |
| 3 | 61 | Wrodzona szybkość | | 10 |
| 4 | 250 | Krytyczna moc ognia | fire | 0 |
| 4 | 252 | Krytyczna moc zimna | frost | 0 |
| 4 | 251 | Krytyczna moc błyskawic | light | 10 |
| 4 | 18 | Krytyczne uderzenie | sw | 8 |
| 4 | 199 | Fala leczenia | | 0 |
| 4 | 106 | Przetrwanie | | 10 |
| 5 | 197 | Rozpraszający cios | sw | 3 |
| 5 | 33 | Przeszywające uderzenie | 1h | 10 |
| 5 | 202 | Porażająca tarcza | | 10 |
| 5 | 189 | Parowanie | 1h | 10 |
| 5 | 196 | Witalność | | 10 |
| 5 | 120 | Wzmocniony pancerz | | 4 |
| 6 | 92 | Tarcza słońca | | 10 |
| 6 | 201 | Niebiańska ochrona | | 4 |
| 6 | 45 | Splot odporności | | 0 |
| 6 | 273 | Kula światłości | | 0 |
| 6 | 276 | Aura życia | | 0 |
| 6 | 119 | Trwałość mocy | | 0 |
| 7 | 77 | Płonąca przychylność | fire | 0 |
| 7 | 190 | Mroźna parada | frost | 0 |
| 7 | 301 | Napięcie bojowe | light | 0 |
| 7 | 270 | Źródło potęgi | | 0 |
| 7 | 269 | Płatnerstwo | | 0 |
| 7 | 268 | Końskie zdrowie | | 0 |

## Vermutet (nicht bestätigt)

- **Punkte gesamt = Level − 24.** Passt zu Level 232 und 208 Punkten, ist aber nur ein Datenpunkt.
- **Waffenarten:** `cl = 1` ist Einhand. Zweihand, Bogen, Orb usw. wurden nicht gesehen. `reqw=sw` heißt vermutlich Nahkampfwaffe, `1h` Einhand, `sh` Schild.
- **Element der Waffe:** steht vermutlich im gleichnamigen Stat. `light` ist gesehen, `fire` und `frost` nicht. Gift und Blutung sind nicht geprüft.
- **Kosten:** Das Lernen kostet je Stufe Gold, der genaue Verlauf ist unbekannt. Den Preis liefert nur das Fenster, und nur für die gewählte Fähigkeit.
- **„Reset punktów: 50“:** Die Währung ist unbekannt, vermutlich nicht Gold.
- **„Wykup: 5m / 150“:** vermutlich 5 Mio Gold oder 150 Drachenschuppen.
- **Doppelte Protokollzeilen:** Jeder Befehl stand zweimal im Mitschnitt, der Punkt zählte aber nur einmal. Vermutlich ruft das Spiel `_g` intern doppelt auf, tatsächlich gesendet wird einmal.
- **`.save-btn` speichert:** Der zweite Kettenbefehl stammt vermutlich vom Schließen.

## Nicht gesehen

- Die Antwort des Servers auf `skills&learn` und `skills&battleaction`. Die Spieldaten laufen nicht über HTTP-Anfragen, die das Chrome-Werkzeug sehen kann. Ein Mitschreiben von `fetch`, `XMLHttpRequest` und `WebSocket.send` blieb leer, gelesen wurde daher nur `_g`. Die Daten kommen in `Engine.skills.update(...)` an (nicht mitgelesen).
- Fehlerfälle: zu wenig Gold, Reihe gesperrt, Stufe übersprungen.

## Vorsicht beim Automatisieren

- Ist „Edytuj“ offen, ändert jeder Klick auf eine Fähigkeit die Kampfkette.
- `skills&learn` hat keine Rückfrage. Ein Fehler kostet Gold, Rücksetzen kostet zusätzlich.
- Immer zuerst `cLvl`, `mLvl`, Reihen-Voraussetzung und `reqw` prüfen, dann die Stufen einzeln und nacheinander setzen und nach jedem Schritt `cLvl` nachlesen.
