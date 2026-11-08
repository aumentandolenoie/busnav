# Audit completo GPX, fermate e manovre vocali — 8 novembre 2026

## Fermate: significato dei risultati

Il controllo esegue lo stesso algoritmo dell'app su tutti i 789 GPX (787 originali e 2 recuperati dall’archivio), usando il GTFS Busitalia corrente. `stop-coverage.csv` riassume ogni percorso. `stop-coverage.json` conserva proposte, trip_id, identità e coordinate originali delle fermate, distanze sul GPX, fermate escluse e provenienza. Non sono state generate coordinate o sequenze invertendo il ritorno.

- **full-sequence**: una corsa GTFS della linea compatibile conserva la propria sequenza completa e ordinata sul GPX. Il controllo è geometrico: non certifica il servizio di una particolare giornata.
- **review-required**: sottosequenza, variante deviata, concatenazione o abbinamento geometrico di una linea il cui nome non coincide con la cartella Academy. L'interfaccia indica le esclusioni e richiede la verifica esplicita del conducente. La copertura percentuale misura il tratto tra la prima e l'ultima fermata, non la completezza di tutte le fermate in servizio.
- **out-of-service**: il codice 999/F0 è dichiarato FUORI SERVIZIO dagli indicatori ufficiali: nessuna sequenza passeggeri è richiesta. I codici discordanti restano da verificare.
- **missing**: non esiste una sequenza validabile nelle fonti disponibili. `stop-unresolved.json` elenca i casi e le fermate fisiche vicine, solo come riferimento: la loro vicinanza non prova che siano servite.

Risultato dell'audit aggiornato: **562 sequenze GTFS complete, 131 percorsi con proposte da verificare, 95 fuori servizio, 1 non abbinato**. I documenti recuperano 14 associazioni prima da verificare e una sequenza completa sul nuovo GPX 787. Dei precedenti 603 completi, 54 erano trasferimenti fuori servizio e 2 hanno codici discordanti: la riduzione del numero non è una perdita di fermate. La build ripete il controllo sulla snapshot datata 8 novembre 2026 e allega il CSV alla release. Il download diretto dal server nel runner GitHub ha ricevuto HTTP 403; non è stato aggirato. La snapshot conserva tutte le 1.178 sequenze distinte, trattenendo una corsa originale per ogni combinazione identica di linea e fermate ordinate; non è un orario operativo completo.

## Linea 15 Padova → Aeroporto Marco Polo

Il GPX 176 aveva una corsa GTFS reale (593571, E015V) con sette fermate nel verso corretto. I capolinea del GTFS si trovano circa 168 m e 142 m dal GPX; le cinque fermate intermedie hanno scostamenti di circa 1–6 m. Il filtro originario consentiva un solo scostamento oltre 100 m e scartava l'intera corsa.

La correzione distingue i due capolinea dalle fermate intermedie: solo il primo/ultimo stop GTFS può essere ancorato al corrispondente estremo GPX entro 250 m. Le coordinate reali delle fermate sono conservate sulla mappa. Le fermate intermedie restano soggette a soglie limitate e all'ordine della corsa. La sequenza di andata include “Via San Marco – Delle Grazie”; il ritorno usa “Via San Marco – San Lazzaro”. I test verificano entrambe le direzioni con fixture GTFS reali.

Altre cause corrette: E0092/E0102 interpretati come linee 92/102 anziché 9/10; confusione fra numeri urbani ed extraurbani; cartelle mercatali prive di numero di linea; sottotratte GTFS; punti visitati più volte sul GPX; abbinamenti permissivi che accettavano una singola fermata distante anche chilometri.

## Fonti consultate

- GTFS usato dall'app: https://proxy.busone.app/biv/gtfs.zip — dati Busitalia Veneto, distribuzione BusOne (https://busone.app).
- Padovia: https://app.padovia.it/ — confrontati il catalogo fermate BIV e la corsa 593571. Coordinate e sequenza confermano il problema dei capolinea. Nel campione i codici stop_id differiscono dal feed BusOne: i due spazi di identificativi non sono stati mescolati. Non è stata copiata l'applicazione o la sua grafica.
- Fonte Busitalia: https://gtfs-biv.fsbusitalia.com/ — feed e archivio storico richiedono autenticazione (HTTP 401 da questo ambiente), quindi non sono stati usati per inventare dati mancanti.
- Servizio stagionale Jesolo: https://www.fsbusitalia.it/it/media/news-e-comunicati-stampa/2026/6/3/busitalia-veneto-al-via-linea-estiva-montegrotto-padova-jesolo.html — pubblicato per il 7 giugno–9 settembre 2026; il GTFS corrente non contiene E061. Per questi GPX le proposte coprono soltanto i tratti dimostrabili dal GTFS attuale, senza attribuire automaticamente le fermate dell'intero servizio estivo.

## Voce: cause, soluzioni provate e limiti

Le 212 esclusioni originarie erano: 108 differenze eccessive di lunghezza tra traccia stradale e GPX; 100 segmenti saltati o lontani dal GPX; 2 anomalie di progressione; 2 estremi non coperti. `voice-coverage.json` registra, per ciascun GPX, ogni tentativo, motivo del rifiuto, strategia accettata e intervalli non coperti. `voice-coverage.csv` è il riepilogo leggibile.

| Soluzione | Valutazione/esito |
|---|---|
| Aumentare indiscriminatamente la tolleranza | Scartata: permetterebbe istruzioni di strade diverse dal GPX. |
| Parametri di precisione della traccia completa | Provati, senza recuperi completi aggiuntivi in questo catalogo. |
| Finestre GPX sovrapposte, con suddivisione dei tratti problematici | Adottata. Gli stessi controlli di lunghezza, direzione e copertura geometrica valgono per ogni finestra. La prima elaborazione recuperava due percorsi completi e istruzioni parziali per altri 210; la suddivisione breve aggiornata completa ulteriori sei percorsi originali. |
| Edge-walk | Non usato come scorciatoia: la documentazione lo riserva a geometrie quasi esatte prodotte da Valhalla, mentre questi GPX sono esterni. |
| Un altro motore o istruzioni revisionate manualmente | Possibile evoluzione; richiede la medesima verifica sul GPX. Un altro motore basato su OSM non dimostra da solo strade, sensi di marcia o accessi mancanti nei dati. Nessuna istruzione manuale è stata inventata. |

Risultato: **584 percorsi con copertura stradale completa, 205 con copertura parziale, nessuno del tutto privo di copertura**. Le porzioni validate coprono circa il 99,69% della distanza cumulata di tutti i GPX (circa 16.000 km contando le varianti sovrapposte; non è la lunghezza della rete unica).

Nel tratto non coperto l'app mantiene GPS, GPX e annunci delle fermate associate, ma sospende le manovre stradali e non anticipa una svolta collocata oltre quel tratto. I percorsi e le coordinate GPX restano intatti. La copertura parziale non è presentata come navigazione vocale completa.

Documentazione del motore: https://valhalla.github.io/valhalla/api/map-matching/api-reference/

## Ripetere i controlli

```bash
python3 scripts/download_gtfs_for_audit.py build/audit-feed.json --snapshot tests/fixtures/busitalia-patterns-2026-11-08.zip
node scripts/audit_stops.cjs build/audit-feed.json reports/stop-coverage.json
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_road_guidance.py' -v
```

Sono ancora necessari dati di servizio o una verifica operativa per completare i casi parziali/non abbinati. Non è corretto sostituire questa verifica con fermate vicine, con una lista invertita o con manovre derivate solo dalla curvatura del GPX.

Per ripetere la verifica con un nuovo feed online si può omettere `--snapshot`; la provenienza e la data vengono registrate nel JSON. L'app continua a caricare il feed dalla propria connessione e non usa la fixture di test come orario operativo. Le distanze esportate dal motore stradale vengono normalizzate alla stessa metrica haversine usata da GPS e fermate, evitando disallineamenti e falsi rifiuti dei percorsi lunghi.

## Archivio Academy e Padovia: nuovo controllo

Analizzati tutti i contenuti XML dell’archivio, non solo i nomi terminanti in `.gpx`: 789 tracciati. Due file erano esclusi dall’importazione: 687 Tombelle–Vigonovo–Piove di Sacco (395 punti) e 1265 Cittadella–Onara–Cavino–Ist. Severi con deviazione Sant’Anna Morosina (958 punti). Sono in `academy-supplemental-routes.json`; il file originale `official-routes.json` conserva lo stesso SHA256. Nel confronto con l’archivio si tiene conto solo dell’arrotondamento a sei decimali e dei duplicati consecutivi già eliminati dall’importatore originale.

Estratti 1.488 record indicatori e 5.783 tratte dai turni feriali, sabato e festivi 2026/27. `academy-evidence.json` conserva SHA256 dell’archivio e dei sei PDF, pagine, codici, corse, orari, note e riscontri per ogni GPX. Le associazioni di linea usano solo indicatori con colonna linea o descrizioni normalizzate quasi esatte dei turni, quindi passano comunque attraverso i controlli geometrici GTFS. Non vengono ricavate fermate intermedie dalle sole destinazioni. La direzione non viene invertita.

I codici 999 (indicatori extraurbani) e F0 (urbani) significano FUORI SERVIZIO. Il turno conferma anche Piazzale Roma–Tronchetto come trasferimento. I GPX 196, 345 e 405 riportano codici discordanti e richiedono conferma. Non si considera automaticamente fuori servizio una corsa chiamata soltanto “Diretta”.

Rimane senza sequenza il GPX 95, “Dev. partite a Chioggia A/R”: non è dimostrata una sequenza ordinata di almeno due fermate dal GTFS disponibile. Gli altri 131 richiedono ancora verifica di deviazioni, concatenazioni, sottotratte, linee storiche o stagionali. I turni non elencano tutte le fermate intermedie e non risolvono questa lacuna. Il nuovo GPX 787 ha sequenze E071 complete; il GPX 788 ha proposte E038 con fermate escluse, esplicitamente indicate.

Padovia è stato controllato direttamente: applicazione pubblica, catalogo BIV, corsa 593571, progetto TTS fermate e repository pubbliche `PadoVia/vehicle-trip-matcher`, `PadoVia/GTFSFixerAI`, `PadoVia/tpl-avl-daemon`. Il catalogo osservato contiene 3.864 fermate contro 3.868 nel mirror BusOne; gli stop_id differiscono e non sono intercambiabili. La corsa aeroportuale conferma le sette fermate nel verso corretto, senza aggiungere una nuova sequenza per la deviazione Chioggia.

Il prototipo vehicle-trip-matcher associa GPS e corse GTFS con OSRM/database e ha componenti ancora TODO; non è un navigatore per le svolte. GTFSFixerAI analizza avvisi di deviazione, usa servizi esterni e richiede verifica delle fermate candidate: non è prova sufficiente per creare automaticamente nuove fermate. tpl-avl-daemon raccoglie posizioni con credenziali autorizzate, non fornisce un nuovo catalogo pubblico completo. I repository pubblici sono archiviati e non dimostrano come sia implementato oggi il servizio live. Il sito TTS fermate richiede audio via server e usa eventi di fermata; non sostituisce il riconoscimento delle manovre stradali. Per l’app rimane la sintesi nativa iOS, senza introdurre dipendenze da quel servizio.

Fonti: https://app.padovia.it/ ; https://tts-fermate.padovia.it/ ; https://github.com/PadoVia/vehicle-trip-matcher ; https://github.com/PadoVia/GTFSFixerAI ; https://github.com/PadoVia/tpl-avl-daemon . Nessun codice, audio o dataset Padovia è stato redistribuito.

Il nuovo tentativo vocale suddivide ricorsivamente i tratti problematici fino a finestre brevi, con tolleranze locali più strette, margini alle giunzioni e conservazione dei vuoti. Il test dedicato rifiuta un taglio d’angolo corto che la tolleranza globale avrebbe accettato. L’esito numerico aggiornato deve essere letto nell’ultimo `voice-coverage.json`; L’audit GitHub Actions 42483625391 è riuscito: 584 completi, 205 parziali, 19.953 manovre, 99,685% della distanza cumulata coperta. Completati i GPX originali 382, 532, 536, 537, 752 e 753, oltre al nuovo 787; il nuovo 788 ha copertura stradale del 99,79%.

Per ripetere l’estrazione dei PDF (senza alterare i GPX): `python3 -m pip install pdfplumber`, poi `python3 scripts/import_academy_evidence.py /percorso/archivio.zip`. L’opzione `--reuse-extraction` riusa solo l’estrazione PDF già salvata e richiede lo stesso SHA256 dell’archivio; la scansione XML e le associazioni sono ricalcolate.
