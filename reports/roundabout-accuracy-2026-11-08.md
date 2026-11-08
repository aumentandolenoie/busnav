# Verifica delle indicazioni stradali e delle rotonde — 8 novembre 2026

L'audit ha rilevato un difetto nei dati di navigazione pubblicati: 11108 indicazioni di rotonda su 11382 (97.6%) indicavano la seconda uscita. Le istruzioni venivano lette senza modificare il numero, sia nella simulazione sia nel GPS reale.

## Confronti riproducibili

Sul GPX ufficiale 614, **6B | Via Boccaccio - Lagrange via Sorio**, le risposte del servizio Valhalla di riferimento e il nuovo grafo coincidono:

| Progressiva del GPX | Archivio precedente | Riferimento e archivio corretto |
| --- | --- | --- |
| 2.240 m | Seconda uscita | Terza uscita |
| 3.350 m | Seconda uscita | Seconda uscita |
| 3.679 m | Seconda uscita | Prima uscita |

I segmenti GPX originali e le risposte usate per i test sono conservati in [roundabout-6b-reference.json](../tests/fixtures/roundabout-6b-reference.json). Il test verifica che i punti coincidano con il catalogo ufficiale.

## Correzione e controlli

- Gli amministrativi vengono costruiti dall'estratto nazionale completo dell'Italia prima di costruire il grafo stradale Nord-Est. La costruzione si interrompe se manca il paese IT con guida a destra.
- Cinque prove sul grafo verificano i flag effettivi; ogni successiva annotazione controlla il lato di guida di tutti gli archi attraverso `trace_attributes`.
- Una rotonda riceve un numero soltanto se il suo tratto completo è disponibile e supera una verifica geometrica locale bidirezionale entro 12 metri rispetto al GPX. Il controllo distingue uscite adiacenti che potrebbero superare il precedente controllo generale.
- I numeri sono pronunciati in italiano: prima, seconda, terza, quarta ecc.
- Il riutilizzo dei pacchetti richiede l'hash del nuovo validatore; i dati precedenti vengono scartati.
- iOS e Android incorporano lo stesso archivio, usato sia in simulazione sia nella navigazione GPS.

L'assenza di amministrativi completi e i conseguenti errori di lato di guida sono una causa documentata del sintomo “sempre seconda uscita” in [Valhalla #1099](https://github.com/valhalla/valhalla/issues/1099) e [#5116](https://github.com/valhalla/valhalla/issues/5116). La documentazione [Mjolnir](https://valhalla.github.io/valhalla/mjolnir/getting_started_guide/) spiega perché gli estratti regionali possono perdere il paese.

## Risultato sull'intero catalogo

| Uscita | Archivio precedente | Archivio corretto, numero verificato |
| --- | ---: | ---: |
| 1 | 261 | 3275 |
| 2 | 11108 | 5392 |
| 3 | 13 | 1565 |
| 4 | 0 | 294 |
| 5 | 0 | 23 |
| 6 | 0 | 6 |
| 9 | 0 | 4 |
| Senza numero verificato | 0 | 823 |

Sono state elaborate 789 tracce e 19953 manovre. Le indicazioni di rotonda con numero verificato sono 10559; per le altre 823 il testo è **“Alla rotonda, segui il percorso GPX ufficiale”**. Questi casi non sono dichiarati risolti nel numero dell'uscita.

La copertura geometrica delle manovre resta di 584 percorsi completi e 205 parziali. Il numero di manovre e la geometria GPX non cambiano. I test verificano lingua, verso, aderenza al percorso, assenza di scorciatoie, copertura, numeri delle uscite e casi reali di regressione; non costituiscono un collaudo su strada di ogni incrocio.

SHA-256 del file GPX originale: `1a6bb11b15550def33e20095758c0f48dc33259ef2f4010fd9bc5c22aa346ac7`.

Risultati integrali: [audit delle manovre](road-guidance-audit.json), [amministrativi](road-admin-audit.json), [grafo](road-graph-audit.json).
