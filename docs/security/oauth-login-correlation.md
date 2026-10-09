# OAuth login correlation

Fleetum stores each Google or Apple authorization attempt in `OauthFlow` for ten minutes. The external `state` and the browser correlation cookie are random values; only their SHA-256 hashes are stored. A callback must match the provider, a valid `login` or `signup` intent, the unexpired state, and the HttpOnly cookie issued to the browser that started the flow. The cookie name includes a short hash of that state, so parallel attempts with the same provider do not overwrite or clear one another. Consumption uses a conditional database update, so only one concurrent callback can succeed. The verifier and nonce are cleared from the row when it is consumed.

The correlation cookie is scoped to the provider callback path and expires with the flow. Google uses `SameSite=Lax` and becomes `Secure` in production. Apple requests `response_mode=form_post`, required when `name email` scopes are present, and uses `SameSite=None; Secure` so the cross-site POST carries the browser binding. Apple web login therefore requires an HTTPS callback, including in test environments. No live provider setting is changed by this patch.

OAuth start routes reuse Fleetum's persistent authentication rate limiter. Callbacks are not charged against that start quota because a valid state is already random, expires quickly, and can be consumed once; the application's global request limit still applies. Provider configuration is checked before a row is created, so disabled providers cannot be used to grow the flow table.

Request logging masks OAuth `code`, `state` and `nonce` query parameters. Raw state, browser binding, verifier, authorization code and provider tokens must not appear in logs or audit details.

Google receives an RFC 7636 `S256` code challenge and the matching verifier is supplied only to its token endpoint. Google's current OpenID discovery metadata advertises `S256`. Both providers receive an OIDC nonce, which Fleetum compares with the verified ID-token claim. Apple's current OpenID discovery metadata does not advertise PKCE challenge methods, so no undocumented PKCE parameters are sent to Apple.

The migration adds one independent, short-lived table and does not change users, credentials, or established sessions. Rollback is `DROP TABLE "OauthFlow"`; active OAuth attempts will need to be restarted after rollback.

Provider references:

- [Google OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google PKCE S256 example](https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption)
- [Apple authorization request and form_post requirement](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server)
