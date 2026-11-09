# Verifica dei limiti di velocità lungo i GPX Academy

Archivio analizzato [ios-preview-aeacc9af4443](https://github.com/aumentandolenoie/busnav/releases/tag/ios-preview-aeacc9af4443).

Limite visualizzato su **7,749.5 km su 16,061.1 km** (48.3%). Le distanze sommano anche le varianti di percorso.
**14 percorsi** sono interamente privi di limiti. **131 percorsi** hanno almeno un avviso per una postazione fissa.

Le cause dei vuoti sono state verificate ricostruendo il grafo dall'estratto Nord-Est OSM corrente e applicando gli stessi controlli di aderenza al GPX. I tag sono letti sulla strada associata al percorso.
Finestre non riprodotte o prive di attributi allineabili: 27.

| Esito | km |
| --- | ---: |
| Limite visualizzato | 7,749.5 |
| Nessun limite numerico mappato sulla strada verificata | 7,550.4 |
| Tag presente senza un valore univoco in km/h | 0.2 |
| Limite variabile, condizionato, per corsia o categoria | 24.6 |
| Limite direzionale escluso dall'esportatore | 22.0 |
| Valore numerico con formato o metadati non gestiti | 98.9 |
| Limite numerico compatibile, non presente nell'archivio | 5.6 |
| Strada o geometria non confermata sul GPX | 609.4 |
| Fonti sovrapposte discordanti | 0.5 |

## Esito dei 14 percorsi senza limiti

- **11 percorsi** (35, 36, 238, 240, 252, 256, 422, 423, 424, 474, 688) hanno restituito una geometria per gli attributi stradali diversa da quella della manovra. L'esportatore richiede geometrie identiche per usare quegli attributi. Il risultato non permette di stabilire la presenza dei limiti sulla strada percorsa.
- **3 percorsi** (407, 488, 489) hanno strade abbinate senza limiti numerici nella fonte. Sul GPX 489 restano anche circa 4 metri senza un abbinamento verificato.

Su tutti i percorsi, il confronto ha individuato 27 finestre con geometrie diverse. I 98,9 km con valori numerici accompagnati da metadati o formati esclusi sono candidati da verificare prima della pubblicazione.

## Percorsi senza limiti

| GPX | Percorso | km | Causa prevalente |
| --- | --- | ---: | --- |
| 35 | 238 – Padova - Piove Di Sacco - Candiana - Cavarzere | 54.64 | Strada o geometria non confermata sul GPX |
| 36 | 239 – Padova - Cavarzere | 41.95 | Strada o geometria non confermata sul GPX |
| 238 | 119 – Padova - Cervarese - Rovolon - Barbarano | 47.49 | Strada o geometria non confermata sul GPX |
| 240 | 222 – Padova - Rovolon - Carbonara | 31.07 | Strada o geometria non confermata sul GPX |
| 252 | 933 – Padova - Cervarese - Rovolon - Carbonara - Vò | 40.22 | Strada o geometria non confermata sul GPX |
| 256 | 933 – Padova - Rovolon - Carbonara - Vò | 35.28 | Strada o geometria non confermata sul GPX |
| 407 | 999 – San Pietro In Gù - Carmignano | 2.99 | Nessun limite numerico mappato sulla strada verificata |
| 422 | 1133 – Este - Vo - Rovolon - Bastia - Cervarese | 32.87 | Strada o geometria non confermata sul GPX |
| 423 | 242 – Este - Lozzo - Rovolon - Bastia - Cervarese | 38.55 | Strada o geometria non confermata sul GPX |
| 424 | 303 – Saccolongo - Fossona - Cervarese - Bastia - Rovolon - Vo - Este | 41.58 | Strada o geometria non confermata sul GPX |
| 474 | 544 – Rottanova - Piove Di Sacco - Z.I. - Padova | 50.43 | Strada o geometria non confermata sul GPX |
| 488 | 999 – Bojon - Lova | 3.79 | Nessun limite numerico mappato sulla strada verificata |
| 489 | 999 – Lova - Bojon | 3.80 | Nessun limite numerico mappato sulla strada verificata |
| 688 | 13B – Altichiero - Via Boccaccio | 14.17 | Strada o geometria non confermata sul GPX |

Il [CSV](speed-limit-coverage.csv) dettaglia ogni percorso. L'assenza di un avviso indica che l'archivio non dispone di una postazione fissa associata e verificata per quel GPX.
