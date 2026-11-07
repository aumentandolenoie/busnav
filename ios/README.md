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

### Test cloud e download

La prima compilazione macOS ha raggiunto correttamente `LineaPilot-unsigned.ipa`. Il caricamento con `actions/upload-artifact` era fallito perché la quota di storage Actions del repository era esaurita, non per un errore di compilazione. La pipeline aggiornata carica le IPA come **GitHub prerelease** dopo il merge su `main`, così il file si scarica da **Releases**. Le PR continuano a compilare senza caricare artefatti.

Per l'importazione GTFS automatica nella WKWebView, `BundledSite` serve `gtfs.zip` tramite `URLSession` e usa XMLHttpRequest in JavaScript. La PWA web usa sempre il proprio endpoint HTTPS e non viene alterata.

### Scorrimento in verticale (correzione)

Nell'app iOS la WKWebView deve avere `scrollView.isScrollEnabled = true`: la pagina mobile mostra prima la mappa e poi le sezioni GPX, GTFS e assistente di guida, accessibili con lo scorrimento del dito. In navigazione a tutto schermo continua a essere il CSS `body.navigating` a bloccare lo scorrimento della pagina. Questa correzione non modifica la PWA, i GPX o la gestione GPS.

### Correzione download GTFS su iOS (v18)

Il download GTFS nella versione nativa viene ora effettuato direttamente da `URLSession` verso l'endpoint BusOne Busitalia. Swift verifica lo stato HTTP, la dimensione e la firma ZIP, poi passa i dati binari alla WebView in blocchi base64 di 48 KiB tramite il bridge nativo. La WebView ricompone l'archivio e lo passa al parser GTFS già esistente. Questo evita il fallimento di XMLHttpRequest verso `lineapilot://app/gtfs.zip` su WebKit. Il messaggio nell'app distingue ora errori di rete, HTTP, file ZIP e trasmissione alla WebView. La PWA Vercel mantiene il proprio download HTTP originale. La gestione nativa deve essere verificata anche dentro LiveContainer.

### LiveContainer: Core Location senza crash (fix)

Se il log contiene `Invalid parameter not satisfying: !stayUp || CLClientIsBackgroundable(...)`, l'app ospitante non è autorizzata agli aggiornamenti di posizione in background. La voce `UIBackgroundModes=location` della IPA ospitata non basta: LiveContainer usa il processo e le capacità dell'app host. LineaPilot rileva il caricamento di `LiveContainerShared` e avvia **solo GPS in primo piano**, senza impostare `allowsBackgroundLocationUpdates=true`. In un'installazione standalone con la modalità `location` nel bundle, continua a richiedere la modalità background. Il comportamento reale di SideStore e le autorizzazioni iOS restano da verificare. Non usare LiveContainer per convalidare gli annunci a schermo bloccato.
