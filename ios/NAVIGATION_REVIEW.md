# Navigazione iOS / LiveContainer

## Implementazione

- 787 GPX Academy (638.408 punti) intatti; nessun ricalcolo o scorciatoia.
- Durante il GPS iOS, MapKit mostra la cartografia Apple online corrente. La linea sovrapposta proviene esclusivamente dai punti Academy.
- Un solo `GPXTracker` alimenta avanzamento, prossima fermata e voce. Il matcher rifiuta fix fuori ordine, qualità >65 m e salti non confermati; cerca prima lungo la progressione locale per evitare cambi di giro agli incroci.
- Fermate Busitalia GTFS selezionate esplicitamente: coordinate reali sulla mappa, distanze/annunci lungo il GPX. Una nuova selezione cancella subito il precedente percorso.
- AVSpeechSynthesizer italiano, avvisi anticipati proporzionali alla velocità e richiamo in prossimità. Gli annunci ravvicinati non si scartano né si interrompono: vanno in coda (max 4) e sono letti uno dopo l'altro ("Poi, …"), prima la fermata o manovra che si incontra prima lungo il GPX, con la distanza ricalcolata al momento della lettura. Annunci superati o in attesa da oltre 25 s vengono scartati. Un watchdog ricrea il sintetizzatore se iOS non segnala l'inizio o la fine di un annuncio, così la voce non resta bloccata.
- Preparazione in tre passaggi: percorso → sequenza fermate → riepilogo e avvio.
- Librerie web incluse nell'IPA; il selettore non dipende da CDN durante l'utilizzo.

## Istruzioni stradali

La build scarica l'estratto Geofabrik **Nord-Est Italia corrente**, avvia l'immagine upstream `ghcr.io/valhalla/valhalla-scripted` e chiama `trace_route` con costo autobus e lingua italiana. Non usa servizi demo esterni. Nessun punto GPX viene eliminato per soddisfare i limiti API.

Per modifiche native successive, i dati già validati vengono riutilizzati per meno di sette giorni solo se hash dei GPX e versione del validatore coincidono; altrimenti il grafo viene rigenerato.

Ogni risposta passa controlli di lunghezza, copertura in entrambe le direzioni campionata ogni 25 m, estremi, progressione e fingerprint completa. Una rotonda viene annunciata con un numero di uscita solo se presente nella risposta stradale. Curve geometriche, inversioni o risposte non validate non generano istruzioni vocali.

`coverage.json`, allegato alla release, elenca esattamente quali percorsi hanno istruzioni validate e perché gli altri sono stati esclusi. Una mancata copertura viene mostrata nel riepilogo prima dell'avvio. Nessuna dichiarazione di copertura totale è implicita nella compilazione riuscita.

## Limiti e collaudo sul dispositivo

- LiveContainer esegue l'app nel processo del suo host: la continuità GPS a schermo bloccato non può essere garantita dal plist dell'app ospitata. Il GPS viene configurato in primo piano senza richiedere il flag che può far terminare CoreLocation nell'host. Durante la guida lo spegnimento automatico dello schermo è disabilitato.
- Le mappe Apple richiedono connettività per aree non già in cache. Non è fornito un pacchetto cartografico offline.
- Il feed GTFS usa una cache locale; il pulsante di riprova ne permette il rinnovo. La validità geometrica delle fermate non certifica variazioni di servizio o deviazioni temporanee.
- I controlli automatici non verificano ricezione satellitare, permessi dell'host, altoparlante/Bluetooth, interruzioni telefoniche, temperatura o fluidità reale.
- Collaudo necessario: importazione IPA in LiveContainer; consenso posizione precisa per l'host; anteprima voce; partenza da capolinea e a metà percorso; incrocio con tratto ripetuto; fermata ravvicinata a una svolta; rotonda con uscita; perdita/ripresa GPS; cambio tratta; fine corsa. Provare con passeggero/tester o a veicolo fermo.

## Fonti tecniche

- https://github.com/valhalla/valhalla/blob/master/docker/README.md
- https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
- https://developer.apple.com/documentation/mapkit/mkmapview
- https://developer.apple.com/documentation/corelocation/cllocationmanager

## Audit successivo delle coperture

Vedi `../reports/README.md` per il controllo di tutti i 787 GPX e il caso della linea 15. Il matcher fermate ora preserva i ritorni e le visite ripetute, distingue i capolinea dai punti intermedi e separa sequenze complete da proposte da verificare. `GuidanceCoverage` impedisce istruzioni stradali nei tratti non validati e impedisce di anticipare una manovra oltre un intervallo mancante; gli annunci fermata restano indipendenti. GPS e manovre non hanno la stessa nozione di copertura.
