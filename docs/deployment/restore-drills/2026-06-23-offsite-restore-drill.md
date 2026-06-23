# Restore Drill Offsite - 2026-06-23

## Sintesi

Restore drill eseguito sul VPS Fleetum usando backup reali scaricati dalla destinazione
offsite. Il database e gli uploads non sono stati ripristinati sopra la produzione:
il database e' stato importato in un container PostgreSQL temporaneo e l'archivio
uploads e' stato estratto in una directory privata temporanea.

## Esito

| Area | Esito | Evidenza |
| --- | --- | --- |
| Download backup PostgreSQL offsite | PASS | Ultimo dump scaricato e verificato con `gzip -t` |
| Restore database isolato | PASS | Restore eseguito in container PostgreSQL temporaneo |
| Conteggi DB critici | PASS | Conteggi produzione e restore identici |
| Download archivio uploads offsite | PASS | Archivio scaricato e verificato con `tar -tzf` |
| File uploads recuperabile | PASS | Sentinella privata recuperata e verificata con SHA-256 |
| Produzione | NON MODIFICATA DAL RESTORE | Nessun restore sopra DB o uploads di produzione |
| Cleanup | PASS | Container, database e file di restore temporanei rimossi |

## Conteggi verificati

| Tabella | Produzione | Restore isolato | Esito |
| --- | ---: | ---: | --- |
| Tenant | 8 | 8 | PASS |
| User | 8 | 8 | PASS |
| Vehicle | 16 | 16 | PASS |
| RentalBooking | 36 | 36 | PASS |
| RentalCustomer | 21 | 21 | PASS |
| BookingContract | 19 | 19 | PASS |
| StoredFileObject | 0 | 0 | PASS |

## Uploads

Al momento del drill non erano presenti file cliente nel volume uploads e la tabella
`StoredFileObject` non aveva record. Per verificare comunque il percorso completo di
backup e restore file e' stata creata una sentinella testuale temporanea, priva di dati
personali. La sentinella e' stata inclusa nel backup uploads, caricata offsite,
recuperata nella directory privata del drill, aperta dal processo di verifica e
confrontata tramite SHA-256. E' stata rimossa dalla produzione subito dopo il backup.

Il file recuperato non e' stato esposto tramite URL o route pubblica.

## Tempi misurati

| Metrica | Valore |
| --- | ---: |
| RPO osservato | 845 secondi, pari a 14 minuti e 5 secondi |
| RTO tecnico osservato | 7 secondi |
| RPO target | 24 ore |
| RTO target | 4 ore |

Il RTO osservato misura download offsite, avvio del container isolato, restore,
confronto dei conteggi e verifica uploads per il dataset corrente. Non equivale al
tempo di un ripristino completo di produzione, che includerebbe decisione incident,
write freeze, ricostruzione applicazione, verifiche funzionali e riapertura del
servizio. Il target operativo resta quindi RTO 4 ore.

## Procedura eseguita

1. Scaricato l'ultimo dump PostgreSQL e l'ultimo archivio uploads dalla destinazione
   offsite privata tramite rclone.
2. Verificata l'integrita' del dump con `gzip -t` e dell'archivio con `tar -tzf`.
3. Ripristinato il dump in un container PostgreSQL temporaneo separato dalla produzione.
4. Confrontati i conteggi delle tabelle critiche con il database Fleetum in produzione.
5. Estratto l'archivio uploads in una directory privata temporanea e verificata la
   sentinella tramite lettura e SHA-256.
6. Eliminati il container temporaneo e tutti i dati scaricati del drill.

## Rischi residui e prossimo drill

- Ripetere il drill quando esistera' almeno un documento reale, verificando che un
  record `StoredFileObject` corrisponda al file recuperato. La verifica deve rimanere
  privata e non deve generare URL pubblici.
- Il database e gli uploads sono ancora ospitati sul VPS di produzione; i backup
  offsite riducono il rischio, ma un database PostgreSQL managed resta il percorso di
  affidabilita' consigliato.
- Eseguire il drill mensile e prima di migration Prisma distruttive.
