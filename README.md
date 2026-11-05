# LineaPilot — prototipo PWA per autisti Busitalia Veneto

Una web app statica installabile, indipendente da Busitalia e PadoVia.

## Funzionalità implementate
- Importazione GTFS ZIP da BusOne, o da file locale (GTFS con routes/trips/stops/stop_times/shapes).
- Visualizzazione delle linee, direzioni, corse e sequenza fermate.
- Tracciato su OpenStreetMap/Leaflet.
- Posizione GPS in tempo reale, distanza lungo il percorso dalla prossima fermata, annunci vocali italiani.
- Segnali di svolta **sperimentali**, dedotti da variazioni geometriche del tracciato GTFS: non sono un routing stradale, non identificano sensi unici, corsie riservate, rotonde o restrizioni per autobus.
- Simulazione guidata della corsa per test senza essere sul mezzo.
- Cache locale del GTFS via IndexedDB e PWA installabile.

## Avvio
Pubblica la cartella su un hosting statico HTTPS (Vercel, Netlify, GitHub Pages). In alternativa per test su PC:

```sh
python3 -m http.server 8000
```

Apri http://localhost:8000. Su iPhone, HTTPS è necessario per la geolocalizzazione. Su Safari: Condividi → Aggiungi alla schermata Home. Nessuna compilazione, nessuna API key.

## Dati
Predefinito: https://proxy.busone.app/biv/gtfs.zip (feed terzo, potrebbe variare oppure bloccare richieste CORS). Importazione manuale ZIP è disponibile come alternativa. Fonte ufficiale per BUS e TRAM: https://gtfs-biv.fsbusitalia.com/ . I feed ufficiali sono separati: se importi il file BUS vedrai gli autobus; per il TRAM importa l'altro. Il feed predefinito unificato può includere entrambi.

**Nota di verifica**: durante la preparazione, gli endpoint sono stati confermati tramite documentazione pubblica, ma il file ZIP live non era scaricabile nell'ambiente di sviluppo. L'app non è stata validata con un GTFS reale di Busitalia Veneto né provata su strada: è un prototipo tecnico da testare.

## Limitazioni importanti
- Le corse sono elencate per direzione e orario ma **non ancora filtrate per data di servizio** (calendar/calendar_dates sono letti, non applicati). Seleziona la corsa corretta per il tuo turno.
- Il tracciato `shapes.txt` può essere ricostruito da terze parti, può essere approssimato e non è garantito per tutti i servizi. Se manca, viene mostrata solo una polilinea tra fermate senza avvisi di svolta.
- Il calcolo della progressione su shape con anelli e strade sovrapposte può scegliere la sezione sbagliata. Non sostituisce un motore di map matching professionale.
- Il passaggio di fermata e gli annunci dipendono da precisione GPS e qualità delle shape. Avvisi errati sono possibili.
- Sugli iPhone, Safari/PWA può sospendere GPS e voce a schermo spento o in background. Richiede schermo acceso per test affidabili.
- Le mappe raster, Leaflet e JSZip usano servizi CDN e richiedono connessione, anche se il GTFS scaricato resta in cache. Il prototipo **non è totalmente offline**.
- È indispensabile adeguare condizioni d'uso/attribuzioni dei fornitori dati prima di una distribuzione pubblica o uso commerciale. BusOne richiede identificazione per richieste automatizzate continuative; verificare le condizioni d'uso. Il prototipo scarica solo il GTFS statico su richiesta.
- Non usare l'app per decidere manovre in servizio: seguire sempre disposizioni aziendali, segnaletica e normativa, e interagire con lo schermo solo a veicolo fermo.

## Evoluzione proposta
1. Validare feed live, le shape e soprattutto le corse esatte Busitalia.
2. Filtrare servizi per data reale e raggruppare varianti/percorso.
3. Aggiungere routing esplicitamente supportato per autobus con vincoli infrastrutturali e map matching affidabile.
4. Implementare preavvisi personalizzabili, gestione deviazioni e test su itinerari noti, offline completo.
