# Integrazione applicativa e controlli di rilascio — proposta

Fonti: controlli `62f0565cb0952ddfb061d3869b8c1c39cbe2ca86` (PR145),
candidato applicativo `21e6282825f0ef1c6a7b50dc6b711936fe40e137` (PR144),
base main `db1f231dc8cb699f1a5ce4215a0278c93212d16d`.
Branch di proposta: `codex/integrate-application-controls-20261010`.
Nessun merge su main o installazione live incluso.

## Risultato proposto

Le correzioni applicative del candidato vengono integrate con il rilascio
manuale, i pin, la verifica della trust SSH e la persistenza ingress dei controlli.
Le modifiche funzionali frontend già presenti nel candidato riguardano sicurezza,
errori e accessibilità; il redesign UI rimane rinviato.

L'inventario confronta tree GitHub completi: 55percorsi dei controlli e364del
candidato rispetto alla base,31in comune,21già identici e10riconciliati.
La proposta mantiene il lock della PR145 byte per byte, i suoi pin e la patch
locale braces. Le differenze di manifest necessarie sono comandi di verifica,
non nuove dipendenze. Non si reintroducono Next/eslint16.3.4 o le vecchie
eccezioni audit. Fonte, test e limiti della fork restano nel documento
`docs/security/local-braces-patch-20261010.md`: npm audit zero non certifica
indipendentemente la namespace locale.

Il workflow produzione resta quello della PR145, byte-identico: nessun
workflow_run/push/PR avvia pubblicazione immagini o SSH. Dispatch esplicito su
main, environment prima delle mutazioni, SHA/pin/prova push-main tutti coerenti.
I test ingress/deploy della PR145 sono conservati, incluse le quattro prove
aggiuntive di persistenza che non erano nella fixture del candidato.

## CI completa e prova sorgente

La CI del candidato porta sei gate: secret-scan, sast, verify,
tenant-isolation, migration-compatibility e lighthouse. Il job source-attestation
dipende da tutti e sei e pubblica una prova solo dopo il successo dei gate.
Ogni checkout usa l'head effettivo e verifica il SHA prima di usare il codice.
Il test dei controlli rimane prima di Prisma/lint/build e include le prove vendor;
non viene duplicato più avanti nel job.

La baseline migrazioni è l'esatto base SHA della PR, il previous SHA del push
oppure il SHA completo esplicito nel dispatch manuale. Il test di compatibilità
avvia solo PostgreSQL16temporaneo con dati sintetici e applica schema/migrazioni
prima di provare anche il codice della revisione precedente.

Una prova CI di PR rende revisionabile questa proposta; **non è una prova
push/main valida per il rilascio produzione**. Dopo un eventuale merge autorizzato
servono una nuova CI sul SHA realmente adottato, pin approvati e protezioni
GitHub/host verificati. Il verde della PR non autorizza operazioni live.

## Migrazioni e rollback

Sei migrazioni già presenti nel candidato, senza modifica dei byte:

- `20260910120000_oauth_flow_correlation`: persistenza e consumo dei flow OAuth.
- `20260914143000_rental_deposit_active_claim`: claim esclusivi dei depositi attivi.
- `20260919120000_email_queue_payload_retention`: classificazione/retention dei payload email.
- `20260921150000_final_release_blocker_atomicity`: vincoli per i percorsi atomici.
- `20260929120000_email_queue_deduplication_key`: deduplicazione delle email.
- `20260929150000_scheduled_report_cursor`: cursore persistente del report schedulato.

Le migrazioni preesistenti sono immutabili. Il gate deve rifiutare una modifica
o rimozione storica; una migrazione nuova non implica compatibilità finché la
prova PostgreSQL e previous-release non è realmente passata.

Prima di un futuro deploy occorrono backup/restore verificati e controllo dei
dati legacy sul database autorizzato. Vincoli nuovi possono rifiutare dati
incoerenti: non aggirarli cancellando dati o riducendo i controlli.
Il rollback applicativo usa il digest precedente verificato; non annulla
automaticamente migrazioni o ripristina il database. La compatibilità sintetica
non verifica il dataset della produzione. Un restore DB richiede un piano e
autorizzazione separati, con impatto sui dati esplicito.

## Adozione e staging ancora aperti

Revisionare il diff e la nuova CI/source proof sull'esatto SHA proposto.
Conservare la PR145 come proposta dei controlli separata e la PR144 come fonte
storica; non fare merge di workflow automatici per registrare gli endpoint.
Qualunque adozione su main richiede istruzione distinta.

Il primo piano ingress dovrà usare **la revisione integrata approvata** e la sua
prova CI effettiva ancora disponibile, oltre al SHA dei controlli realmente
adottati su main e ai pin verificati. Gli esempi21e6282/CI38033530996 nel runbook
precedente descrivono la fonte storica e non attestano il candidato integrato.

Nessuna configurazione GitHub environments/segreti, VPS, DNS, provider o registry
è modificata da questa integrazione. Staging non installato;0/19gate operativi
esterni promossi. Predisporre una proposta concreta con risorse, isolamento,
dataset sintetico, DNS/TLS, backup/recupero e collaudo prima delle azioni live.

Un eventuale annullamento della proposta Git deve preservare deploy manuale e
controlli ingress. Non effettuare un revert generale che ripristini il deploy
automatico o consenta di staccare una rete ingress attiva.
