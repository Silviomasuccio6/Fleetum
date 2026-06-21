# Platform Console: Recupero Password con OTP

Stato: implementato
Aggiornato: 2026-06-21

## Obiettivo

Permettere al founder autorizzato di recuperare la password della Platform Console senza editare a mano `backend.env` e senza salvare password in chiaro.

## UI

1. Da `platform.fleetum.it`, aprire `Password dimenticata?`.
2. Inserire l'email amministratore configurata in `PLATFORM_ADMIN_EMAIL`.
3. Ricevere un OTP Resend a 6 cifre.
4. Inserire OTP, nuova password di almeno 16 caratteri e conferma.
5. Tornare al login Platform con le nuove credenziali.

La pagina e `#/password-recovery`. Il routing usa HashRouter per compatibilita con hosting statico.

## API

| Metodo | Endpoint | Auth | Scopo |
|---|---|---|---|
| POST | `/platform-api/auth/password-reset/request` | IP allowlist | richiede OTP per email |
| POST | `/platform-api/auth/password-reset/confirm` | IP allowlist | verifica OTP e salva nuovo hash bcrypt |

Request OTP:

```json
{ "email": "admin@example.com" }
```

Conferma:

```json
{
  "email": "admin@example.com",
  "otp": "123456",
  "newPassword": "almeno-sedici-caratteri"
}
```

Risposta della richiesta OTP: sempre generica. Questo evita di rivelare se un indirizzo e autorizzato.

## Controlli di sicurezza

- L'IP allowlist Platform protegge entrambe le route prima del controller.
- OTP diverso dal login: chiave `password-reset:<email>`; non sovrascrive l'OTP di accesso.
- OTP hash SHA-256 nel DB, non il codice in chiaro.
- Scadenza OTP: 8 minuti.
- OTP monouso: eliminato dopo successo, scadenza o troppi tentativi.
- Massimo 5 tentativi sul singolo OTP.
- Massimo 3 email OTP inviate per IP/email in un'ora; la quarta richiesta blocca per un'ora.
- Password salvata con bcrypt cost 12.
- I reset completati e bloccati notificano `PLATFORM_ALERT_EMAILS` se configurato.

## Persistenza

`PlatformAdminCredential` salva l'override della password Platform:

- `email`
- `passwordHash`
- `passwordChangedAt`
- `lastResetAt`

Prima del primo reset, il login usa `PLATFORM_ADMIN_PASSWORD_HASH` come fallback bootstrap. Dopo un reset, il database diventa la fonte della password. Non rimuovere comunque l'hash ambiente: serve per bootstrap e recovery d'emergenza controllato.

## Deploy

La migration `20260621120000_platform_admin_credentials` deve essere applicata dal deploy automatico con `prisma migrate deploy` prima del riavvio backend.

Verifica post-deploy:

```bash
cd /opt/fleetum/app

docker compose --env-file /opt/fleetum/env/compose.env -f docker-compose.prod.yml ps
docker logs fleetum_backend --tail=100
curl -i https://api.fleetum.it/api/ready
```

## Emergenza

Se Resend non invia email, non modificare il database manualmente. Verificare prima `RESEND_API_KEY`, `RESEND_FROM`, dominio verificato Resend e log backend. L'hash bootstrap in `backend.env` resta disponibile solo per una procedura amministrativa controllata e non va mai condiviso.
