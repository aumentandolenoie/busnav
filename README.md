# LineaPilot Academy — prototipo PWA per autisti Busitalia Veneto

**Prototipo indipendente, non una soluzione approvata da Busitalia Veneto. Non usare per decidere manovre durante il servizio.**

## Contenuti
- 787 tracciati GPX estratti dall'archivio `Mappe Academy -20261105T223518Z-1-001.zip`: 557 extraurbani, 201 urbani, 29 Colli.
- Nessun PDF del pacchetto originale viene redistribuito in questo progetto.
- Tutti i 787 GPX sono convertiti e inclusi in `official-routes.json` (non come 787 file GPX separati), senza taglio a 400 risultati. Il file conserva coordinate ordinate e metadati di linea/variante; solo i duplicati consecutivi di coordinate sono stati rimossi.\n- Selezione in 3 passaggi: **categoria → linea/gruppo → percorso effettivo**. Categorie: Extraurbano, Colli, Urbano, Turni Invernali e Indicatori di percorso. Le ultime due sono indici dei 6 PDF dell’archivio originario: i PDF **non sono presenti nella repository** e non sono navigabili; nessun GPX appartiene a queste due categorie.\n- Il caricamento verifica 787 record, ID univoci, presenza di almeno due punti e conteggi categoria (557/29/201).
- Importazione GTFS da ZIP o endpoint BusOne; linee, corse, fermate, annunci e GPS.
- Combinazione **manuale e controllata**: seleziona GPX Academy, carica GTFS, seleziona la *corsa GTFS esatta*, poi premi `Associa fermate GTFS`. Il controllo verifica corrispondenza del numero di linea, distanza delle fermate dal GPX (100 metri come soglia di controllo), sequenza progressiva sul tracciato e anomalie di inversione. In caso di mismatch l'associazione viene rifiutata, non forzata.
- Indicazioni di svolta indicative, da variazioni di direzione della geometria: **non sono indicazioni attendibili per incroci o restrizioni degli autobus**.
- Simulazione del GPX senza usare GPS reale.

## Uso rapido
1. Pubblica la cartella come sito statico su Vercel (Framework Preset: Other; senza build) o un web server HTTPS. Per prova locale: `python3 -m http.server 8000` da questa cartella.
2. Nella sezione `PERCORSI ACADEMY (GPX)` scegli **categoria**, poi **linea**, poi **percorso** e premi `Mostra GPX`. Non esiste più il limite di 400 percorsi.
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
\n## Nota sul materiale originale\nLa repository conserva la geometria di tutti i 787 GPX nel file JSON unico, non gli 787 file GPX come singoli allegati. I documenti dei turni invernali e degli indicatori di percorso sono elencati per struttura ma non redistribuiti; occorre ottenere autorizzazione prima di caricarli.\n\n## Abbinamento GTFS orientato ai GPX Academy\n1. Selezionare **categoria → linea → percorso** Academy e premere `Mostra GPX`.\n2. Caricare o scaricare un feed GTFS statico valido. Premere `Trova corse GTFS compatibili`. L'app cerca le linee con codice compatibile e confronta sul **GPX originale** la sequenza ordinata di fermate GTFS.\n3. Le corse con stessa sequenza di fermate vengono raggruppate per evitare centinaia di duplicati di orario; nessun GPX viene rimosso se manca una corrispondenza.\n4. Scegliere una sequenza di fermate proposta, controllare destinazione/variante e premere `Associa fermate GTFS`. Il GPX resta sempre la geometria usata dall'assistente; non viene sostituito dalla shape GTFS.\n5. La corrispondenza geometrica è **provvisoria**, non certifica la direzione o la validità attuale della corsa. Il matching può essere ambiguo in caso di tragitti sovrapposti, capolinea condivisi e deviazioni.\n\nLe due fonti differiscono: la nomenclatura Academy rimane invariata nel selettore principale; codici e orari GTFS vengono mostrati solo come metadati. L'interfaccia GTFS autonoma originale resta disponibile per confronto e per compatibilità retroattiva. Il download reale del GTFS e le associazioni non sono stati verificati end-to-end da questo ambiente; importare uno ZIP GTFS dalla pagina per test sul campo (da fermo).\n
## GTFS ufficiali complementari e corse suddivise (E060)
- La geometria dei **787 percorsi Academy** non viene modificata. `official-routes.json` rimane il riferimento per percorso, direzione e varianti.
- **Busitalia Veneto** pubblica il proprio feed ufficiale su <https://gtfs-biv.fsbusitalia.com/>. **MOM** rende disponibili dati GTFS attraverso il [catalogo Open Data](https://mobilitadimarca.it/p/amministrazione-trasparente/altri-contenuti-indice-delle-banche-dati/catalogo-dei-data-metadati-e-banche-dati).
- La E060 è indicata ufficialmente come *Padova–Noale; Noale–Treviso*. Il collegamento è in pool con MOM, che usa anche la numerazione **101 (101a/101b)** nel proprio materiale informativo. L'abbinamento di questi codici è **specifico per la E060**; non viene generalizzato ad altre linee.
- Nell'app puoi importare un GTFS principale e usare `Aggiungi GTFS ufficiale` per incorporare un secondo ZIP (es. MOM). Gli ID sono separati per feed per evitare collisioni tra stop_id, route_id e trip_id. Un feed privo del file facoltativo `shapes.txt` è supportato.
- `Trova corse GTFS compatibili` cerca percorsi formati da **1–4 tratti consecutivi** con geometria e ordine delle fermate coerenti con il GPX selezionato. Il raccordo fra due segmenti richiede continuità geografica, avanzamento sul GPX e controllo dell'intera sequenza; la fermata di giunzione viene deduplicata soltanto se effettivamente coincidente.
- L'interfaccia presenta le **combinazioni di fermate da confermare**, non una certezza che i segmenti siano la stessa corsa commerciale o lo stesso autobus. **Non combina gli orari in una corsa unica certificata:** i singoli servizi potrebbero essere indipendenti, su date diverse o con operatori diversi.
- Se non esiste una combinazione valida, il GPX resta consultabile **senza fermate**. Nessun percorso è nascosto o eliminato.
- Il recupero automatico del GTFS potrebbe essere limitato da HTTP 401/CORS; i file ZIP ufficiali sono importabili localmente dall'interfaccia. L'accesso e le licenze dei rispettivi fornitori devono essere rispettati.

### Stato della verifica
Verificata la sintassi JS e testate con dati sintetici: unione di 2 tratti, unione di 3 tratti, rifiuto di sequenze invertite e rifiuto di raccordi geometricamente distanti. **Non** è ancora stata verificata su file GTFS ufficiali reali l'associazione effettiva per tutte le varianti E060, né il funzionamento in browser iOS.

## Correzioni E060 (60Z/60V) e GPS Academy
- Codici GTFS con suffissi (60Z, E060-Z, E060_1) riconosciuti come famiglia **60** solo per trovare le fermate compatibili; non vengono confusi con 160 o 61. L'abbinamento resta soggetto al controllo sulla geometria GPX.
- La selezione del GPX Academy apre subito il tracciato sulla mappa e abilita Avvia GPS/Simula corsa anche senza scegliere né visualizzare una corsa GTFS. L'eventuale selezione GTFS non deve disattivare il tracciato Academy.
- Il **GTFS principale** dev'essere quello Busitalia / BusOne relativo a Busitalia. Le sequenze delle fermate vengono estratte **solo** da questo feed: GTFS aggiuntivi (MOM) sono tenuti separati e non possono aggiungere fermate proprie. Le fermate in comune sono incluse quando esistono nel GTFS principale Busitalia; non vengono duplicate da MOM.
- Il service worker ora aggiorna i file del progetto via rete con cache di ripiego, per ridurre il rischio di codice obsoleto dopo il deploy.
- I percorsi GPX Academy non sono modificati. Navigazione e svolte restano sperimentali e non autorizzano manovre stradali.

## Confronto varianti di fermate Busitalia (E060 e altre linee Academy)
- Dopo la ricerca delle corse GTFS compatibili, il pannello **Confronta le fermate delle varianti** mostra per ogni proposta i segmenti GTFS, il numero di fermate in comune, quelle presenti solo in quella variante e quelle assenti rispetto alla selezionata. Il confronto cambia selezionando un'altra variante.
- Il raccordo tra segmenti elimina un duplicato soltanto se due fermate sono entro 35 metri **e** hanno lo stesso stop_id o lo stesso nome normalizzato. La sola vicinanza non basta.
- La deduplicazione delle combinazioni tiene conto degli stop_id oltre che delle coordinate, per distinguere fermate molto vicine.
- Non viene selezionata automaticamente la combinazione col maggior numero di fermate o con il minore scarto geometrico. I GTFS MOM supplementari restano esclusi dalle fermate associate; il feed principale deve essere Busitalia/BusOne BIV.
- I dati reali delle quattro combinazioni viste nell'app non sono conservati nella repository: i loro nomi effettivi saranno confrontabili nel pannello dopo l'import GTFS. Verificare sempre le fermate con la documentazione ufficiale della corsa.

## Navigazione vocale (prototipo)
- Il GPS continua a seguire la geometria GPX Academy, senza dipendere dal percorso GTFS. Le distanze delle fermate sono calcolate **lungo il percorso**, non in linea d'aria.
- Gli annunci della prossima fermata iniziano con un anticipo adattivo di **140–400 metri** (circa 22 secondi alla velocità stimata, con soglie limitate). L'avviso viene emesso una sola volta per fermata; è prevista una seconda chiamata quando si è entro 65 metri e c'è spazio nella coda vocale. Saltare o raggiungere in ritardo la soglia può ridurre gli annunci.
- La voce italiana è preferita quando il browser la rende disponibile; puoi attivarla e verificare l'audio con **Prova voce**. Gli annunci alle fermate hanno priorità rispetto alle indicazioni di svolta, sempre sperimentali. Se il GPS è molto impreciso o fuori percorso, non genera nuovi annunci.
- Safari iOS può interrompere la sintesi vocale quando la pagina va in background o il dispositivo è bloccato; nessuna garanzia di ascolto continuativo. L'app non è un navigatore professionale e non deve essere usata per decidere manovre o distrarsi dalla guida.

## Navigazione immersiva a schermo intero e mappa orientata (v0.8)
- Premendo **Avvia GPS** o **Simula corsa**, la vista mappa occupa l'intero display. La selezione delle linee viene temporaneamente nascosta, non modificata.
- **Termina navigazione** in alto a sinistra arresta il watch GPS/simulazione e la sintesi vocale, riporta la mappa a nord e ripristina i selettori; Esc fa lo stesso su PC.
- Durante la guida la cartografia ruota verso la direzione di marcia usando `coords.heading` solo quando c'è sufficiente movimento; altrimenti usa il verso in avanti della geometria GPX Academy lungo il punto di percorrenza. Le mappe GTFS non modificano la geometria. La rotazione è gestita dal plug-in Leaflet Rotate 0.3.0; se non si carica, la mappa resta orientata a nord e il percorso/GPS continuano a funzionare.
- Gli avvisi vocali anticipati e i dati di fermata Busitalia rimangono invariati. La direzione GPX può essere poco affidabile in prossimità di anelli, sovrapposizioni, curve strette o deviazioni: non usare questa PWA come strumento di guida certificato.
- Il browser iOS non garantisce navigazione o audio a schermo bloccato; la mappa richiede il sito in primo piano. L'interfaccia non richiede l'API fullscreen nativa di Safari, usa soltanto una vista che occupa tutta l'area disponibile dell'app.

## Verifica navigazione fullscreen (regressioni)
- Il caricamento UMD di Leaflet Rotate `@tomickigrzegorz/leaflet-rotate@0.3.0` e l'API `setHeading`, `setBearing`, `stopHeadingUp` sono stati confrontati con la documentazione del progetto.
- In caso di permesso GPS negato, si interrompe la sessione e si torna ai selettori, con pulsanti nuovamente utilizzabili. Errori di posizione temporanei mostrano un avviso senza terminare forzatamente il tracciato.
- Alla fine della simulazione, la navigazione viene chiusa correttamente, GPS/voce si fermano e i pulsanti vengono riabilitati. Su iPhone restano necessari test reali del GPS, rotazione mappa e uscita dall'interfaccia.

## Stabilizzazione orientamento e inseguimento GPS (v9)
- L'orientamento heading-up è calcolato **solo sulla geometria GPX Academy**, su un intervallo lungo 140 m circa. Il `coords.heading` del dispositivo non determina più direttamente la rotazione.
- Una zona morta di circa 12° e un cambio massimo di circa 12° per aggiornamento riducono oscillazioni e rotazioni dovute a curve minime e rumorosità GPS.
- Il centro della navigazione è proiettato sul GPX Academy, non sulle coordinate GPS grezze. I ricentramenti vengono limitati (24 metri / 2,5 secondi) e animati. L'ingresso in navigazione attende il primo fix valido prima di centrare e regolare lo zoom.
- Un filtro di avanzamento confronta la posizione con un segmento vicino all'ultima posizione confermata e respinge salti implausibili verso altri punti dello stesso percorso, specie negli incroci e in tratte sovrapposte. I fix GPS poco precisi non inizializzano il riferimento di navigazione.
- Nessuna modifica alla geometria dei GPX o ai dati delle fermate Busitalia. La navigazione rimane sperimentale: verificare sul campo da fermi e non usarla come fonte di manovre autorizzate.

## Indicatore direzionale e centro stabile (v10)
- Durante la navigazione il puntatore blu con freccia in avanti rimane **fisso al centro dello schermo**. Rappresenta la posizione agganciata al GPX Academy, non la misura GPS grezza.
- La mappa viene centrata senza animazione sulla posizione proiettata sul GPX dopo ogni aggiornamento affidabile. I movimenti di pochi metri vengono smorzati e lo scorrimento manuale viene disattivato durante la navigazione, così il puntatore non può sparire fuori dallo schermo.
- La cartografia resta orientata al senso di marcia lungo il GPX; la freccia punta verso la parte alta dello schermo. Il normale indicatore GPS e il trascinamento ritornano quando termini la navigazione.
- Il puntatore appare solo dopo un primo GPS sufficientemente affidabile. Se il GPS è fuori percorso, la posizione può rimanere ferma sull'ultimo punto valido: verificare sempre lo stato GPS. Non è una posizione certificata.

## Ricentramento sulla posizione GPS reale (v11)
- Il pulsante ⌖ centra sulla **posizione GPS del dispositivo**, non sul punto proiettato sul GPX Academy. Se il dato è vecchio di almeno 10 secondi, richiede un nuovo fix ad alta accuratezza e rifiuta quello con incertezza superiore a 120 m.
- Durante la navigazione a tutto schermo, il puntatore blu fisso rappresenta le coordinate GPS ricevute. La camera segue i fix reali validi con una zona morta di 8 m per limitare oscillazioni, mentre il GPX Academy continua a definire direzione di marcia, avanzamento, fermate e annunci vocali.
- La simulazione percorre il GPX e non è una localizzazione reale. Il pulsante ⌖ utilizza sempre un fix GPS reale (quando disponibile), anche se si sta provando la simulazione.
- Non usare la posizione o le svolte sperimentali come istruzioni stradali certificate.

## Audit prestazioni, accessibilità e test di regressione (v12)
- **Correzione geometrica:** `pointAt` restituisce sempre il punto finale, e non l'inizio del GPX, quando la distanza richiesta raggiunge o supera la lunghezza del percorso.
- **Ottimizzazione GPS:** `renderStops()` aggiorna l'elenco delle fermate solo al cambiamento della fermata corrente, riducendo l'attività DOM sui dispositivi mobili.
- **Accessibilità e leggibilità:** evidenziazione della fermata attiva, focus visibile per tastiera, aree cliccabili di almeno 44 px, testo informativo più leggibile sui telefoni, etichetta esplicita per il pulsante GPS, preferenza di sistema per movimento ridotto.
- **Test automatici:** `node --test tests/*.test.cjs` controlla catalogo di **787 GPX (557/29/201)**, ID univoci, integrità minima di tutti i tracciati, sintassi JS, ID dell'interfaccia, interpolazione GPX ai capolinea e presenza delle funzionalità fondamentali. Workflow `.github/workflows/smoke.yml` esegue i controlli sui push e sulle PR verso `main`.
- Nessuna modifica a `official-routes.json`, nomenclature Academy, fermate GTFS Busitalia/MOM o contenuti del catalogo.
- **Limite:** i test automatizzati verificano la logica e l'integrità strutturale, ma non sostituiscono prove GPS/voce/rotazione su iPhone.

## Fix inseguimento GPS continuo (v13)
- La mappa segue la posizione GPS reale; per evitare micro-oscillazioni usa una soglia di 3 metri **rispetto all'ultimo punto realmente visualizzato**. I piccoli movimenti si accumulano e provocano il ricentramento, invece di lasciare la cartografia immobile.
- Il pulsante di localizzazione manuale continua a forzare il ricentramento sul GPS reale, mentre il GPX Academy resta la fonte del percorso, della direzione e delle fermate.
- Nuovo test automatico per verificare che una sequenza di aggiornamenti GPS piccoli e consecutivi sposti effettivamente la mappa.
