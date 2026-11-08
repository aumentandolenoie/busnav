# Audit completo GPX, fermate e manovre vocali — 8 novembre 2026

## Fermate: significato dei risultati

Il controllo esegue lo stesso algoritmo dell'app su tutti i 787 GPX, usando il GTFS Busitalia corrente. `stop-coverage.csv` riassume ogni percorso. `stop-coverage.json` conserva proposte, trip_id, identità e coordinate originali delle fermate, distanze sul GPX, fermate escluse e provenienza. Non sono state generate coordinate o sequenze invertendo il ritorno.

- **full-sequence**: una corsa GTFS della linea compatibile conserva la propria sequenza completa e ordinata sul GPX. Il controllo è geometrico: non certifica il servizio di una particolare giornata.
- **review-required**: sottosequenza, variante deviata, concatenazione o abbinamento geometrico di una linea il cui nome non coincide con la cartella Academy. L'interfaccia indica le esclusioni e richiede la verifica esplicita del conducente. La copertura percentuale misura il tratto tra la prima e l'ultima fermata, non la completezza di tutte le fermate in servizio.
- **missing**: non esiste una sequenza validabile nelle fonti disponibili. `stop-unresolved.json` elenca i casi e le fermate fisiche vicine, solo come riferimento: la loro vicinanza non prova che siano servite.

Risultato dell'audit salvato: **603 sequenze complete, 177 percorsi con proposte da verificare, 7 non abbinati**. La build ripete il controllo sulla snapshot datata 8 novembre 2026 e allega il CSV alla release. Il download diretto dal server nel runner GitHub ha ricevuto HTTP 403; non è stato aggirato. La snapshot conserva tutte le 1.178 sequenze distinte, trattenendo una corsa originale per ogni combinazione identica di linea e fermate ordinate; non è un orario operativo completo.

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
| Finestre GPX sovrapposte, con suddivisione dei tratti problematici | Adottata. Gli stessi controlli di lunghezza, direzione e copertura geometrica valgono per ogni finestra. Recuperati due percorsi completi e istruzioni parziali per gli altri 210. |
| Edge-walk | Non usato come scorciatoia: la documentazione lo riserva a geometrie quasi esatte prodotte da Valhalla, mentre questi GPX sono esterni. |
| Un altro motore o istruzioni revisionate manualmente | Possibile evoluzione; richiede la medesima verifica sul GPX. Un altro motore basato su OSM non dimostra da solo strade, sensi di marcia o accessi mancanti nei dati. Nessuna istruzione manuale è stata inventata. |

Risultato: **577 percorsi con copertura stradale completa, 210 con copertura parziale, nessuno completamente privo di manovre**. Le porzioni validate coprono circa il 99,05% della distanza cumulata di tutti i GPX (circa 16.000 km contando le varianti sovrapposte; non è la lunghezza della rete unica).

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
