# LED Stats Studio – FIBA / MKOSZ

## Indítás

1. Telepítsd a Node.js-t (18+ ajánlott).
2. A projekt mappájában futtasd:

```bash
npm install
npx playwright install chromium
npm start
```

3. Admin szerkesztő: http://127.0.0.1:3030
4. LED kimenet: http://127.0.0.1:3030/overlay.html

## Használat

- Az Adatforrás résznél illeszd be az MKOSZ vagy támogatott FIBA mérkőzés URL-jét, majd kattints a Csatlakozás gombra.
- A szerkesztőben válaszd ki a grafika típusát, címét, játékosszámát, kiemelőszínét és a megjelenítendő statisztikákat.
- Kattints a „Beállítások alkalmazása” gombra.
- A LED kimenet külön böngészőablakban nyitható meg; állítsd teljes képernyőre, és ezt az ablakot küldd a LED processzorra.

## Megjegyzések

- A szerkesztő beállításai a szerver memóriájában élnek, ezért szerver-újraindítás után visszaállnak az alapértékekre.
- A LED overlay WebSocketen kapja a friss állapotot és a beállításokat.
- A mérkőzésadatok beolvasása a forrásoldal HTML-felépítésétől és elérhetőségétől függ. A jelenlegi MKOSZ parser tesztelendő a konkrét mérkőzésoldalon; ha a Box Score DOM-ja nem hagyományos HTML-táblázat, a parser további célzott módosítást igényelhet.
- Ez nem hivatalos FIBA vagy MKOSZ termék.
