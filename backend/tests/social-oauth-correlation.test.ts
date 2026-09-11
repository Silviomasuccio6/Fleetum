import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  OAuthFlowCreateInput,
  OAuthFlowStore,
  SocialOAuthService
} from "../src/application/services/social-oauth-service.js";
import { AuthController } from "../src/interfaces/http/controllers/auth-controller.js";
import { authRateLimit } from "../src/interfaces/http/middlewares/auth-rate-limit.js";
import { authRoutes } from "../src/interfaces/http/routes/auth-routes.js";
import {
  getOAuthCorrelationCookieName,
  setOAuthCorrelationCookie
} from "../src/interfaces/http/utils/auth-cookies.js";
import { env } from "../src/shared/config/env.js";

const originalOAuthConfig = {
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  appleClientId: env.APPLE_CLIENT_ID,
  appleTeamId: env.APPLE_TEAM_ID,
  appleKeyId: env.APPLE_KEY_ID,
  applePrivateKey: env.APPLE_PRIVATE_KEY
};

Object.assign(env as any, {
  GOOGLE_CLIENT_ID: "google-client-for-correlation-tests",
  GOOGLE_CLIENT_SECRET: "google-secret-for-correlation-tests",
  APPLE_CLIENT_ID: "apple-client-for-correlation-tests",
  APPLE_TEAM_ID: "apple-team-for-correlation-tests",
  APPLE_KEY_ID: "apple-key-for-correlation-tests",
  APPLE_PRIVATE_KEY: "apple-private-key-for-correlation-tests"
});

after(() => {
  Object.assign(env as any, {
    GOOGLE_CLIENT_ID: originalOAuthConfig.googleClientId,
    GOOGLE_CLIENT_SECRET: originalOAuthConfig.googleClientSecret,
    APPLE_CLIENT_ID: originalOAuthConfig.appleClientId,
    APPLE_TEAM_ID: originalOAuthConfig.appleTeamId,
    APPLE_KEY_ID: originalOAuthConfig.appleKeyId,
    APPLE_PRIVATE_KEY: originalOAuthConfig.applePrivateKey
  });
});

class MemoryOAuthFlowStore implements OAuthFlowStore {
  private readonly flows = new Map<string, OAuthFlowCreateInput & { consumedAt: Date | null }>();

  async create(input: OAuthFlowCreateInput) {
    this.flows.set(input.stateHash, { ...input, consumedAt: null });
  }

  async purgeExpired(now: Date) {
    for (const [key, flow] of this.flows) {
      if (flow.expiresAt <= now) this.flows.delete(key);
    }
  }

  async consume(input: {
    stateHash: string;
    browserBindingHash: string;
    provider: "google" | "apple";
    now: Date;
  }) {
    const flow = this.flows.get(input.stateHash);
    if (!flow) return { status: "missing" as const };
    if (flow.provider !== input.provider) return { status: "provider_mismatch" as const };
    if (flow.browserBindingHash !== input.browserBindingHash) return { status: "browser_mismatch" as const };
    if (flow.expiresAt <= input.now) return { status: "expired" as const };
    if (flow.consumedAt) return { status: "replayed" as const };

    // Marking the flow before yielding models the compare-and-set used by PostgreSQL.
    flow.consumedAt = input.now;
    const consumed = { ...flow };
    flow.codeVerifier = null;
    flow.oidcNonce = null;
    return { status: "consumed" as const, flow: consumed };
  }
}

const responseRecorder = () => {
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
  const redirects: string[] = [];
  return {
    cookies,
    cleared,
    redirects,
    response: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
      clearCookie: (name: string, options: Record<string, unknown>) => {
        cleared.push({ name, options });
      },
      redirect: (target: string) => {
        redirects.push(target);
      }
    } as any
  };
};

const buildController = (service: SocialOAuthService, onLogin: () => void) =>
  new AuthController(
    {} as any,
    {
      executeTrustedEmail: async () => {
        onLogin();
        return {
          token: "access-token-for-test",
          refreshToken: "refresh-token-for-test",
          refreshExpiresAt: "2026-10-01T00:00:00.000Z",
          user: { id: "user_oauth_test", tenantId: "tenant_oauth_test" }
        };
      }
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    service,
    {} as any
  );

const callbackRequest = (state: string, browserBinding: string, cookieState = state) => ({
  query: { code: "provider-code-for-test", state },
  body: undefined,
  headers: {
    cookie: `${getOAuthCorrelationCookieName("google", cookieState)}=${encodeURIComponent(browserBinding)}`,
    "user-agent": "Fleetum OAuth correlation test"
  },
  ip: "127.0.0.1"
});

test("OAuth callback is bound to the browser that initiated it and state is single-use", async () => {
  const store = new MemoryOAuthFlowStore();
  const service = new SocialOAuthService(store);
  (service as any).exchangeCode = async () => ({
    provider: "google",
    email: "oauth.user@example.test",
    emailVerified: true
  });

  const browserA = await service.createState("google", "login", "/bookings");
  const browserB = await service.createState("google", "login", "/dashboard");
  let loginCount = 0;
  const controller = buildController(service, () => {
    loginCount += 1;
  });

  const wrongBrowserResponse = responseRecorder();
  await controller.googleAuthCallback(
    callbackRequest(browserA.state, browserB.browserBinding, browserB.state) as any,
    wrongBrowserResponse.response
  );
  assert.equal(loginCount, 0);
  assert.equal(wrongBrowserResponse.cookies.length, 0);
  assert.equal(wrongBrowserResponse.redirects.length, 1);
  assert.equal(wrongBrowserResponse.cleared[0]?.name, getOAuthCorrelationCookieName("google", browserA.state));
  assert.notEqual(wrongBrowserResponse.cleared[0]?.name, getOAuthCorrelationCookieName("google", browserB.state));
  assert.match(decodeURIComponent(new URL(wrongBrowserResponse.redirects[0]).hash), /browser/i);

  const rightBrowserResponse = responseRecorder();
  await controller.googleAuthCallback(
    callbackRequest(browserA.state, browserA.browserBinding) as any,
    rightBrowserResponse.response
  );
  assert.equal(loginCount, 1);
  assert.equal(rightBrowserResponse.cookies.length, 3);
  assert.equal(rightBrowserResponse.redirects.length, 1);

  const replayResponse = responseRecorder();
  await controller.googleAuthCallback(
    callbackRequest(browserA.state, browserA.browserBinding) as any,
    replayResponse.response
  );
  assert.equal(loginCount, 1);
  assert.equal(replayResponse.cookies.length, 0);
  const replayError = new URLSearchParams(new URL(replayResponse.redirects[0]).hash.slice(1)).get("error");
  assert.match(replayError ?? "", /già utilizzato|replay/i);
});

test("parallel OAuth starts for one provider keep independent browser cookies", async () => {
  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  (service as any).exchangeCode = async () => ({
    provider: "google",
    email: "parallel.oauth.user@example.test",
    emailVerified: true
  });
  const first = await service.createState("google", "login");
  const second = await service.createState("google", "login");
  const starts = responseRecorder();
  setOAuthCorrelationCookie(starts.response, "google", first.state, first.browserBinding, first.expiresAt);
  setOAuthCorrelationCookie(starts.response, "google", second.state, second.browserBinding, second.expiresAt);
  assert.notEqual(starts.cookies[0].name, starts.cookies[1].name);

  let loginCount = 0;
  const controller = buildController(service, () => {
    loginCount += 1;
  });
  const firstResponse = responseRecorder();
  await controller.googleAuthCallback(callbackRequest(first.state, first.browserBinding) as any, firstResponse.response);
  const secondResponse = responseRecorder();
  await controller.googleAuthCallback(callbackRequest(second.state, second.browserBinding) as any, secondResponse.response);

  assert.equal(loginCount, 2);
  assert.equal(firstResponse.cleared[0]?.name, getOAuthCorrelationCookieName("google", first.state));
  assert.equal(secondResponse.cleared[0]?.name, getOAuthCorrelationCookieName("google", second.state));
});

test("Apple form_post callback carries and consumes the browser correlation cookie", async () => {
  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  (service as any).exchangeCode = async () => ({
    provider: "apple",
    email: "apple.oauth.user@example.test",
    emailVerified: true
  });
  const flow = await service.createState("apple", "login", "/dashboard");
  let loginCount = 0;
  const controller = buildController(service, () => {
    loginCount += 1;
  });
  const recorder = responseRecorder();

  await controller.appleAuthCallback(
    {
      query: {},
      body: { code: "apple-provider-code", state: flow.state },
      headers: {
        cookie: `${getOAuthCorrelationCookieName("apple", flow.state)}=${encodeURIComponent(flow.browserBinding)}`,
        "user-agent": "Fleetum Apple form_post test"
      },
      ip: "127.0.0.1"
    } as any,
    recorder.response
  );

  assert.equal(loginCount, 1);
  assert.equal(recorder.cookies.length, 3);
  assert.equal(recorder.cleared[0]?.name, getOAuthCorrelationCookieName("apple", flow.state));
});

test("an unconfigured provider is rejected before an OAuth flow is persisted", async (t) => {
  let created = 0;
  const store = new MemoryOAuthFlowStore();
  const originalCreate = store.create.bind(store);
  store.create = async (input) => {
    created += 1;
    await originalCreate(input);
  };
  const originalClientId = env.GOOGLE_CLIENT_ID;
  const originalClientSecret = env.GOOGLE_CLIENT_SECRET;
  (env as any).GOOGLE_CLIENT_ID = undefined;
  (env as any).GOOGLE_CLIENT_SECRET = undefined;
  t.after(() => {
    (env as any).GOOGLE_CLIENT_ID = originalClientId;
    (env as any).GOOGLE_CLIENT_SECRET = originalClientSecret;
  });

  const service = new SocialOAuthService(store);
  await assert.rejects(
    () => service.createState("google", "login"),
    (error: any) => error?.code === "GOOGLE_OAUTH_NOT_CONFIGURED"
  );
  assert.equal(created, 0);
});

test("OAuth flow preserves a validated intent and rejects a provider mismatch without consuming it", async () => {
  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  const flow = await service.createState("google", "signup", "/activate");

  await assert.rejects(
    () => service.consumeState("apple", flow.state, flow.browserBinding),
    (error: any) => error?.code === "OAUTH_STATE_INVALID"
  );

  const consumed = await service.consumeState("google", flow.state, flow.browserBinding);
  assert.equal(consumed.intent, "signup");
  assert.equal(consumed.returnTo, "/activate");
  assert.ok(consumed.codeVerifier);
  assert.ok(consumed.oidcNonce);
});

test("two concurrent callbacks can consume an OAuth state only once", async () => {
  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  const flow = await service.createState("google", "login");

  const results = await Promise.allSettled([
    service.consumeState("google", flow.state, flow.browserBinding),
    service.consumeState("google", flow.state, flow.browserBinding)
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const rejection = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejection.reason?.code, "OAUTH_STATE_REPLAYED");
});

test("Google authorization uses PKCE S256 and an OIDC nonce, while Apple uses its documented nonce flow", async (t) => {
  const original = {
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    appleClientId: env.APPLE_CLIENT_ID,
    appleTeamId: env.APPLE_TEAM_ID,
    appleKeyId: env.APPLE_KEY_ID,
    applePrivateKey: env.APPLE_PRIVATE_KEY
  };
  Object.assign(env as any, {
    GOOGLE_CLIENT_ID: "google-client-for-test",
    GOOGLE_CLIENT_SECRET: "google-secret-for-test",
    APPLE_CLIENT_ID: "apple-client-for-test",
    APPLE_TEAM_ID: "apple-team-for-test",
    APPLE_KEY_ID: "apple-key-for-test",
    APPLE_PRIVATE_KEY: "apple-private-key-for-test"
  });
  t.after(() => {
    Object.assign(env as any, {
      GOOGLE_CLIENT_ID: original.googleClientId,
      GOOGLE_CLIENT_SECRET: original.googleClientSecret,
      APPLE_CLIENT_ID: original.appleClientId,
      APPLE_TEAM_ID: original.appleTeamId,
      APPLE_KEY_ID: original.appleKeyId,
      APPLE_PRIVATE_KEY: original.applePrivateKey
    });
  });

  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  const google = await service.createState("google", "login");
  const googleUrl = new URL(service.getAuthorizationUrl("google", google.state, google));
  assert.equal(googleUrl.searchParams.get("state"), google.state);
  assert.equal(googleUrl.searchParams.get("nonce"), google.oidcNonce);
  assert.equal(googleUrl.searchParams.get("code_challenge"), google.codeChallenge);
  assert.equal(googleUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(googleUrl.searchParams.has("code_verifier"), false);

  const apple = await service.createState("apple", "login");
  const appleUrl = new URL(service.getAuthorizationUrl("apple", apple.state, apple));
  assert.equal(appleUrl.searchParams.get("state"), apple.state);
  assert.equal(appleUrl.searchParams.get("nonce"), apple.oidcNonce);
  assert.equal(appleUrl.searchParams.get("response_mode"), "form_post");
  assert.equal(appleUrl.searchParams.has("code_challenge"), false);
  assert.equal(appleUrl.searchParams.has("code_challenge_method"), false);
});

test("OAuth correlation cookies are scoped, expiring, and use provider-compatible security attributes", (t) => {
  const originalNodeEnv = env.NODE_ENV;
  t.after(() => {
    (env as any).NODE_ENV = originalNodeEnv;
  });

  const expiresAt = new Date("2026-09-10T12:10:00.000Z");
  const cookieState = "state-for-cookie-options-test";
  (env as any).NODE_ENV = "test";
  const testResponse = responseRecorder();
  setOAuthCorrelationCookie(testResponse.response, "google", cookieState, "binding-for-test", expiresAt);
  assert.deepEqual(testResponse.cookies[0], {
    name: getOAuthCorrelationCookieName("google", cookieState),
    value: "binding-for-test",
    options: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/api/auth/google/callback",
      expires: expiresAt
    }
  });

  const appleTestResponse = responseRecorder();
  setOAuthCorrelationCookie(appleTestResponse.response, "apple", cookieState, "binding-for-test", expiresAt);
  assert.equal(appleTestResponse.cookies[0].options.secure, true);
  assert.equal(appleTestResponse.cookies[0].options.sameSite, "none");

  (env as any).NODE_ENV = "production";
  const productionResponse = responseRecorder();
  setOAuthCorrelationCookie(productionResponse.response, "apple", cookieState, "binding-for-test", expiresAt);
  assert.equal(productionResponse.cookies[0].options.secure, true);
  assert.equal(productionResponse.cookies[0].options.httpOnly, true);
  assert.equal(productionResponse.cookies[0].options.sameSite, "none");
  assert.equal(productionResponse.cookies[0].options.path, "/api/auth/apple/callback");
  assert.equal(productionResponse.cookies[0].options.expires, expiresAt);
});

test("Google token exchange sends the persisted verifier and rejects a mismatched nonce", async (t) => {
  const original = {
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET
  };
  Object.assign(env as any, {
    GOOGLE_CLIENT_ID: "google-client-for-test",
    GOOGLE_CLIENT_SECRET: "google-secret-for-test"
  });
  t.after(() => {
    Object.assign(env as any, {
      GOOGLE_CLIENT_ID: original.googleClientId,
      GOOGLE_CLIENT_SECRET: original.googleClientSecret
    });
  });

  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  (service as any).fetchJson = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") return { id_token: "id-token-for-test" };
    return {
      iss: "https://accounts.google.com",
      aud: "google-client-for-test",
      nonce: "wrong-nonce",
      email: "oauth.user@example.test",
      email_verified: true
    };
  };

  await assert.rejects(
    () =>
      service.exchangeCode("google", "authorization-code-for-test", {
        codeVerifier: "pkce-verifier-for-test",
        oidcNonce: "expected-nonce"
      }),
    (error: any) => error?.code === "GOOGLE_TOKEN_NONCE_INVALID"
  );

  const tokenBody = new URLSearchParams(String(requests[0].init?.body));
  assert.equal(tokenBody.get("code_verifier"), "pkce-verifier-for-test");
});

test("OAuth start routes reuse the persistent authentication rate limiter", () => {
  const noop = async () => undefined;
  const controller = new Proxy(
    {},
    {
      get: () => noop
    }
  ) as AuthController;
  const router = authRoutes(controller) as any;

  for (const path of ["/google", "/apple"]) {
    const layer = router.stack.find((entry: any) => entry.route?.path === path);
    assert.ok(layer, `Missing OAuth start route ${path}`);
    assert.equal(layer.route.stack[0].handle, authRateLimit);
  }
});
