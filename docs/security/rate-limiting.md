# Fleetum - Rate Limiting

## Obiettivo

Proteggere gli endpoint pubblici e sensibili del backend Fleetum da brute force, abuso API e traffico anomalo.

## Limiti applicati

| Scope | Limite | Finestra | Note |
| --- | ---: | ---: | --- |
| Generico | 100 richieste | 15 minuti | Applicato a tutte le route API e Platform API, esclusi healthcheck e webhook Stripe |
| Auth | 10 richieste | 15 minuti | Applicato agli endpoint pubblici sensibili di `/api/auth` (login, signup, reset, invite) per ridurre brute force |
| Registrazione | 3 richieste | 1 ora | Applicato a `/api/auth/signup` |
| Forgot password | 5 richieste | 1 ora | Applicato a `/api/auth/forgot-password` |
| Stripe webhook | Escluso | - | Stripe firma e invia webhook; non va bloccato da rate limit IP |

In `NODE_ENV=development` i limiter vengono bypassati per non ostacolare il lavoro locale.

## Risposta 429 standard

Tutti i limiter restituiscono:

```json
{
  "error": "Too many requests",
  "retryAfter": 123
}
```

Viene inoltre impostato l'header HTTP `Retry-After`.

## Store produzione

Attualmente `express-rate-limit` usa il memory store in-process.

Questo e' accettabile solo se:

- il backend gira con una singola istanza/processo;
- non ci sono piu' container backend in parallelo;
- non si usa clustering Node.js.

Il memory store **non e' adatto** a deployment multi-process/multi-instance, perche' ogni processo avrebbe contatori separati.

## Evoluzione consigliata con Redis-compatible store

Quando Fleetum passa a piu' istanze backend o piu' worker, aggiungere uno store condiviso:

- Redis managed;
- Upstash Redis;
- Valkey;
- Redis compatibile interno alla rete privata.

Dipendenze consigliate:

```bash
npm install -w backend rate-limit-redis redis
```

Esempio concettuale:

```ts
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";

const redisClient = createClient({ url: env.REDIS_URL });
await redisClient.connect();

const store = new RedisStore({
  sendCommand: (...args: string[]) => redisClient.sendCommand(args)
});
```

Poi passare `store` ai limiter creati da `express-rate-limit`.

## Mitigazione finche' non c'e' Redis

Finche' si usa il memory store:

- mantenere 1 solo container backend attivo;
- evitare `node cluster`;
- evitare scaling orizzontale;
- monitorare 429 e login failure;
- mettere eventuale rate limit aggiuntivo a livello reverse proxy/CDN se disponibile.

## Tracciabilita'

Il backend imposta `X-Request-ID` su ogni risposta tramite middleware request context. Anche le risposte 429 includono questo header per correlare eventi e log.
