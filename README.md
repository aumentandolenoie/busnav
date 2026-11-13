> Aggiornamento Academy: **789 GPX**, con i 787 originali immutati e due tracciati recuperati dai file senza estensione standard. Audit fermate: **562 sequenze complete, 131 proposte da verificare, 95 fuori servizio, 1 non abbinato**. I turni invernali e gli indicatori sono stati analizzati con provenienza per pagina: vedi [audit dettagliato](reports/README.md) e `academy-evidence.json`. Voce stradale: **584 completi, 205 parziali, 99,69% della distanza GPX coperta**. I conteggi 787 sotto si riferiscono al catalogo originale.

> **Audit navigazione aggiornato (8 novembre 2026):** [risultati, limiti e cause](reports/README.md), [fermate per tutti i GPX](reports/stop-coverage.csv), [copertura vocale e intervalli mancanti](reports/voice-coverage.csv). Le proposte parziali di fermate richiedono verifica esplicita; la voce stradale è sospesa nei tratti non validati.

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

## Ripristino annunci vocali durante la navigazione (v14)
- Il pulsante **Riattiva voce** è disponibile anche nella vista navigazione: è un'interazione utente diretta che può consentire a Safari iOS di sbloccare la sintesi vocale. Anche l'avvio GPS e la simulazione inviano un breve annuncio iniziale.
- L'app indica se la sintesi non parte oppure se è in riproduzione. Un timeout evita che un annuncio mai avviato blocchi per sempre la coda.
- Le svolte sperimentali possono essere annunciate da circa 230 m, evitando di sovrapporsi agli annunci delle fermate. La prossima fermata può essere annunciata anche con deviazioni GPS moderate (entro 100 m dal GPX), ma non quando il tracciamento è inattendibile.
- **Prerequisito:** soltanto i GPX Academy ai quali è stata associata una sequenza di fermate GTFS Busitalia possono pronunciare i nomi delle fermate; in caso contrario, compare un avviso esplicito.
- Nessuna modifica a GPX Academy, conteggi catalogo o alle fermate GTFS; Safari iOS può comunque sospendere TTS con display bloccato o pagina in background.

## Recupero automatico GPS sul GPX e annunci vocali (v15)
- La distinzione fra *fuori percorso* e *posizione fuori dalla finestra locale di ricerca* viene eseguita usando la distanza dal **GPX intero**. Una finestra locale rimasta indietro dopo salti GPS non deve bloccare definitivamente gli avvisi.
- Se il GPS è vicino al GPX ma molto avanti rispetto all'ultima progressione, due rilevamenti consecutivi e coerenti permettono il riallineamento automatico, con avvisi momentaneamente sospesi durante la verifica. Non vengono inventate posizioni o fermate.
- Quando il GPS è realmente oltre 180 m dalla geometria, l'app indica la distanza dal GPX e sospende gli avvisi. La mappa continua a seguire la posizione reale.
- Test di regressione con avanzamento normale, salto GPS di oltre 500 m sul GPX, recupero automatico e vera deviazione fuori percorso. Catalogo dei 787 GPX e feed fermate Busitalia invariati.

## Avvisi di svolta in due fasi e iOS a schermo bloccato (v16)
- Gli avvisi di possibili svolte sono ricavati da cambi di direzione **del solo GPX Academy**. Un primo avviso viene proposto a distanza dipendente dalla velocità stimata (150–350 m); un richiamo finale entro 85 m, se possibile e senza sovrapporsi a una fermata imminente. Ogni fase viene richiesta al massimo una volta.
- Gli annunci di fermata restano prioritari; né i tracciati GPX né un GTFS descrivono necessariamente viabilità, corsie, segnaletica, limitazioni bus o regole agli incroci: gli avvisi non sono un'alternativa a navigazione stradale certificata.
- La PWA su iPhone è soggetta alla sospensione da parte di iOS quando non è in primo piano. Anche installandola nella schermata Home, non è possibile garantire né geolocalizzazione continua, né annunci Web Speech con il display bloccato. L'interfaccia indica la possibile sospensione e tenta di riprendere la voce al ritorno in primo piano, senza promettere di recuperare annunci persi.
- Per vera navigazione in background serve un'app iOS con Core Location configurato per aggiornamenti in background e una gestione audio nativa adeguata, previa verifica dei permessi e dei requisiti di sistema. Una semplice WebView/PWA non fornisce queste garanzie.
- Test automatici su chiamate di svolta doppie, duplicati e priorità delle fermate; GPX Academy e associazioni GTFS invariati.

## iOS nativo / sideload senza Mac (prototipo)
- `ios/` ospita il progetto XcodeGen e un'app Swift che riutilizza la UI web. Swift gestisce Core Location, progressione sul GPX Academy e annunci con AVSpeechSynthesizer, anche quando WKWebView viene sospesa.
- La PWA Vercel continua a eseguire la navigazione web originale: il bridge funziona solo quando è presente il canale `window.webkit.messageHandlers.lineaPilot` della versione iOS.
- I file del catalogo Academy (787 percorsi) vengono copiati nel bundle; la versione iOS usa XMLHttpRequest attraverso WKURLSchemeHandler per leggere il JSON e un downloader URLSession nativo per ottenere il GTFS senza CORS della WebView. Mappe e librerie CDN richiedono Internet.
- Compilazione: `codemagic.yaml` o `.github/workflows/ios-ipa.yml`; entrambe compilano una **IPA non firmata**. L'azione GitHub pubblica una **prerelease** su `main` per evitare il limite di archiviazione degli artefatti Actions.
- SideStore firma e installa la IPA con account Apple gratuito, soggetto alle limitazioni di 7 giorni/slot; permessi, audio GPS con iPhone bloccato e accettazione della firma devono essere verificati sul dispositivo.
- Il progetto nativo è un primo prototipo, non una navigazione stradale certificata e non garantisce ancora continuità a schermo bloccato.

## Interfaccia essenziale e GTFS Busitalia automatico (v19)

- All'apertura l'app carica automaticamente il catalogo Academy e il GTFS Busitalia, utilizzando prima il GTFS locale se disponibile e valido. Se manca, o se la copia locale non è leggibile, recupera lo ZIP dalla fonte Busitalia preesistente. Errori visibili e pulsante di riprova solo in caso di problemi.
- La PWA memorizza il GTFS in IndexedDB. La versione iOS lo memorizza anche nella cache nativa dell'app per evitare download ripetuti quando la WebView non conserva IndexedDB; il pulsante di riprova forza un nuovo download in caso di errore.
- I pulsanti per scaricare e importare ZIP e la sezione visuale "Seleziona il servizio" non sono più presenti. I selettori GTFS legacy sono conservati nel DOM ma nascosti, così le funzioni di matching non vengono eliminate né alterate.
- Il percorso Academy viene mostrato automaticamente dopo la selezione. La variante delle fermate Busitalia va comunque verificata e confermata prima di associarla, perché una corrispondenza geometrica non è necessariamente una corsa unica.
- Controlli GPS ben visibili, impostazioni vocali ed elenco fermate espandibili, disposizione mobile con i selettori prima della mappa. Nessuna variazione ai 787 GPX, al GPS nativo o alla logica degli annunci.

## Indicazioni stradali italiane agganciate ai GPX Academy (v21)

La rete stradale OSM/Valhalla viene usata **solo come fonte opzionale di descrizioni delle manovre**. I 787 tracciati GPX Academy restano l'unico itinerario seguito dal GPS e non vengono corretti né ricalcolati. Un generatore Python (`scripts/enrich_road_guidance.py`) accetta esclusivamente il match Valhalla `bus` in `it-IT` e scarta risultati con deviazioni, tagli, lunghezze incoerenti, inversioni del percorso o lingua diversa dall'italiano. Ogni JSON validato contiene soltanto le manovre posizionate in metri sul GPX originale, con fingerprint verificata a ogni utilizzo.

I file approvati in `road-guidance/<academy-id>.json` vengono caricati a richiesta dalla PWA e inseriti nel bundle IPA. Se assenti o rifiutati, resta attiva la precedente segnalazione **indicativa** delle curve GPX. Non si mostra un nome di via o un'uscita di rotatoria inventati. Per generare i file occorre un servizio Valhalla autorizzato/proprio: il nuovo workflow `Prepara manovre italiane (GPX Academy vincolante)` accetta un ID Academy e crea una PR dopo i controlli, usando il secret `VALHALLA_ENDPOINT`. Non usa la demo pubblica in massa. Dettagli in `road-guidance/README.md`.

La presenza di una manovra OSM non certifica l'accessibilità di una strada a un autobus: restano valide prescrizioni e documentazione Busitalia.

## Voci italiane configurabili e aggiornamenti installazioni (v22)

La voce del navigatore è selezionabile in **Impostazioni di navigazione**, con velocità 0,75–1,25×, anteprima vocale e memorizzazione della preferenza nel dispositivo. L'IPA elenca le voci italiane realmente installate e disponibili via `AVSpeechSynthesisVoice`: la voce proprietaria Siri non è garantita/esposta alle app. La PWA utilizza le voci italiane di SpeechSynthesis; l'APK Android sperimentale usa `TextToSpeech` nativo, scegliendo fra le voci italiane installate.

L'IPA e l'APK generati da GitHub Actions incorporano il proprio tag release, rispettivamente `ios-preview-<SHA>` e `android-preview-<SHA>`. All'avvio e su richiesta, controllano le release GitHub del progetto e mostrano **Aggiornamento disponibile** soltanto se la release più recente della stessa piattaforma è successiva a quella installata. Il download è aperto esternamente: **né iOS né Android consentono aggiornamenti silenziosi senza una normale procedura di installazione e firma.** Le release temporanee Android devono essere firmate con la stessa chiave nel tempo: aggiungere i secret `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` per usare una firma stabile. Senza secret, ogni build usa una chiave debug temporanea e per installare la successiva potrebbe essere necessario disinstallare la precedente, perdendo i dati locali. Gli aggiornamenti non sono richiesti durante una navigazione attiva.

La nuova app Android usa un `WebViewAssetLoader` HTTPS locale con tutti i 787 GPX Academy incorporati, permesso GPS soltanto in primo piano e sintesi vocale nativa italiana. Il GPS **in background Android non è ancora implementato**. La PWA e l'IPA mantengono le rispettive logiche GPS preesistenti. Il GTFS resta caricato automaticamente tramite la rete e salvato nella memoria dell'app.

Il test Android reale, i permessi in uso, le voci offline e il procedimento d'installazione APK devono essere ancora verificati su un dispositivo Android. Per ragioni di sicurezza l'app non modifica in alcun modo i 787 GPX Academy.

### Voci italiane e avviso nuove build (v23)
- iOS: elenco voci italiane native tramite AVSpeechSynthesizer; scelta automatica privilegia le voci installate di qualità più alta (Siri non è disponibile tramite API pubbliche), oppure selezione esplicita di una voce e velocità.
- Android: TextToSpeech del sistema, selezione voci italiane installate e velocità; disponibile come APK di test compilata con Gradle. Il GPS Android è previsto **solo con app in primo piano**.
- IPA e APK: avviso **in-app** quando una nuova release della stessa piattaforma è disponibile; controllo al primo avvio e al ritorno in primo piano (non più di una volta ogni 10 minuti). Il pulsante apre la release GitHub; **non installa automaticamente**.
- Le IPA unsigned vanno reimportate in LiveContainer/firmate; gli APK debug di GitHub Actions **non garantiscono aggiornamenti sopra la versione precedente** senza una firma Android stabile configurata con i secret `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Se le firme differiscono, Android rifiuta l'aggiornamento in-place e richiede disinstallazione, con possibile perdita dei dati locali. Non suggerire di disinstallare senza aver prima considerato la perdita di dati.
- L'app non dispone di notifiche push di sistema per aggiornamenti quando è chiusa; l'avviso appare all'apertura o al ritorno in primo piano. Il catalogo GPX Academy è immutato.


Nuovo approfondimento: [Padovia come fonte e voci iOS naturali](reports/padovia-and-ios-voices.md).

## Limiti di velocità (policy 3)
- Fonte: OpenStreetMap (estratto Geofabrik Nord-Est, aggiornato a ogni build dei dati), abbinato tratto per tratto ai GPX Academy con tolleranza di 4 m.
- Ogni tratto ha un livello di affidabilità: **cartello** (`source:maxspeed=sign/markings`), **mappato** (valore numerico senza fonte), **legale** (limite generale dell'art. 142 c.1 CdS per il contesto OSM `IT:urban`/`IT:rural`/`IT:trunk`/`IT:motorway`).
- Il valore mostrato è quello **per autobus oltre 8 t** (art. 142 c.3 lett. f CdS): massimo 80 km/h fuori autostrada e 100 km/h in autostrada; `maxspeed:bus/coach/psv` ha la precedenza, i limiti di altri veicoli sono ignorati.
- Non vengono mostrati limiti per direzione, a orario, per corsia, variabili o con indicazioni contraddittorie; senza dato OSM non viene stimato alcun limite.
- Copertura aggiornata per ogni GPX: [reports/speed-limit-coverage.md](reports/speed-limit-coverage.md) e [CSV](reports/speed-limit-coverage.csv). Il cartello stradale resta sempre prevalente.

## Biglietto a bordo (polimetriche Padova, prima versione)

Durante la navigazione, in basso a sinistra (dove su iOS c'era la scritta Apple Mappe,
ora spostata accanto) c'è un pulsante calcolatrice grande come il cartello dei limiti.
Apre una piccola scheda **senza fermare la navigazione**: Linea (proposta in base alla
linea in corso), Salita (fermata tariffaria più vicina al bus), Discesa (da scegliere) e
sotto `Classe N = € X a bordo`. Solo prezzi a bordo. iOS, Android e web usano gli stessi
dati (`fares/polimetriche-padova.json`) e gli stessi casi di prova
(`tests/fixtures/ticket-cases.json`). Fonti, regole TU1/TU2/Tessera e limiti in
[`fares/README.md`](fares/README.md).

## Limiti di velocità: continuità del cartello (novembre 2026)

Il cartello spariva a tratti anche restando sulla stessa strada. Cause misurate sui 789 GPX:
OpenStreetMap divide la strada a ogni incrocio e rotatoria e spesso lascia quei pezzi corti
senza `maxspeed` (9.111 buchi tra tratti con lo stesso limite, la metà sotto i 70 m), e il GPS
oltre ±15 m o a più di 8 m dal GPX nascondeva il cartello. Ora:
- un buco di al massimo 100 m fra due tratti con **lo stesso** limite viene unito (mai fra
  valori diversi): le scomparse brevi passano da circa 5.200 a circa 900;
- per **mostrare** un limite servono ancora GPS ±15 m e 8 m dal GPX; per **mantenere** quello
  già visibile bastano ±30 m e 20 m, finché il bus resta nel tratto con quel valore.
Stesse regole su web (`webSpeedLimit`), iOS e Android.
