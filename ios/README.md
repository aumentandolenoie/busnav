# LineaPilot iOS — primo prototipo nativo

Questo progetto **non sostituisce** la PWA Vercel. La root conserva i **787 GPX Academy** e tutte le funzioni Web.

## Architettura

- La UI HTML/Leaflet è copiata nel bundle IPA (cartella `Web`) dallo script `scripts/prepare-ios.sh`; i dati sono gli stessi della PWA.
- Una `WKWebView` carica i file locali tramite il protocollo `lineapilot://app/` usando `WKURLSchemeHandler`.
- Cliccando **Avvia GPS** nell'app, JavaScript invia al motore Swift il GPX selezionato, le distanze delle fermate **Busitalia** e le svolte indicative. La PWA tradizionale continua a utilizzare `navigator.geolocation`.
- Swift `CLLocationManager` continua a calcolare progressione/fermate e pronuncia i nomi con `AVSpeechSynthesizer`, senza dipendere dalla WebView quando iOS sospende JavaScript. La WebView è aggiornata in primo piano.
- `UIBackgroundModes` comprende `location` e `audio`; con i permessi e la firma appropriati può funzionare anche durante il blocco dello schermo. **Da verificare sul dispositivo reale**: il sideload con firma Apple gratuita può avere limiti.
- Le svolte sono interpretate dalla geometria GPX, **non** da una rete viaria verificata per autobus.

## Compilazione senza Mac

Nel repository, Codemagic usa il workflow `lineapilot-ios-unsigned`. Oppure esegui manualmente l'azione GitHub **LineaPilot iOS unsigned IPA**.

Il workflow:
1. Verifica e copia il catalogo Academy in `ios/Web`.
2. Genera `ios/LineaPilot.xcodeproj` con XcodeGen.
3. Compila per iPhone con `CODE_SIGNING_ALLOWED=NO`.
4. Confeziona `LineaPilot-unsigned.ipa` e rende disponibile il log di compilazione.

Il file è **NON FIRMATO**: è un artefatto da firmare tramite SideStore o altro metodo di sideloading supportato. Non è un'IPA già installabile. L'installabilità e i permessi di background della firma gratuita vanno verificati; LiveContainer può aggiungere limitazioni.

### Test sul telefono

Apri l'IPA firmata, carica il GPX Academy e associagli una corsa GTFS Busitalia. Avvia GPS e concedi il permesso posizione; verifica gli annunci a schermo acceso e poi con schermo bloccato **solo quando non sei alla guida**. Se vedi la mappa ma nessun percorso, controlla il caricamento del catalogo locale e delle CDN Leaflet/JSZip. Testa anche il pulsante Termina, le fermate e lo sblocco del telefono.

### Limiti iniziali

Questo primo prototipo richiede internet per mappe OpenStreetMap e dipendenze JS da CDN e per il download GTFS (a meno di caricare lo ZIP manualmente). Il motore nativo non rappresenta istruzioni stradali autorizzate. Non interrompere la navigazione reale con app non collaudata.
