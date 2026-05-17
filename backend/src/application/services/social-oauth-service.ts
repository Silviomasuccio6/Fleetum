import { createPublicKey, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

type SocialProvider = "google" | "apple";

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
};

type GoogleTokenInfo = {
  email?: string;
  email_verified?: string;
  aud?: string;
  iss?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
};

type StatePayload = {
  provider: SocialProvider;
  nonce: string;
  intent: OAuthIntent;
  returnTo?: string;
};

const OAUTH_TIMEOUT_MS = 12000;

export class SocialOAuthService {
  private appleJwksCache: { keys: AppleJwk[]; expiresAt: number } | null = null;

  createState(provider: SocialProvider, intent: OAuthIntent = "login", returnTo?: string) {
    return jwt.sign({ provider, nonce: randomUUID(), intent, returnTo } satisfies StatePayload, env.JWT_SECRET, {
      expiresIn: "10m"
    });
  }

  verifyState(provider: SocialProvider, state: string): StatePayload {
    if (!state) throw new AppError("State OAuth mancante", 400, "OAUTH_STATE_MISSING");
    const payload = jwt.verify(state, env.JWT_SECRET) as StatePayload;
    if (payload.provider !== provider) {
      throw new AppError("State OAuth non valido", 400, "OAUTH_STATE_INVALID");
    }
    if (payload.intent !== "login" && payload.intent !== "signup") {
      throw new AppError("Intent OAuth non valido", 400, "OAUTH_INTENT_INVALID");
    }
    return payload;
  }

  getAuthorizationUrl(provider: SocialProvider, state: string) {
    if (provider === "google") {
      this.assertGoogleConfigured();
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
      url.searchParams.set("redirect_uri", env.GOOGLE_REDIRECT_URI);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "select_account");
      return url.toString();
    }

    this.assertAppleConfigured();
    const url = new URL("https://appleid.apple.com/auth/authorize");
    url.searchParams.set("client_id", env.APPLE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", env.APPLE_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", "name email");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(provider: SocialProvider, code: string): Promise<SocialIdentity> {
    if (!code) throw new AppError("Codice OAuth mancante", 400, "OAUTH_CODE_MISSING");
    return provider === "google" ? this.exchangeGoogle(code) : this.exchangeApple(code);
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

  private async exchangeGoogle(code: string): Promise<SocialIdentity> {
    this.assertGoogleConfigured();

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
          grant_type: "authorization_code"
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

    const email = tokenInfo.email?.toLowerCase().trim();
    if (!email) throw new AppError("Email Google non disponibile", 401, "GOOGLE_EMAIL_MISSING");

    return {
      provider: "google",
      email,
      emailVerified: tokenInfo.email_verified === "true",
      givenName: tokenInfo.given_name?.trim(),
      familyName: tokenInfo.family_name?.trim(),
      fullName: tokenInfo.name?.trim()
    };
  }

  private async exchangeApple(code: string): Promise<SocialIdentity> {
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
