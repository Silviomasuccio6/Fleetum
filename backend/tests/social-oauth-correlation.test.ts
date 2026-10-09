import assert from "node:assert/strict";
import express, { Express } from "express";
import test, { after } from "node:test";
import { createApp, createPlatformApp } from "../src/app.js";
import {
  OAuthFlowCreateInput,
  OAuthFlowStore,
  SocialOAuthService
} from "../src/application/services/social-oauth-service.js";
import { AuthController } from "../src/interfaces/http/controllers/auth-controller.js";
import { authRateLimit } from "../src/interfaces/http/middlewares/auth-rate-limit.js";
import { authRoutes } from "../src/interfaces/http/routes/auth-routes.js";
import { apiRouter } from "../src/interfaces/http/routes/index.js";
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

// Keep the real bootstrap middleware and form parser; replace only the mounted
// business router so the callback uses synthetic identities and no database.
const callbackApp = (controller: AuthController) => {
  const app = createApp();
  const mountedApi = (app as any)._router.stack.find((layer: any) => layer.handle === apiRouter);
  assert(mountedApi, "The test must exercise the real app bootstrap");
  const router = express.Router();
  router.use("/auth", authRoutes(controller));
  mountedApi.handle = router;
  return app;
};

const withHttpApp = async (app: Express, run: (baseUrl: string) => Promise<void>) => {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

const postAppleForm = (
  baseUrl: string,
  flow: { state: string; browserBinding: string },
  origin: string,
  options: { binding?: string | null; error?: string; path?: string; method?: string } = {}
) => fetch(`${baseUrl}${options.path ?? "/api/auth/apple/callback"}`, {
  method: options.method ?? "POST",
  redirect: "manual",
  headers: {
    Origin: origin,
    "Content-Type": "application/x-www-form-urlencoded",
    ...(options.binding === null ? {} : {
      Cookie: `${getOAuthCorrelationCookieName("apple", flow.state)}=${encodeURIComponent(options.binding ?? flow.browserBinding)}`
    })
  },
  ...((options.method ?? "POST") === "POST" ? {
    body: new URLSearchParams({ code: "synthetic-apple-code", state: flow.state, ...(options.error ? { error: options.error } : {}) })
  } : {})
});

const callbackError = (response: globalThis.Response) =>
  new URLSearchParams(new URL(response.headers.get("location")!).hash.slice(1)).get("error") ?? "";

test("real bootstrap accepts Apple and null form-post origins while preserving browser binding and nonce", async () => {
  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  let exchanges = 0;
  let logins = 0;
  let expectedNonce = "";
  (service as any).exchangeCode = async (provider: string, code: string, binding: { oidcNonce: string }) => {
    assert.equal(provider, "apple");
    assert.equal(code, "synthetic-apple-code");
    assert.equal(binding.oidcNonce, expectedNonce, "The controller must forward the stored OIDC nonce");
    exchanges += 1;
    return { provider: "apple", email: "synthetic.apple@example.invalid", emailVerified: true };
  };
  await withHttpApp(callbackApp(buildController(service, () => { logins += 1; })), async (baseUrl) => {
    for (const origin of ["https://appleid.apple.com", "null"]) {
      const flow = await service.createState("apple", "login", "/dashboard");
      expectedNonce = flow.oidcNonce;
      const missingState = await postAppleForm(baseUrl, { ...flow, state: "" }, origin);
      assert.equal(missingState.status, 302);
      assert.match(callbackError(missingState), /state.*mancante/i);
      assert.equal(missingState.headers.getSetCookie().some((cookie) => cookie.startsWith("fermi_access=")), false);
      for (const binding of [null, "wrong-synthetic-binding"]) {
        const rejected = await postAppleForm(baseUrl, flow, origin, { binding });
        assert.equal(rejected.status, 302);
        assert.match(callbackError(rejected), /browser/i);
        assert.equal(rejected.headers.getSetCookie().some((cookie) => cookie.startsWith("fermi_access=")), false);
      }
      const completed = await postAppleForm(baseUrl, flow, origin);
      assert.equal(completed.status, 302);
      assert.equal(completed.headers.getSetCookie().some((cookie) => cookie.startsWith("fermi_access=")), true);
      assert.equal(completed.headers.get("access-control-allow-origin"), null);
      const replay = await postAppleForm(baseUrl, flow, origin);
      assert.equal(replay.status, 302);
      assert.match(callbackError(replay), /già utilizzato|replay/i);
      assert.equal(replay.headers.getSetCookie().some((cookie) => cookie.startsWith("fermi_access=")), false);
    }
  });
  assert.equal(exchanges, 2);
  assert.equal(logins, 2);
});

test("real bootstrap consumes Apple denial once and does not broaden tenant or Platform CORS", async () => {
  const service = new SocialOAuthService(new MemoryOAuthFlowStore());
  let exchanges = 0;
  (service as any).exchangeCode = async () => {
    exchanges += 1;
    return { provider: "apple", email: "synthetic.apple@example.invalid", emailVerified: true };
  };
  const controller = buildController(service, () => undefined);
  await withHttpApp(callbackApp(controller), async (baseUrl) => {
    const deniedFlow = await service.createState("apple", "login");
    const denied = await postAppleForm(baseUrl, deniedFlow, "https://appleid.apple.com", { error: "access_denied" });
    assert.equal(denied.status, 302);
    assert.equal(denied.headers.getSetCookie().some((cookie) => cookie.startsWith("fermi_access=")), false);
    const retry = await postAppleForm(baseUrl, deniedFlow, "https://appleid.apple.com");
    assert.equal(retry.status, 302);
    assert.match(callbackError(retry), /già utilizzato|replay/i);
    const flow = await service.createState("apple", "login");
    for (const options of [
      { origin: "https://untrusted.example.invalid" },
      { origin: "https://appleid.apple.com", method: "GET" },
      { origin: "https://appleid.apple.com", method: "OPTIONS" },
      { origin: "https://appleid.apple.com", path: "/api/auth/apple/callback/" },
      { origin: "https://appleid.apple.com", path: "/api/auth/login" },
      { origin: "null", path: "/api/auth/refresh" },
      { origin: "https://appleid.apple.com", path: "/api/auth/google/callback" }
    ]) {
      const response = await postAppleForm(baseUrl, flow, options.origin, options);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    assert.equal(exchanges, 0);
    assert.equal((await postAppleForm(baseUrl, flow, "https://appleid.apple.com")).status, 302);
    assert.equal(exchanges, 1);
  });
  await withHttpApp(createPlatformApp(), async (baseUrl) => {
    for (const origin of ["https://appleid.apple.com", "null"]) {
      const response = await postAppleForm(baseUrl, { state: "synthetic-state", browserBinding: "synthetic-binding" }, origin);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
  });
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
