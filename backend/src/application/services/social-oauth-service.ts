import { createHash, createPublicKey, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../infrastructure/database/prisma/client.js";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

export type SocialProvider = "google" | "apple";

export type OAuthIntent = "login" | "signup";

type SocialIdentity = {
  provider: SocialProvider;
  email: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
  fullName?: string;
};

type AppleJwk = {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
};

type AppleJwksResponse = {
  keys: AppleJwk[];
};

type AppleIdTokenPayload = jwt.JwtPayload & {
  email?: string;
  email_verified?: string | boolean;
  nonce?: string;
};

type GoogleTokenInfo = {
  email?: string;
  email_verified?: string | boolean;
  aud?: string;
  iss?: string;
  nonce?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
};

type StatePayload = {
  provider: SocialProvider;
  intent: OAuthIntent;
  returnTo?: string;
  codeVerifier?: string;
  oidcNonce: string;
};

export type OAuthFlowCreateInput = {
  stateHash: string;
  browserBindingHash: string;
  provider: SocialProvider;
  intent: OAuthIntent;
  returnTo?: string;
  codeVerifier: string | null;
  oidcNonce: string | null;
  expiresAt: Date;
};

type OAuthFlowConsumeInput = {
  stateHash: string;
  browserBindingHash: string;
  provider: SocialProvider;
  now: Date;
};

type OAuthFlowConsumeResult =
  | { status: "missing" | "provider_mismatch" | "browser_mismatch" | "expired" | "replayed" | "intent_invalid" }
  | { status: "consumed"; flow: OAuthFlowCreateInput };

export interface OAuthFlowStore {
  create(input: OAuthFlowCreateInput): Promise<void>;
  consume(input: OAuthFlowConsumeInput): Promise<OAuthFlowConsumeResult>;
  purgeExpired(now: Date): Promise<void>;
}

export class PrismaOAuthFlowStore implements OAuthFlowStore {
  async create(input: OAuthFlowCreateInput) {
    await prisma.oauthFlow.create({ data: input });
  }

  async purgeExpired(now: Date) {
    await prisma.oauthFlow.deleteMany({ where: { expiresAt: { lte: now } } });
  }

  async consume(input: OAuthFlowConsumeInput): Promise<OAuthFlowConsumeResult> {
    return prisma.$transaction(async (tx) => {
      const flow = await tx.oauthFlow.findUnique({ where: { stateHash: input.stateHash } });
      if (!flow) return { status: "missing" };
      if (flow.provider !== input.provider) return { status: "provider_mismatch" };
      if (flow.browserBindingHash !== input.browserBindingHash) return { status: "browser_mismatch" };
      if (flow.expiresAt <= input.now) return { status: "expired" };
      if (flow.consumedAt) return { status: "replayed" };
      if (flow.intent !== "login" && flow.intent !== "signup") return { status: "intent_invalid" };

      const consumed = await tx.oauthFlow.updateMany({
        where: {
          id: flow.id,
          provider: input.provider,
          browserBindingHash: input.browserBindingHash,
          consumedAt: null,
          expiresAt: { gt: input.now }
        },
        data: {
          consumedAt: input.now,
          codeVerifier: null,
          oidcNonce: null
        }
      });
      if (consumed.count !== 1) return { status: "replayed" };

      return {
        status: "consumed",
        flow: {
          stateHash: flow.stateHash,
          browserBindingHash: flow.browserBindingHash,
          provider: flow.provider,
          intent: flow.intent,
          returnTo: flow.returnTo ?? undefined,
          codeVerifier: flow.codeVerifier,
          oidcNonce: flow.oidcNonce,
          expiresAt: flow.expiresAt
        }
      };
    });
  }
}

const OAUTH_TIMEOUT_MS = 12000;
const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

const randomToken = () => randomBytes(32).toString("base64url");
const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const sha256Base64Url = (value: string) => createHash("sha256").update(value, "utf8").digest("base64url");

export class SocialOAuthService {
  private appleJwksCache: { keys: AppleJwk[]; expiresAt: number } | null = null;

  constructor(private readonly oauthFlowStore: OAuthFlowStore = new PrismaOAuthFlowStore()) {}

  async createState(provider: SocialProvider, intent: OAuthIntent = "login", returnTo?: string) {
    this.assertProviderConfigured(provider);
    const state = randomToken();
    const browserBinding = randomToken();
    const codeVerifier = provider === "google" ? randomToken() : null;
    const oidcNonce = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OAUTH_FLOW_TTL_MS);

    await this.oauthFlowStore.purgeExpired(now);
    await this.oauthFlowStore.create({
      stateHash: sha256Hex(state),
      browserBindingHash: sha256Hex(browserBinding),
      provider,
      intent,
      returnTo,
      codeVerifier,
      oidcNonce,
      expiresAt
    });

    return {
      state,
      browserBinding,
      expiresAt,
      codeChallenge: codeVerifier ? sha256Base64Url(codeVerifier) : undefined,
      oidcNonce
    };
  }

  async consumeState(provider: SocialProvider, state: string, browserBinding: string | undefined): Promise<StatePayload> {
    if (!state) throw new AppError("State OAuth mancante", 400, "OAUTH_STATE_MISSING");
    if (state.length > 256) throw new AppError("State OAuth non valido", 400, "OAUTH_STATE_INVALID");
    if (!browserBinding || browserBinding.length > 256) {
      throw new AppError("Callback OAuth non associato a questo browser", 400, "OAUTH_BROWSER_MISMATCH");
    }

    const result = await this.oauthFlowStore.consume({
      stateHash: sha256Hex(state),
      browserBindingHash: sha256Hex(browserBinding),
      provider,
      now: new Date()
    });

    if (result.status === "browser_mismatch") {
      throw new AppError("Callback OAuth non associato a questo browser", 400, "OAUTH_BROWSER_MISMATCH");
    }
    if (result.status === "expired") {
      throw new AppError("State OAuth scaduto", 400, "OAUTH_STATE_EXPIRED");
    }
    if (result.status === "replayed") {
      throw new AppError("State OAuth già utilizzato", 400, "OAUTH_STATE_REPLAYED");
    }
    if (result.status === "intent_invalid") {
      throw new AppError("Intent OAuth non valido", 400, "OAUTH_INTENT_INVALID");
    }
    if (result.status !== "consumed") {
      throw new AppError("State OAuth non valido", 400, "OAUTH_STATE_INVALID");
    }
    if (result.flow.provider !== provider) {
      throw new AppError("State OAuth non valido", 400, "OAUTH_STATE_INVALID");
    }
    if (result.flow.intent !== "login" && result.flow.intent !== "signup") {
      throw new AppError("Intent OAuth non valido", 400, "OAUTH_INTENT_INVALID");
    }
    if (!result.flow.oidcNonce) {
      throw new AppError("Correlazione OAuth non valida", 400, "OAUTH_STATE_INVALID");
    }

    return {
      provider,
      intent: result.flow.intent,
      returnTo: result.flow.returnTo,
      codeVerifier: result.flow.codeVerifier ?? undefined,
      oidcNonce: result.flow.oidcNonce
    };
  }

  getAuthorizationUrl(
    provider: SocialProvider,
    state: string,
    security: { codeChallenge?: string; oidcNonce: string }
  ) {
    if (provider === "google") {
      this.assertGoogleConfigured();
      if (!security.codeChallenge) {
        throw new AppError("PKCE Google non disponibile", 500, "OAUTH_PKCE_MISSING");
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
      url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", security.oidcNonce);
      url.searchParams.set("code_challenge", security.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    }

    this.assertAppleConfigured();
    const url = new URL("https://appleid.apple.com/auth/authorize");
    url.searchParams.set("client_id", env.APPLE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", env.APPLE_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    // Apple requires form_post whenever name/email scopes are requested.
    url.searchParams.set("response_mode", "form_post");
    url.searchParams.set("scope", "name email");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", security.oidcNonce);
    return url.toString();
  }

  async exchangeCode(
    provider: SocialProvider,
    code: string,
    security: { codeVerifier?: string; oidcNonce: string }
  ): Promise<SocialIdentity> {
    if (!code) throw new AppError("Codice OAuth mancante", 400, "OAUTH_CODE_MISSING");
    return provider === "google"
      ? this.exchangeGoogle(code, security.codeVerifier, security.oidcNonce)
      : this.exchangeApple(code, security.oidcNonce);
  }

  private assertGoogleConfigured() {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError("OAuth Google non configurato sul backend", 503, "GOOGLE_OAUTH_NOT_CONFIGURED");
    }
  }

  private assertAppleConfigured() {
    if (!env.APPLE_CLIENT_ID || !env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) {
      throw new AppError("OAuth Apple non configurato sul backend", 503, "APPLE_OAUTH_NOT_CONFIGURED");
    }
  }

  private assertProviderConfigured(provider: SocialProvider) {
    if (provider === "google") {
      this.assertGoogleConfigured();
      return;
    }
    this.assertAppleConfigured();
  }

  private async exchangeGoogle(code: string, codeVerifier: string | undefined, oidcNonce: string): Promise<SocialIdentity> {
    this.assertGoogleConfigured();
    if (!codeVerifier) throw new AppError("PKCE Google mancante", 400, "OAUTH_PKCE_MISSING");

    const tokenResponse = await this.fetchJson<{ id_token?: string; error?: string; error_description?: string }>(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID!,
          client_secret: env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: env.GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code",
          code_verifier: codeVerifier
        }).toString()
      }
    );

    if (!tokenResponse.id_token) {
      throw new AppError(tokenResponse.error_description ?? "Token Google non ricevuto", 401, "GOOGLE_TOKEN_EXCHANGE_FAILED");
    }

    const tokenInfo = await this.fetchJson<GoogleTokenInfo>(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenResponse.id_token)}`
    );

    const issuerOk = tokenInfo.iss === "accounts.google.com" || tokenInfo.iss === "https://accounts.google.com";
    if (!issuerOk || tokenInfo.aud !== env.GOOGLE_CLIENT_ID) {
      throw new AppError("Token Google non valido", 401, "GOOGLE_TOKEN_INVALID");
    }
    if (tokenInfo.nonce !== oidcNonce) {
      throw new AppError("Nonce Google non valido", 401, "GOOGLE_TOKEN_NONCE_INVALID");
    }

    const email = tokenInfo.email?.toLowerCase().trim();
    if (!email) throw new AppError("Email Google non disponibile", 401, "GOOGLE_EMAIL_MISSING");

    return {
      provider: "google",
      email,
      emailVerified: tokenInfo.email_verified === true || tokenInfo.email_verified === "true",
      givenName: tokenInfo.given_name?.trim(),
      familyName: tokenInfo.family_name?.trim(),
      fullName: tokenInfo.name?.trim()
    };
  }

  private async exchangeApple(code: string, oidcNonce: string): Promise<SocialIdentity> {
    this.assertAppleConfigured();

    const clientSecret = this.createAppleClientSecret();

    const tokenResponse = await this.fetchJson<{ id_token?: string; error?: string; error_description?: string }>(
      "https://appleid.apple.com/auth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: env.APPLE_REDIRECT_URI,
          client_id: env.APPLE_CLIENT_ID!,
          client_secret: clientSecret
        }).toString()
      }
    );

    if (!tokenResponse.id_token) {
      throw new AppError(tokenResponse.error_description ?? "Token Apple non ricevuto", 401, "APPLE_TOKEN_EXCHANGE_FAILED");
    }

    const payload = await this.verifyAppleIdToken(tokenResponse.id_token);
    if (payload.nonce !== oidcNonce) {
      throw new AppError("Nonce Apple non valido", 401, "APPLE_TOKEN_NONCE_INVALID");
    }
    const email = payload.email?.toLowerCase().trim();
    if (!email) throw new AppError("Email Apple non disponibile", 401, "APPLE_EMAIL_MISSING");

    return {
      provider: "apple",
      email,
      emailVerified: payload.email_verified === true || payload.email_verified === "true"
    };
  }

  private createAppleClientSecret() {
    const privateKey = env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n").trim();
    return jwt.sign({}, privateKey, {
      algorithm: "ES256",
      issuer: env.APPLE_TEAM_ID,
      audience: "https://appleid.apple.com",
      subject: env.APPLE_CLIENT_ID,
      expiresIn: "180d",
      keyid: env.APPLE_KEY_ID
    });
  }

  private async verifyAppleIdToken(idToken: string): Promise<AppleIdTokenPayload> {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded !== "object" || !("header" in decoded)) {
      throw new AppError("Apple id_token non decodificabile", 401, "APPLE_ID_TOKEN_INVALID");
    }

    const kid = typeof decoded.header?.kid === "string" ? decoded.header.kid : undefined;
    if (!kid) throw new AppError("Apple id_token senza kid", 401, "APPLE_ID_TOKEN_INVALID");

    const jwk = await this.getAppleJwkByKid(kid);
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });

    return jwt.verify(idToken, publicKey, {
      algorithms: ["RS256"],
      issuer: "https://appleid.apple.com",
      audience: env.APPLE_CLIENT_ID
    }) as AppleIdTokenPayload;
  }

  private async getAppleJwkByKid(kid: string): Promise<AppleJwk> {
    const keys = await this.getAppleJwks();
    const key = keys.find((item) => item.kid === kid);
    if (!key) throw new AppError("Chiave Apple non trovata", 401, "APPLE_KEY_NOT_FOUND");
    return key;
  }

  private async getAppleJwks(): Promise<AppleJwk[]> {
    const now = Date.now();
    if (this.appleJwksCache && this.appleJwksCache.expiresAt > now) {
      return this.appleJwksCache.keys;
    }

    const response = await this.fetchJson<AppleJwksResponse>("https://appleid.apple.com/auth/keys");
    if (!response.keys?.length) {
      throw new AppError("Impossibile recuperare chiavi Apple", 503, "APPLE_KEYS_UNAVAILABLE");
    }

    this.appleJwksCache = {
      keys: response.keys,
      expiresAt: now + 60 * 60 * 1000
    };

    return response.keys;
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const data = (await response.json().catch(() => ({}))) as T & { message?: string; error_description?: string };
      if (!response.ok) {
        throw new AppError(
          data.error_description || data.message || `OAuth provider error (${response.status})`,
          502,
          "OAUTH_PROVIDER_ERROR"
        );
      }
      return data as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new AppError("Timeout comunicazione OAuth provider", 504, "OAUTH_TIMEOUT");
      }
      throw new AppError("Errore comunicazione OAuth provider", 502, "OAUTH_NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }
}
