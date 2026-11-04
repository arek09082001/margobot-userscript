@echo off
rem Chrome so starten, dass Margonem auch im Hintergrund weiterläuft:
rem  - verdeckte Fenster gelten nicht als "unsichtbar" (sonst stoppt das Spiel)
rem  - Hintergrund-Tabs und -Timer werden nicht gedrosselt
rem Wichtig: vorher ALLE Chrome-Fenster schließen, sonst gelten die Schalter nicht.
start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --disable-backgrounding-occluded-windows --disable-background-timer-throttling --disable-renderer-backgrounding https://www.margonem.com
