# Biglietteria a bordo — polimetriche Padova

`polimetriche-padova.json` alimenta la calcolatrice del biglietto a bordo
(pulsante in basso a sinistra durante la navigazione, su iOS, Android e web).

## Fonti

- **Polimetriche servizio extraurbano della Provincia di Padova** (Busitalia Veneto,
  `Polimetriche_Padova_2410.pdf`, aggiornamento 10/2024): 62 linee, una pagina per linea,
  matrice triangolare salita/discesa → classe.
- **Prezziario biglietti** (scansione): colonna *Biglietto a bordo*. Solo prezzi a bordo:
  quelli a terra non sono usati.
- **Comunicazione n.478 del 27.08.2024**: nuove tariffe per l'aeroporto di Tessera.

I PDF non sono nel repository: il JSON si rigenera con

```
python3 scripts/build_polimetriche.py Polimetriche_Padova_2410.pdf \
  tests/fixtures/busitalia-patterns-2026-11-08.zip fares/polimetriche-padova.json
```

## Regole

| Codice | Testo mostrato |
|---|---|
| `C1`…`C13` | `Classe N = € X a bordo` (classe 1 € 2,50 … classe 13 € 11,50) |
| `TU1` | entrambe le fermate nel comune di Padova: € 2,50 |
| `TU2` | entrambe nella Conurbazione (Padova, Abano T., Albignasego, Cadoneghe, Limena, Noventa P., Ponte San Nicolò, Rubano, Saonara, Selvazzano D., Vigodarzere, Vigonza, Villafranca P.): € 3,00 |
| `PD-TESSERA` | Padova – Tessera aeroporto: € 13,00 (bambini fino a 11 anni € 6,50) |
| `ABANO-TESSERA` | Montegrotto/Abano – Tessera: € 15,00 (bambini € 7,50) |
| `""` | classe non indicata nella polimetrica di questa linea |

- La classe vale solo per salita e discesa **sulla stessa linea** della polimetrica.
- Righe e colonne del PDF usano il *numero* di fermata, che può avere salti
  (es. E031 non ha la fermata 2): 3 celle riferite a fermate senza riga sono scartate.
- TU1/TU2 sono assegnate solo quando la casella è vuota e il comune di entrambe le
  fermate è certo (elenco `CONURBAZIONE` nello script); nessuna casella piena è in
  conflitto con queste regole.
- Nel prezziario Padova–Tessera è ancora € 10,00 e Montegrotto/Abano–Tessera € 13,00:
  si usano i valori più recenti (€ 13,00 / € 15,00) della comunicazione n.478 e della
  polimetrica 10/2024.

## Salita automatica

Ogni fermata tariffaria ha, se trovata nel GTFS Busitalia, una posizione
(`[nome, lat, lon]`; 826 su 862). All'apertura la salita è la fermata tariffaria
della linea più vicina al bus, entro 6 km. La discesa la sceglie l'autista.

## Linea

La linea Academy suggerisce la polimetrica (`tickets.js`): extraurbano *N* → `E00N`
(la 19 propone anche `E019A`, prima per le corse del Liceo Galilei), Colli A/AT/ATL/M/T/TL
uguali, TD → T/TL, AB → A/AT, MLA → M. Le linee urbane, la 61 e le deviazioni mercatali
non hanno polimetrica: l'autista può comunque sceglierne una dall'elenco.
