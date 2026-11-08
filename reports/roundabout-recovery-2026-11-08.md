# Recupero delle indicazioni di rotonda senza numero — 8 novembre 2026

Sono state recuperate **509 delle 823 indicazioni iniziali** (61.8%). Di quel gruppo restano 314 casi senza numero confermato.

Il controllo aggiuntivo sulla presenza dell'uscita ha individuato anche 64 manovre precedentemente numerate da riesaminare: 9 sono state recuperate dal controllo locale, 55 restano da confermare. Il totale attuale senza numero è **369**. Le indicazioni di rotonda con numero verificato passano da 10.559 a 11.013.

## Esito rispetto alle 823 iniziali

| Esito | Indicazioni |
| --- | ---: |
| Recuperate e numerate | 509 |
| Ancora senza numero confermato | 314 |
| Totale iniziale | 823 |
| Ulteriori casi esclusi dai controlli più rigorosi | 55 |
| Totale attuale senza numero | 369 |

Le occorrenze si riferiscono alle indicazioni nei GPX: più varianti possono attraversare la stessa rotonda fisica.

## Come avviene il recupero

Il controllo principale mantiene la verifica geometrica bidirezionale entro 12 metri. Per i casi rifiutati:

1. Si estrae dal GPX originale un contesto completo, da circa 260 metri prima a 320 metri dopo la manovra.
2. Si eseguono due abbinamenti al grafo Valhalla: configurazione normale e configurazione precisa. Ogni risposta verifica il lato di guida degli archi italiani.
3. Entrambe devono descrivere ingresso e uscita effettiva della rotonda, con almeno 55 metri di contesto prima e dopo. Una traccia che termina nella rotonda viene esclusa.
4. Il numero viene accettato se entrambe superano il controllo principale oppure la verifica aggiuntiva dei rami. Quest'ultima richiede 40 metri di ingresso e uscita aderenti al GPX entro 7 metri e 12 gradi, progressione coerente e scostamento della parte centrale entro 20 metri in entrambi i versi.
5. Le due risposte devono concordare sul numero e sugli stessi punti di ingresso e uscita entro 5 metri.

Il metodo recupera, fra gli altri, rotonde molto piccole in cui ingresso e uscita si proiettavano sullo stesso punto GPX. Il tracciato ufficiale non viene spostato, semplificato o sostituito.

## Esempi recuperati

| GPX | Percorso | Progressiva | Nuovo annuncio |
| --- | --- | ---: | --- |
| 2 | 868 – Padova - Vigonovo - Celeseo - S. Angelo - Bojon | 24605 m | Alla rotonda, prendi la prima uscita |
| 3 | 868 – Padova - Vigonovo - Celeseo - S. Angelo - Bojon | 24605 m | Alla rotonda, prendi la prima uscita |
| 17 | 515 Mirano Padova | 1308 m | Alla rotonda, prendi la prima uscita |
| 18 | 225 – Padova - Piazzola - Carmignano | 9881 m | Alla rotonda, prendi la terza uscita |
| 19 | 281 Padova-PiazzolaIst.-Carmignano | 9943 m | Alla rotonda, prendi la terza uscita |

Il test reale della linea 523 mostra anche perché alcuni numeri restano esclusi: le modalità normale e precisa restituiscono prima e seconda uscita su una piccola rotonda. Il test impone che questo caso resti senza numero.

## Perché restano 369 indicazioni senza numero

| Motivo | Indicazioni |
| --- | ---: |
| Traccia locale o rami non superano i controlli geometrici e di progressione | 338 |
| Attraversamento o contesto della rotonda incompleto | 28 |
| Conteggi diversi fra le due modalità | 3 |

Per questi casi l'annuncio rimane “Alla rotonda, segui il percorso GPX ufficiale”. Non sono dichiarati risolti e non ricevono numeri presunti.

## Verifiche e dati

- 28 test sul validatore, eseguiti anche senza indice spaziale, inclusi casi reali, conteggi discordanti, attraversamenti incompleti e immutabilità del GPX.
- 43 test JavaScript.
- Tutti i 789 GPX elaborati, per 19.953 manovre. La copertura geometrica resta di 584 percorsi completi e 205 parziali.
- Stesso archivio delle indicazioni per iOS e Android, usato nella simulazione e nella navigazione GPS.
- SHA-256 del catalogo GPX originale: `1a6bb11b15550def33e20095758c0f48dc33259ef2f4010fd9bc5c22aa346ac7`.

Queste sono verifiche automatiche sui dati e su casi campione; non equivalgono a un collaudo su strada di ogni incrocio.

Dati riproducibili: [elenco iniziale delle 823](roundabout-recovery-input.json), [rapporto completo con confronto individuale](road-guidance-audit.json), [casi reali di test](../tests/fixtures/roundabout-recovery-reference.json).
