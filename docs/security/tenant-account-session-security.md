# Tenant account and session security

## Perimetro

Queste regole riguardano l'autenticazione degli utenti tenant. La Platform Console mantiene flusso, credenziali e controlli separati.

## Reset password

- Il reset viene emesso e consumato solo per utenti `ACTIVE` non cancellati.
- Gli utenti `INVITED` si attivano soltanto tramite invito; il reset non cambia mai lo stato dell'utente.
- Consumo del token, aggiornamento della password, invalidazione degli altri reset pendenti e revoca di tutte le refresh session avvengono nella stessa transazione.
- Reset, creazione sessione da password e rotazione refresh acquisiscono lo stesso lock sulla riga utente. Se un refresh termina prima, il reset revoca anche il successore; se il reset termina prima, il refresh precedente viene rifiutato.
- Un login password che ha verificato il vecchio hash non può creare una sessione dopo che il reset ha scritto il nuovo hash.

## Revoca e autorizzazione

- Logout, revoca amministrativa e reset diventano effettivi alla successiva richiesta tenant protetta: il middleware controlla ogni volta la sessione server-side senza cache.
- Logout e revoca di una singola sessione seguono l'eventuale catena di successori mentre mantengono il lock utente; un refresh concorrente non può lasciare attiva una nuova sessione sullo stesso dispositivo.
- Sospensione o cancellazione dell'utente diventano effettive alla successiva richiesta protetta e impediscono anche il refresh.
- Ruoli e permessi vengono riletti dal database a ogni richiesta protetta e a ogni rotazione, quindi un cambio ruolo si applica alla richiesta successiva.
- Un errore del database viene propagato come errore server; non viene trasformato in un falso logout.
- I token di accesso tenant devono contenere `sessionId`. I token già emessi senza questo campo vengono rifiutati e richiedono un nuovo login al rilascio.
- Signup, login password e refresh accettano soltanto `application/json`. Un form cross-site non può quindi sostituire i cookie della vittima con una sessione scelta dall'attaccante; il callback Apple `form_post` resta separato e compatibile con il formato provider.
- L'elenco sessioni mostra sempre tutte le sessioni attive prima della cronologia recente, così gli antenati revocati creati dalla rotazione non possono nascondere un dispositivo ancora revocabile.

## Rotazione refresh

- Una sola richiesta può consumare una refresh session: l'aggiornamento condizionale e la creazione del successore sono atomici.
- In caso di doppia richiesta concorrente, una sola riceve il successore; l'altra riceve `401`.
- Il riuso di un predecessore già ruotato genera `SECURITY_ALERT_REFRESH_REUSE` senza registrare token o hash e senza revocare automaticamente il successore. Questo evita logout casuali causati da retry legittimi; l'evento resta disponibile per una policy di risposta più aggressiva futura.

## Correlazione OAuth

La tabella additiva `OauthFlow` conserva hash di state e browser binding, provider, intent, scadenza, verifier PKCE Google e nonce OIDC. Il callback consuma il record una sola volta con un aggiornamento condizionale. I dettagli su cookie e compatibilità Apple sono in [oauth-login-correlation.md](oauth-login-correlation.md).

## Migrazione e rollback

La migrazione `20260910120000_oauth_flow_correlation` crea soltanto `OauthFlow`; non modifica utenti, password, prenotazioni o sessioni esistenti. Deve essere applicata prima del codice che crea i flussi OAuth. Il codice precedente ignora la tabella, quindi un rollback applicativo può lasciarla presente senza effetti.

Se è necessario rimuoverla, distribuire prima il codice precedente e poi eseguire `DROP TABLE "OauthFlow"`. L'operazione invalida soltanto i login OAuth ancora in corso, che dovranno essere riavviati. Eseguire il normale backup pre-migrazione e verificare migrazione e rollback su PostgreSQL temporaneo prima della produzione.
