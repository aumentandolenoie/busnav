# Safe area, comandi e icone iPhone

## Correzioni

- La schermata di preparazione WKWebView è vincolata alla safe area UIKit, senza inset automatici duplicati.
- La navigazione nativa lascia la cartografia sullo sfondo, ma mantiene i pannelli e tutti i comandi all’interno della safe area.
- I comandi Ripeti, Termina, Voce, Centra e Bussola hanno un’area di almeno 44×44 punti. La bussola è posizionata esplicitamente fra i pannelli, invece di usare il controllo MapKit potenzialmente coperto dal pannello superiore.
- Le istruzioni e le informazioni della fermata possono scorrere quando lo spazio è ridotto. Termina, Voce, Centra e Ripeti restano accessibili fuori dalle aree di testo scorrevoli. Un vincolo mantiene i due pannelli separati.
- Le etichette principali supportano Dynamic Type; il testo lungo non allarga i pannelli fuori dallo schermo.
- Nel layout web i controlli seguono righe adattive, anziché distanze assolute fisse. La modalità orizzontale dispone le informazioni su due colonne. Il pulsante Continua della preparazione non copre altri comandi durante lo scorrimento.
- Lo sfondo della status bar e la distanza dal bordo inferiore sono gestiti anche per l’installazione web sulla Home.

## Icone

La causa dell’icona assente era la mancanza di un AppIcon nativo e di un PNG apple-touch-icon. L’SVG usato come favicon non sostituisce queste risorse.

È stato mantenuto il simbolo originale LineaPilot, con freccia bianca su fondo blu. Sono inclusi un asset catalog AppIcon per iPhone (20/29/40/60 punti a 2× e 3×, più il sorgente 1024×1024), un PNG opaco 180×180 per la Home e PNG 192×192 e 512×512 nel manifest web. Xcode compila Assets.car e aggiunge CFBundleIcons/CFBundlePrimaryIcon nel plist dell’app.

La verifica dell’IPA controlla che il plist dichiari AppIcon, che i PNG richiesti siano presenti nel bundle e che le icone web siano incluse. Il codice pubblico LiveContainer usa l’icona del bundle e mantiene anche una cache locale: un vecchio collegamento Home può conservare l’icona precedente. Dopo l’aggiornamento dell’IPA, se necessario ricreare il solo collegamento Home; non eliminare i dati dell’app per aggiornare un’icona. Non viene aggiunta un’estensione App Clip distinta: sono configurate le icone dell’app e dei collegamenti alla Home.

## Verifiche riproducibili

- `tests/layout-browser.py`: Chromium e WebKit, cinque dimensioni (320×568, 375×667, 390×844, 440×956, 844×390), testo standard/ingrandito, preparazione/navigazione: 40 scenari. Controlla dimensioni, hit test, safe area, sovrapposizioni dei pannelli e overflow orizzontale. Le dimensioni safe area sono emulate per il test CSS.
- `ios/Tests/NavigationLayoutTests.swift`: UIKit/MapKit reali nel simulatore iOS, quattro dimensioni e due categorie di carattere, compresa accessibilità massima. Verifica cinque comandi, dimensioni, safe area, assenza di ambiguità e separazione dei pannelli. Salva screenshot nel risultato XCTest.
- Test JavaScript: verifica delle dimensioni PNG, assenza di trasparenza e corrispondenza delle dichiarazioni AppIcon/manifest.
- Build IPA: verifica aggiuntiva sulle risorse effettivamente compilate e impacchettate.

Gli screenshot verificati sono in `reports/layout-previews`; gli archivi completi vengono salvati nelle release IPA o `layout-audit-*` per evitare il limite dello spazio artifact Actions. Questi test non sostituiscono una prova sul dispositivo con la specifica versione di LiveContainer.

Riferimenti Apple:
- https://developer.apple.com/design/human-interface-guidelines/buttons
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://developer.apple.com/documentation/xcode/configuring-your-app-icon
- https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html

Riferimenti LiveContainer:
- https://github.com/LiveContainer/LiveContainer/blob/main/LiveContainerSwiftUI/Models/LCAppInfo.m
- https://github.com/LiveContainer/LiveContainer/blob/main/LiveContainerSwiftUI/Utilities/IconServices.m
