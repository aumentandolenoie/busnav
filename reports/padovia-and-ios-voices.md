# Padovia e voci iOS — 8 novembre 2026

## Esito Padovia

Non è stato sostituito il feed dell’app con Padovia e non è stata redistribuita una copia del suo catalogo. Il sito dichiara consultazione personale, divieto di estrazione massiva e divieto di uso dei dati per applicazioni derivate senza autorizzazione del titolare. Fonte: https://app.padovia.it/92013/follow (sezione Proprietà e utilizzo dei dati). Le stesse condizioni sono nel JavaScript pubblico dell’app esaminato. Per un’integrazione serve un export o un accesso API con autorizzazione adeguata; non basta che l’endpoint risponda senza chiave.

Il confronto locale usa esclusivamente il campione già esaminato nella precedente verifica, versione Padovia `1488f886-2999-4f20-b585-27a36806ad11`, e il GTFS BusOne datato 8 novembre 2026. Nessuna interrogazione massiva aggiuntiva è stata eseguita. Risultati aggregati, senza ripubblicare il catalogo Padovia:

| Controllo | Esito |
|---|---:|
| Fermate nel campione Padovia | 3.864 |
| Fermate nel GTFS BusOne | 3.868 |
| Fermate Padovia entro 2 m da una fermata BusOne | 3.861 |
| Fermate Padovia a oltre 100 m dal catalogo BusOne | 3 |
| Codici stop_code esattamente comuni | 48 |
| Fermate ordinate corsa aeroportuale 593571, entrambi i feed | 7 |
| Scostamento coordinate delle sette fermate, nello stesso ordine | < 1 cm |

La quasi coincidenza geografica non prova identità di servizio: fermate opposte, temporanee o con lo stesso punto richiedono comunque linea, corsa e direzione. I tre punti ulteriori sono legati a fermate provvisorie/eventi; non dimostrano la presenza delle sequenze delle deviazioni mancanti. Anche stop_code, oltre a stop_id, appartiene a spazi di identificativi diversi: nessun join automatico fra feed è stato introdotto. Il precedente controllo non aveva verificato l’intero namespace dei codici.

L’app pubblica usa un catalogo fermate e un endpoint per la sequenza di una singola corsa. Il catalogo indica le linee, ma non certifica tutte le fermate servite, nel giusto ordine, da ogni variante GPX. Disporre dei punti vicini al GPX non è equivalente a disporre della sequenza completa. Il confronto della corsa aeroportuale conferma una sequenza già presente nel feed corrente, senza fermate aggiuntive. Sul GPX 95 (deviazione partite a Chioggia), entrambi i cataloghi contengono un solo punto entro 100 m dal tracciato: il controllo di prossimità non fornisce una sequenza di servizio aggiuntiva.

Per popolare tutti i GPX servirebbero sequenze autorizzate per ogni corsa/variante, inclusi servizi stagionali, storici e deviazioni, con ordine, direzione e validità. Andrebbero poi sottoposte agli stessi controlli sul GPX ufficiale. Con i dati e i permessi attuali non è dimostrabile una copertura completa tramite Padovia. I 95 trasferimenti fuori servizio continuano a non richiedere fermate passeggeri.

## Voce naturale su iOS

Apple distingue voci base, Enhanced e Premium. Enhanced e Premium devono essere scaricate sul dispositivo. `AVSpeechSynthesizer` non offre direttamente le voci Siri: la documentazione Apple indica un fallback quando è selezionata una voce Siri. Non è stata promessa né incorporata la voce esclusiva di Mappe.

Correzioni nell’app:

- Le voci Premium non sono più etichettate e ordinate come voci base nel menu. L’automatismo nativo già preferiva la qualità maggiore: questa correzione non crea né scarica una nuova voce.
- Menu e sintesi usano la stessa selezione delle voci italiane installate: Premium, poi Enhanced, poi base; precedenza alla variante it-IT a parità di qualità.
- Le voci per effetti/novelty sono escluse dalla navigazione. Una scelta manuale valida viene rispettata.
- L’interfaccia indica il nome effettivamente selezionato e la qualità; se sono disponibili soltanto voci base, spiega come scaricare una voce migliore.
- Il catalogo si aggiorna al ritorno nell’app e quando iOS notifica una variazione delle voci disponibili.
- L’anteprima nativa contiene una svolta, la terza uscita di una rotonda e l’annuncio di fermata.

Per la prova su iPhone: Impostazioni → Accessibilità → Contenuto letto ad alta voce / Leggi e parla → Voci → Italiano; scaricare una voce Premium o di qualità avanzata disponibile. Tornare in LineaPilot, scegliere Automatica oppure la voce scaricata e premere Ascolta anteprima. Non serve attivare VoiceOver. La disponibilità effettiva dipende dalle voci esposte da iOS nel contesto LiveContainer: non può essere verificata sul runner GitHub. Una voce scaricata viene sintetizzata sul dispositivo e non richiede un server TTS.

Fonti Apple:
- https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoicequality
- https://developer.apple.com/videos/play/wwdc2020/10022/ (trascrizione: voci Siri e download di voci)
- https://support.apple.com/it-it/111798
