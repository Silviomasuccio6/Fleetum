# Fleetum Production Checklist

## Prima del deploy

- [ ] Branch corretto e PR approvata.
- [ ] CI GitHub Actions verde.
- [ ] `npm run lint` eseguito o coperto da CI.
- [ ] `npm run build` eseguito o coperto da CI.
- [ ] `npm run test -w backend` eseguito o coperto da CI.
- [ ] Nessun secret nel diff.
- [ ] Nessuna env nuova non documentata.
- [ ] Migrazioni Prisma controllate.
- [ ] Impatto tenant isolation verificato.
- [ ] Impatto Stripe/billing verificato.

## Backup

- [ ] Backup PostgreSQL eseguito.
- [ ] Backup uploads/documenti eseguito se impattati.
- [ ] Storage provider verificato (`STORAGE_PROVIDER=local` salvo migrazione S3/R2 approvata).
- [ ] Backup salvato fuori dal container.
- [ ] Restore plan disponibile.
- [ ] Punto di rollback identificato.

## Migration

- [ ] Migration review completata.
- [ ] Migration testata in local/staging se disponibile.
- [ ] Comando migration separato dal runtime app.
- [ ] Possibile impatto lock/tempo esecuzione valutato.

## Docker e container

- [ ] Immagini buildate da CI o processo controllato.
- [ ] Nessun `.env` copiato nell'immagine.
- [ ] Container backend avviato.
- [ ] Container Caddy avviato.
- [ ] Container PostgreSQL healthy.
- [ ] Volumi persistenti corretti.

## Health check

- [ ] `https://api.fleetum.it/api/health` risponde 200.
- [ ] `https://api.fleetum.it/api/ready` risponde 200.
- [ ] `https://platform.fleetum.it/platform-api/health` risponde 200 da IP autorizzato.
- [ ] `https://fleetum.it` risponde 200.
- [ ] `https://fleetum.it/robots.txt` raggiungibile.
- [ ] `https://fleetum.it/sitemap.xml` raggiungibile.

## Logs

- [ ] Nessun errore critico backend.
- [ ] Nessun errore Caddy/proxy.
- [ ] Nessun errore migration.
- [ ] Nessun secret stampato nei log.
- [ ] Email queue senza errori critici.
- [ ] Stripe webhook senza errori critici.

## Stripe e billing

- [ ] Webhook Stripe configurato.
- [ ] segreto webhook Stripe presente solo in env sicuro (nome variabile documentato nel file env example).
- [ ] Checkout/sessioni testate se impattate.
- [ ] Licenza/subscription persistita correttamente.
- [ ] Audit log evento billing creato.

## DNS/HTTPS

- [ ] `fleetum.it` punta al server corretto.
- [ ] `www.fleetum.it` corretto.
- [ ] `api.fleetum.it` corretto.
- [ ] `platform.fleetum.it` corretto.
- [ ] TLS valido.
- [ ] HSTS valutato prima di includeSubDomains/preload.

## Rollback

- [ ] Commit precedente noto.
- [ ] Immagine/container precedente disponibile o deploy precedente riproducibile.
- [ ] Backup DB disponibile.
- [ ] Procedura rollback documentata.
- [ ] Owner decisionale disponibile.

## Dopo deploy

- [ ] Login tenant testato.
- [ ] Login Platform + OTP testato da IP autorizzato.
- [ ] Booking noleggi smoke test.
- [ ] Contratti/PDF smoke test se impattati.
- [ ] Demo form/email smoke test se impattato.
- [ ] Monitoraggio per almeno 15-30 minuti.
