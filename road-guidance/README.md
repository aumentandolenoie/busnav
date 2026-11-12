# Indicazioni stradali italiane: GPX Academy vincolanti

Questa cartella contiene **soltanto manovre supplementari verificate**, mai percorsi alternativi.

## Principio vincolante

**I 787 GPX Academy in `official-routes.json` sono la fonte immutabile dell'itinerario.** Né Valhalla, né OSM, né i suoi risultati possono sostituire, accorciare, correggere o ricalcolare il percorso da seguire. Il GPS e le fermate continuano a progredire sul GPX originale. I file JSON in questa cartella contengono **esclusivamente** una serie di istruzioni vocali indicizzate in metri lungo il GPX Academy.

## Preparare le manovre su un GPX

Valhalla è un motore open source con servizio POST `/trace_route`, modalità `bus` e narrativa `it-IT`. Configurare **un'istanza propria o un endpoint con autorizzazione all'uso**; non effettuare elaborazioni di massa usando server dimostrativi pubblici.

```bash
python3 scripts/enrich_road_guidance.py --route-id 'ID_ESATTO' --endpoint 'https://TUO-VALHALLA/trace_route'
```

L'ID è quello di `official-routes.json`. Ogni elaborazione produce `road-guidance/ID_ESATTO.json` *solo* quando sono superate tutte le convalide; altrimenti termina con errore e non modifica il catalogo.

### Verifiche automatiche (conservative)

1. Valhalla deve restituire **narrativa italiana**; se risponde in inglese, il risultato viene rifiutato.
2. Il tracciato agganciato alle strade deve riprodurre lunghezza, estremi, ordine e continuità del GPX ufficiale. Tolleranze: scostamento massimo 85 m, 95° percentile massimo 45 m, differenza di lunghezza massimo 7%. Se un punto supera il limite o la progressione torna indietro oltre la tolleranza, **nessuna manovra viene accettata**.
3. Solo manovre realmente riconosciute dal motore (svolte, svincoli, ingressi rotatoria) vengono esportate; vengono escluse partenza, arrivo, semplice prosecuzione e U-turn non verificati.
4. Vengono mantenute soltanto `at` (metri progressivi sul GPX Academy), tipo, lato e istruzione italiana. **Nessuna geometria stradale sostitutiva** viene salvata.
5. Il file contiene una fingerprint calcolata su **tutti** i punti originali Academy. Alla selezione l'app ripete la convalida. Se il GPX cambia, l'arricchimento precedente non verrà usato.
6. In assenza di JSON o con validazione fallita, LineaPilot mantiene **le indicazioni geometriche GPX già esistenti**, etichettate come indicative.

Valhalla può rilevare strade e rotatorie ma non garantisce che divieti, corsie, altezza/peso e limitazioni bus siano completi o aggiornati. Le indicazioni non certificano l'accessibilità della strada. Qualsiasi tratto incerto richiede verifica sulla documentazione aziendale e sul campo.

## Pubblicazione e compatibilità iOS

Solo i JSON validati ed eventualmente **revisionati** vanno committati. La PWA scarica su richiesta `road-guidance/<academy-id>.json`. Dopo ogni build la CI (`ios-ipa.yml`, passo *Publish the same validated road instructions for the web app*) committa qui esattamente i file di `navigation-data.zip`: web app, iOS e Android usano così gli stessi dati (manovre, limiti di velocità per autobus, autovelox e controlli semaforici). Le build native ripartono sempre dai file della release, mai da copie locali. Il build iOS copia gli stessi file nel bundle, così le manovre restano disponibili offline una volta installata l'IPA. Il file originale `official-routes.json` resta identico.

**Stato della prima integrazione:** il generatore, il validatore e i client PWA/iOS sono operativi. Nessun percorso viene dichiarato arricchito finché un'istanza Valhalla reale non produce e valida il suo JSON. L'app evita di inventare nomi di strade o uscite della rotatoria.

## Test

```bash
python3 -m unittest discover -s tests -p 'test_road_guidance.py' -v
node --test tests/*.test.cjs
```

Documentazione: https://valhalla.github.io/valhalla/api/map-matching/api-reference/
