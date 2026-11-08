# Navigazione nativa e anteprima: iOS / Android

Le app condividono catalogo, associazione fermate, selezione guidata e dati vocali verificati. La cartografia nativa viene mostrata anche durante la preparazione della corsa, nel riquadro inferiore, senza dover premere Avvia navigazione. I punti del GPX ufficiale non vengono sostituiti da una rotta calcolata dal fornitore della mappa.

| Funzione | iOS | Android |
|---|---|---|
| Mappa prima della partenza | Apple MapKit | MapLibre Native 13.6.1 / OSM |
| Mappa durante navigazione e simulazione | Apple MapKit | MapLibre Native / OSM |
| GPX | Polilinea originale | Polilinea originale |
| Fermate selezionate | Marker alle coordinate GTFS | Marker alle coordinate GTFS |
| GPS | Core Location nativo | LocationManager nativo, GPS/rete |
| Avanzamento | GPXTracker Swift | Port Java degli stessi controlli |
| Svolte/rotonde | Stesse annotazioni verificate | Stesse annotazioni verificate |
| Copertura parziale | Nessun annuncio oltre un vuoto | Stessa regola |
| Voce | Sintesi iOS, migliore voce italiana disponibile | Sintesi Android, migliore voce italiana installata, preferibilmente locale |
| Controlli | Termina, Voce, Centra, Ripeti, Bussola | Stessi cinque comandi |
| Safe area | Insets UIKit | Insets di sistema Android / cutout / tastiera |
| Simulazione | Posizione virtuale sul GPX, nessuna richiesta GPS | Stesso comportamento |
| Librerie dell’interfaccia | Incluse nell’app | Incluse nell’app |
| Pacchetto cartografia stradale vocale | Incluso e verificato nell’IPA | Incluso e verificato nell’APK |

## Differenze rispetto alla versione Android precedente

La versione precedente era una WebView con Leaflet, geolocalizzazione web e TTS Android. Non includeva automaticamente gli stessi file di svolta stradale della build iOS e dipendeva dai CDN per avviare l’interfaccia. Ora il GPS e la navigazione Android sono nativi e indipendenti dal timer JavaScript della WebView. Il pacchetto vocale viene recuperato dalla stessa release verificata oppure generato con il medesimo validatore, quindi controllato nell’APK effettivo su tutti i 789 GPX.

Il tracker Java usa gli stessi metri haversine, soglie di precisione, monotonia e recupero su due campioni del tracker iOS. Campioni vecchi o imprecisi sospendono gli annunci; il percorso non viene ricalcolato. In Android la sessione si sospende quando l’app lascia il primo piano e riparte con nuove posizioni al rientro. Il display resta acceso durante la navigazione.

La mappa nativa nell’anteprima riceve una copia ordinata delle coordinate GPX e solo le fermate della sequenza selezionata. Non contiene una ricerca di itinerari. Nel browser normale resta disponibile Leaflet come alternativa web; le app installate nascondono quel riquadro dopo che la piattaforma ha confermato l’anteprima nativa.

## Cartografia Android

MapLibre è il motore nativo di rendering; OpenStreetMap fornisce la cartografia. Non è necessario configurare Google Maps, un account di fatturazione o una chiave API. Lo stile della mappa e le voci disponibili non possono essere identici ad Apple: sono servizi e librerie diversi. La gerarchia visiva e i comandi di guida seguono invece lo stesso schema delle due app.

Sono visibili le attribuzioni OSM, le richieste identificano LineaPilot, la cache HTTP è attiva e il prefetch è disabilitato. Non è previsto lo scaricamento massivo di mappe offline. Il servizio tile OSM è best effort: la cartografia richiede una connessione o tile già in cache; non viene promessa una copertura offline. Traffico live e rilievo Apple non sono disponibili nella cartografia OSM Android. MapLibre non fornisce le istruzioni vocali: quelle rimangono le annotazioni già validate sul GPX.

## Verifiche

- Test Java del tracker: coordinate invalide, campioni vecchi/imprecisi, fuori percorso, recupero, incroci, fine percorso, immutabilità e copertura con vuoti.
- Test su emulatore Android: MapView nativa sia in anteprima che durante la guida, stile e sorgente GPX realmente inizializzati, cinque comandi senza sovrapposizioni e dentro il contenuto sicuro; ripetuto con caratteri ingranditi.
- Test UIKit: anteprima MapKit, corrispondenza dei vertici con il GPX e area del comando Mostra tutto il percorso, oltre ai precedenti controlli di navigazione.
- Verifica dell’APK: 789 GPX, digest originale invariato, copertura vocale compatibile, file di indicazioni per tutti i percorsi validati/parziali, runtime MapLibre arm64 e librerie dell’interfaccia incluse.

Gli screenshot dell’emulatore usano una base cartografica locale neutra per non dipendere dalla rete durante i test. La build per l’utente usa le tile OSM online. GPS, voce e stabilità richiedono anche una prova sul telefono reale.

Fonti:
- https://maplibre.org/maplibre-native/android/examples/getting-started/
- https://maplibre.org/maplibre-native/android/api/
- https://operations.osmfoundation.org/policies/tiles/
- https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets
