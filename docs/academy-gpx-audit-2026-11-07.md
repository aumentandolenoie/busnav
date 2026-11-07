# Verifica completa GPX Academy — 7 novembre 2026

Ambito: ZIP originale *Mappe Academy* fornito dall'utente e file `official-routes.json` del branch `experiment/winter-turns-pdf-navigation`. Il loro SHA Git blob è identico: `d5ba921b5a1c2a63f8729594836ec56f977ab8e4`; quindi il controllo riguarda **esattamente i 787 GPX usati nell'app**.

## Esiti

- 787/787 tracciati con almeno 2 punti GPS e geometria non completamente coincidente.
- Intervallo punti per singolo GPX: 49–1802.
- 557 GPX Extraurbano, 201 Urbano, 29 Colli; nessuna geometria fuori dal riquadro geografico di controllo (44–47° N; 10–14° E).
- **34 anomalie nei nomi interni dei GPX extraurbani** rispetto ai codici originali dei file: 13 non riportano un prefisso numerico convenzionale, 21 riportano un codice diverso da quello del file.
- **GPX 1278**: codice file `1278`, linea Academy `15`, nome interno `Padova - Aeroporto Marco Polo`, **1072 punti GPS validi**. Il PDF Feriale mostra corse `E015-V` Padova → Aeroporto Marco Polo. La sua identità è ora visualizzata come `1278 | Padova - Aeroporto Marco Polo`.
- Altri esempi: `1265 | Cittadella - Onara - ... - Padova` manca del numero nel nome interno; `362 | Ist. Cornaro_Gramsci - Padova` reca nel metadata la descrizione generica "Giro in bici da corsa"; il file `1078` ha invece il nome interno che parte da `670`. In tutti questi casi il testo del file rimane visibile e l'associazione automatica viene sospesa se il nome geografico non concorda.
- Le anomalie testuali **non invalidano necessariamente la geometria**, ma richiedono controllo per ogni abbinamento specifico.

## Politica di abbinamento sperimentale

1. Il PDF identifica codice turno, codice linea, partenza, destinazione e note.
2. Si cercano solo i GPX Academy della **stessa categoria e famiglia di linea**.
3. Preselezione soltanto se esiste **una sola** corrispondenza esatta tra descrizione PDF e nomi geografici coincidenti nel file GPX e nel suo metadata; se il PDF ha note o deviazioni, nessuna preselezione automatica.
4. Prima di abilitare la navigazione per una proposta automatica, occorre **una sequenza GTFS univoca e compatibile con il GPX, con capolinea coerenti, e sigla di variante verificata quando prevista**. Altrimenti il conducente deve confermare una volta il GPX; la scelta esplicita viene ricordata con firma di tutti i punti originali.
5. I GPX restano intatti; nessuna geometria del GTFS o di OpenStreetMap sostituisce il percorso ufficiale.

**Limite:** il software non può garantire il 100% della correttezza operativa degli abbinamenti solo da nomi PDF, GPX e GTFS. Le firme evitano di riutilizzare conferme su tracciati modificati; non dimostrano la corrispondenza a ogni corsa giornaliera. La versione resta sperimentale.
