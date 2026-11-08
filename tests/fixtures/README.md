# Fixture GTFS Busitalia — 8 novembre 2026

Fonte: Busitalia Veneto, GTFS distribuito da BusOne (https://busone.app), acquisito da https://proxy.busone.app/biv/gtfs.zip l'8 novembre 2026 per il progetto personale LineaPilot.

`busitalia-patterns-2026-11-08.zip` preserva tutte le 1.178 sequenze distinte del feed: per ogni coppia `(route_id, sequenza stop_id)` conserva la prima corsa originale e le sue fermate. Le coordinate, l'ordine e i nomi non vengono cambiati. Deduplicare gli orari identici non cambia le proposte del matcher, che applica la stessa deduplicazione. La fixture non è un feed da usare per orari, calendario o operatività corrente.

SHA256: `7a0c7384bbebcd8177e1508abe05ba7d85224b3c090565d40539cd5c4455b7b9`.

`line15-stops.json` mantiene le corse autentiche 593571 (andata, GPX 176) e 593573 (ritorno, GPX 172), come regressione del problema dei due capolinea oltre 100 m dal GPX. Le liste sono diverse; nessuna è ottenuta invertendo l'altra.
