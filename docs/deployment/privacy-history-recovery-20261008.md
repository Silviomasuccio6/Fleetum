# Fleetum — recovery della tranche privacy e storico, 8 ottobre 2026

## Perimetro

Applicazione e riserva provengono dal candidato verificato `dbe8ada7d9f1a66b14dd0c4bc0ab3a5f46e90600`. Il nuovo tooling e il commit documentale hanno identità distinte. Usare il checkout isolato, mantenere main e provider invariati, non leggere env reali e non usare dati personali. Nuova UI rinviata. Nessun push, merge, dispatch, SSH, deploy, email o pagamento reale.

## Preparazione e comando

Node22.23.1/npm10.9.8, cache npm e Prisma verificata, immagine PostgreSQL16 già locale. Installazioni offline senza lifecycle; database e upload temporanei sintetici. Directory evidence nuova, assoluta e canonica. Il wrapper conserva la source freeze prima/dopo e rifiuta esiti incompleti.

```sh
NODE_ENV=test DOTENV_CONFIG_PATH=/dev/null node ops/verify-restore-recovery.mjs \
  --source-sha <SHA_COMPLETO_TOOLING_VERIFICATO> \
  --baseline-sha db1f231dc8cb699f1a5ce4215a0278c93212d16d \
  --recovery-source-sha dbe8ada7d9f1a66b14dd0c4bc0ab3a5f46e90600 \
  --application-recovery --production-build \
  --git-dir /absolute/verified-local-object-store \
  --docker-host unix:///absolute/local/docker.sock \
  --evidence-dir /private/tmp/new-fleetum-privacy-recovery-evidence
```

Il codice applicativo del tooling deve essere equivalente alla riserva. La baseline42 serve solo al confronto storico; corrente48, nessuna migrazione aggiuntiva o down SQL. Le compilazioni reali usano NODE_ENV=production; le fixture NODE_ENV=test con provider HTTP bloccati prima degli import e cron fermi. Nessun budget RTO/RPO di produzione approvato deriva dai limiti locali.

## Accettazione

Richiedere result.success=true, due restore completi di tutte le tabelle e upload, quattro fault startup-rejected/database-unready/pause-before-import/client-artifact-mismatch, coppia compilata congelata e manutenzione503 fino a readiness/generazione/integrità/dati corretti. La riserva riavvia la stessa applicazione aggiornata: non rappresenta una precedente release distinta approvata o un fallback OCI.

La fixture corrente viene preparata dopo le48migrazioni e prima del dump48; il seed storico42 resta invariato. Verificare export del solo soggetto nonostante email condivisa con utenti/altri clienti e code credenziali, assenza di contenuti raw; cliente già anonimizzato non aggiornabile con tombstone storage conservato e relazione rimossa, sibling attivo accessibile; preserveTerms senza cambi operativi calcola dai metadata storici con riferimenti live disattivi/eliminati logicamente, conserva gli override; legacy non autorevole restituisce quote:null. Accessi di tenant estraneo e anonimi restano negati. Login e CSRF reali della fixture; token e password non entrano nei receipt.

Gli smoke dopo entrambi i restore eseguono il sorgente backend, in layout upload relativo/assoluto. Successivamente backend/dist e frontend/dist vengono realmente compilati in produzione e interrogati su database già restaurato, prima/dopo ciascuno dei quattro fault. Non attribuire al build dist una prova precedente al backup. Export aggiunge AuditLog legittimi conservati nel successivo snapshot, come login e audit già previsti: nessuna cancellazione artificiale della prova.

Questi probe provano durabilità di erasure/tombstone e termini prezzo, senza ripetere le race pendenti o fault di cancellazione fisica già provati nei test PostgreSQL precedenti. Retention cron disabilitata; nessuna nuova prova di scheduling distribuito. Conservare lo stato Platform revocato e la sessione sibling; verificare token ancora valido negato per revoca persistente e gli hash/versions delle librerie immagini effettivamente caricate.

## Cleanup e consegna

Rimuovere soltanto subprocessi, gateway, container, rete, upload e scratch creati dal runner; verificare l'assenza delle risorse identificate. Nessun prune o kill per prefisso. Fallimento/interruzione/cleanup incompleto impedisce PASS; preservare log e ripartire con evidence dir nuova. Il drill elimina la coppia dist temporanea: rimangono hash/inventari e pin sorgente della riserva, non una release OCI installabile.

Restano19gate esterni aperti, registry originale37 invariato26risolti/2parziali/4redesign/5marketing. BE-03 eSEC-10 rimangono parziali per disciplina legacy/rettifiche e decisioni privacy. Prima di installazione servono revisione umana, CI sulla versione esatta, target isolato, operatori, soglie e autorizzazioni distinte. Nessun merge main per avviare CI. Il nuovo rapporto deve riportare i numeri effettivi e distinguere i gate appena rieseguiti dalle prove storiche.
