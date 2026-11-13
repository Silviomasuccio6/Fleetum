-- Persist short-lived OAuth authorization state so callbacks can be bound to the
-- initiating browser and consumed atomically across backend instances.
CREATE TABLE "OauthFlow" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserBindingHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "returnTo" TEXT,
    "codeVerifier" TEXT,
    "oidcNonce" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OauthFlow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OauthFlow_provider_check" CHECK ("provider" IN ('google', 'apple')),
    CONSTRAINT "OauthFlow_intent_check" CHECK ("intent" IN ('login', 'signup'))
);

CREATE UNIQUE INDEX "OauthFlow_stateHash_key" ON "OauthFlow"("stateHash");
CREATE INDEX "OauthFlow_expiresAt_consumedAt_idx" ON "OauthFlow"("expiresAt", "consumedAt");

-- Rollback: DROP TABLE "OauthFlow". This invalidates only OAuth flows still in
-- progress; it does not affect users, credentials, or established sessions.
