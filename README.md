# LineaPilot Academy — prototipo PWA per autisti Busitalia Veneto

**Prototipo indipendente, non una soluzione approvata da Busitalia Veneto. Non usare per decidere manovre durante il servizio.**

## Contenuti
- 787 tracciati GPX estratti dall'archivio `Mappe Academy -20261105T223518Z-1-001.zip`: 557 extraurbani, 201 urbani, 29 Colli.
- Nessun PDF del pacchetto originale viene redistribuito in questo progetto.
- Archivio GPX convertito in `official-routes.json` per navigazione mappa e selezione per categoria, linea, codice e destinazione. Ogni percorso mantiene la sequenza originaria dei punti (solo duplicati consecutivi rimossi).
- Importazione GTFS da ZIP o endpoint BusOne; linee, corse, fermate, annunci e GPS.
- Combinazione **manuale e controllata**: seleziona GPX Academy, carica GTFS, seleziona la *corsa GTFS esatta*, poi premi `Associa fermate GTFS`. Il controllo verifica corrispondenza del numero di linea, distanza delle fermate dal GPX (100 metri come soglia di controllo), sequenza progressiva sul tracciato e anomalie di inversione. In caso di mismatch l'associazione viene rifiutata, non forzata.
- Indicazioni di svolta indicative, da variazioni di direzione della geometria: **non sono indicazioni attendibili per incroci o restrizioni degli autobus**.
- Simulazione del GPX senza usare GPS reale.

## Uso rapido
1. Pubblica la cartella come sito statico su Vercel (Framework Preset: Other; senza build) o un web server HTTPS. Per prova locale: `python3 -m http.server 8000` da questa cartella.
2. Cerca in `PERCORSI ACADEMY (GPX)` una linea o variante e premi `Mostra GPX`.
3. Carica un file ZIP GTFS tramite `Scarica GTFS` o `Importa ZIP`.
4. Seleziona sotto `SELEZIONA IL SERVIZIO` la linea, direzione e corsa programmata corretta. Il GTFS di default mostra un tracciato GTFS; premi `Associa fermate GTFS` per sostituirlo con il GPX Academy e associarvi le fermate.
5. Se l'app segnala differenze di linea, fermate fuori percorso o ordine non plausibile, **non usare l'abbinamento**. Potrebbero essere corsa/variante errata, feed non aggiornato o GPX non allineato alla corsa.
6. Prova `Simula corsa` a veicolo fermo. GPS e sintesi vocale sono disponibili solo dove browser e permessi lo consentono.

## Limiti di verifica
- Tutti i 787 file GPX sono stati analizzati come XML; nessun errore di parsing. Non è stata verificata la percorribilità sul campo, la validità odierna o l'autorizzazione a redistribuire pubblicamente i GPX.
- Il feed GTFS non è stato scaricato o testato in questo ambiente per limitazioni di rete/DNS: nessun abbinamento reale GPX↔GTFS è stato confermato, e la disponibilità del servizio CORS è incerta. Possibile importare ZIP localmente.
- La logica di abbinamento non è un map matching professionale: strade sovrapposte, linee ad anello e varianti simili possono produrre falsi positivi/negativi anche quando il controllo restituisce esito positivo. Verifica sempre manualmente la sequenza sulla mappa.
- Le corse GTFS non sono filtrate per calendario; devi selezionare la corsa programmata corretta.
- La PWA su iOS non garantisce GPS e voce a schermo bloccato. Il GPS deve essere usato solo se è consentito e a schermo predisposto prima della guida.
- Mappe Leaflet, JSZip e OpenStreetMap usano servizi esterni e richiedono Internet; i dati GTFS importati possono essere salvati localmente ma **non esiste offline completo**.
- Le svolte sono stimate dalla curvatura: svolte non necessariamente corrispondenti a vere manovre stradali; l'app non controlla corsie bus, strettoie, deviazioni o limiti di transito.
- Prima della pubblicazione pubblica verifica la titolarità e i permessi di utilizzo e diffusione delle mappe Academy, licenze dei dati GTFS e condizioni tile OSM.

## Fonti per i dati fermata
- Portale GTFS Busitalia Veneto: https://gtfs-biv.fsbusitalia.com/
- Proxy aggregato BusOne: https://proxy.busone.app/biv/

## Passo successivo
Testare uno o più abbinamenti GPX/GTFS reali, scegliere il percorso della corsa corretta, identificare i punti di svolta tramite rete stradale verificata ed evitare istruzioni stradali basate soltanto sulla curvatura del tracciato.
