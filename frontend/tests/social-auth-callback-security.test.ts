import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const trustedUser = {
  id: "server-user-a", tenantId: "tenant-a", email: "operator@example.test",
  firstName: "Synthetic", lastName: "Operator", roles: ["OPERATOR"], permissions: ["bookings:read"]
};
const forgedUser = { ...trustedUser, id: "forged-admin", tenantId: "tenant-b", roles: ["ADMIN"] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const flush = () => new Promise<void>((done) => setImmediate(done));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

type FixtureOptions = {
  fragment?: string;
  me?: () => Promise<unknown>;
  license?: () => Promise<{ status: string }>;
  profile?: () => Promise<unknown>;
  analyticsThrows?: boolean;
};

// Execute the actual page effect with controlled hooks and transport services.
// This checks callback behavior and cleanup, without claiming a mounted browser,
// React scheduler, cookie transport, or a real OAuth provider has been tested.
const fixture = (options: FixtureOptions = {}) => {
  const calls: string[] = [];
  const sessions: Array<{ user: unknown; remember?: boolean }> = [];
  const events: Array<{ type: string; metadata: unknown }> = [];
  const destinations: Array<{ path: string; replace?: boolean }> = [];
  const errors: Array<string | null> = [];
  const historyWrites: Array<{ state: unknown; url: string }> = [];
  const routerState = { key: "callback-entry", idx: 4, usr: { source: "synthetic" } };
  const browser = {
    location: new URL(`https://fleetum.example.test/auth/social-callback?intent=login${options.fragment ?? `#user=${encode(forgedUser)}`}`),
    history: {
      state: routerState,
      replaceState(state: unknown, _title: string, url: string) {
        calls.push("history");
        historyWrites.push({ state, url });
        browser.location = new URL(url, browser.location.origin);
      }
    }
  };
  const auth = {
    me: async () => { calls.push("me"); return options.me ? options.me() : trustedUser; },
    licenseStatus: async () => { calls.push("license"); return options.license ? options.license() : { status: "ACTIVE" }; }
  };
  const setSession = (user: unknown, remember?: boolean) => {
    calls.push("session"); sessions.push({ user, remember });
  };
  let effect!: () => void | (() => void);
  const root = resolve(import.meta.dirname, "../src");
  const load = (path: string): Record<string, unknown> => {
    const module = { exports: {} as Record<string, unknown> };
    const output = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
    });
    const requireStub = (name: string): unknown => {
      if (name === "react") return {
        useMemo: (fn: () => unknown) => fn(),
        useEffect: (fn: () => void | (() => void)) => { effect = fn; },
        useState: (initial: string | null) => [initial, (value: string | null) => { errors.push(value); }]
      };
      if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      if (name === "react-router-dom") return {
        useNavigate: () => (next: string, config?: { replace?: boolean }) => {
          calls.push("navigate"); destinations.push({ path: next, replace: config?.replace });
        }
      };
      if (name.endsWith("/auth-store")) return {
        useAuthStore: (selector: (state: { setSession: typeof setSession }) => unknown) => selector({ setSession })
      };
      if (name.endsWith("/auth-usecases")) return { authUseCases: auth };
      if (name.endsWith("/public-analytics-usecases")) return {
        trackPublicEvent: (type: string, metadata: unknown) => {
          calls.push("analytics"); events.push({ type, metadata });
          if (options.analyticsThrows) throw new Error("Synthetic unavailable analytics storage");
        }
      };
      if (name.endsWith("/http-client")) return {
        httpClient: { get: async () => { calls.push("profile"); return options.profile ? options.profile() : null; } }
      };
      if (name.endsWith("/tenant-profile-usecases")) return load(resolve(root, "application/usecases/tenant-profile-usecases.ts"));
      if (name.endsWith("/safe-return-to")) return load(resolve(root, "presentation/routes/safe-return-to.ts"));
      if (name.endsWith("/fleetum-logo-loader")) return { FleetumBlockLoader: () => null };
      throw new Error(`Unexpected page dependency: ${name}`);
    };
    runInNewContext(output.outputText, {
      module, exports: module.exports, require: requireStub, window: browser, URL, URLSearchParams, atob
    }, { filename: path });
    return module.exports;
  };
  const page = load(resolve(root, "presentation/pages/auth/social-auth-callback-page.tsx"));
  (page.SocialAuthCallbackPage as () => unknown)();
  const cleanup = effect();
  assert.equal(typeof cleanup, "function");
  return {
    calls, sessions, events, destinations, errors, historyWrites, browser, routerState,
    cancel: cleanup as () => void,
    restart: () => { (cleanup as () => void)(); return effect(); }
  };
};

test("OAuth uses the authenticated server user instead of a forged fragment identity", async () => {
  const f = fixture();
  await flush();
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].user, trustedUser);
  assert.equal(f.sessions[0].remember, true);
  assert.ok(f.calls.indexOf("me") < f.calls.indexOf("session"));
  assert.ok(f.calls.indexOf("me") < f.calls.indexOf("license"));
  assert.deepEqual(f.destinations, [{ path: "/dashboard", replace: true }]);
});

for (const fragment of ["", "#returnTo=%2Frental-bookings%3Ftab%3Dnext", "#user=%%%", "#user=bnVsbA", `#user=${encode({})}`]) {
  test(`OAuth fragment identity is optional and cannot reject a valid cookie session: ${fragment || "absent"}`, async () => {
    const f = fixture({ fragment });
    await flush();
    assert.deepEqual(f.errors, []);
    assert.equal(f.sessions[0]?.user, trustedUser);
    assert.equal(f.calls.filter((call) => call === "me").length, 1);
  });
}

test("OAuth does not mutate session, analytics, license or profile before me resolves", async () => {
  const response = deferred<unknown>();
  const f = fixture({ me: () => response.promise, fragment: `#user=${encode(forgedUser)}&socialSignup=1` });
  assert.deepEqual(f.calls.filter((call) => call !== "history"), ["me"]);
  assert.deepEqual(f.sessions, []);
  assert.deepEqual(f.events, []);
  response.resolve(trustedUser);
  await flush();
  assert.equal(f.sessions[0].user, trustedUser);
  assert.equal(f.events.length, 1);
});

test("OAuth rejects an unverified session even when its fragment looks legitimate", async () => {
  const f = fixture({ me: async () => { throw new Error("Synthetic unauthorized"); }, fragment: `#user=${encode(trustedUser)}&socialSignup=1` });
  await flush();
  assert.deepEqual(f.sessions, []);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.destinations, []);
  assert.equal(f.calls.includes("license"), false);
  assert.equal(f.calls.includes("profile"), false);
  assert.deepEqual(f.errors, ["Impossibile finalizzare il login social."]);
});

test("OAuth cleanup before me resolves prevents every later callback mutation", async () => {
  const response = deferred<unknown>();
  const f = fixture({ me: () => response.promise, fragment: `#user=${encode(forgedUser)}&socialSignup=1` });
  f.cancel();
  response.resolve(trustedUser);
  await flush();
  assert.deepEqual(f.sessions, []);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.destinations, []);
  assert.deepEqual(f.errors, []);
  assert.equal(f.calls.includes("license"), false);
  assert.equal(f.calls.includes("profile"), false);
});

test("OAuth cleanup suppresses stale failure messages", async () => {
  const response = deferred<unknown>();
  const f = fixture({ me: () => response.promise });
  f.cancel();
  response.reject(new Error("Synthetic session lookup failure"));
  await flush();
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.sessions, []);
});

test("OAuth cleanup while license resolves does not start company profile lookup or navigate", async () => {
  const response = deferred<{ status: string }>();
  const f = fixture({ license: () => response.promise });
  await flush();
  f.cancel();
  response.resolve({ status: "PENDING" });
  await flush();
  assert.equal(f.calls.includes("profile"), false);
  assert.deepEqual(f.destinations, []);
});

test("OAuth cleanup while company profile resolves does not navigate from the stale result", async () => {
  const response = deferred<unknown>();
  const f = fixture({ license: async () => ({ status: "PENDING" }), profile: () => response.promise });
  await flush();
  assert.equal(f.calls.includes("profile"), true);
  f.cancel();
  response.resolve(null);
  await flush();
  assert.deepEqual(f.destinations, []);
  assert.deepEqual(f.errors, []);
});

test("OAuth effect restart accepts only the current lookup response", async () => {
  const oldResponse = deferred<unknown>();
  let lookups = 0;
  const f = fixture({ me: () => ++lookups === 1 ? oldResponse.promise : Promise.resolve(trustedUser), fragment: "#socialSignup=1" });
  const currentCleanup = f.restart();
  await flush();
  oldResponse.resolve(forgedUser);
  await flush();
  assert.equal(f.sessions.length, 1);
  assert.equal(f.sessions[0].user, trustedUser);
  assert.equal(f.events.length, 1);
  assert.equal(f.destinations.length, 1);
  if (typeof currentCleanup === "function") currentCleanup();
});

test("OAuth removes sensitive fragment while preserving callback query, routing state and captured deep route", async () => {
  const f = fixture({ fragment: `#user=${encode(forgedUser)}&refreshExpiresAt=synthetic&returnTo=%2Frental-bookings%3Ftab%3Dcontratto%23firma` });
  await flush();
  assert.equal(f.browser.location.hash, "");
  assert.equal(f.browser.location.pathname, "/auth/social-callback");
  assert.equal(f.browser.location.search, "?intent=login");
  assert.equal(f.historyWrites[0]?.state, f.routerState);
  assert.deepEqual(f.destinations, [{ path: "/rental-bookings?tab=contratto#firma", replace: true }]);
});

test("OAuth provider denial scrubs the fragment and remains an error without auth mutations", async () => {
  const f = fixture({ fragment: "#error=Accesso%20annullato&user=synthetic" });
  await flush();
  assert.deepEqual(f.errors, ["Accesso annullato"]);
  assert.deepEqual(f.sessions, []);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.destinations, []);
  assert.equal(f.calls.includes("me"), false);
  assert.equal(f.browser.location.hash, "");
});

for (const status of ["ACTIVE", "TRIAL"]) {
  test(`OAuth ${status} license preserves safe returnTo without profile lookup`, async () => {
    const f = fixture({ fragment: "#returnTo=%2Frental-bookings%3Ftab%3Dnext", license: async () => ({ status }) });
    await flush();
    assert.deepEqual(f.destinations, [{ path: "/rental-bookings?tab=next", replace: true }]);
    assert.equal(f.calls.includes("profile"), false);
  });
}

const completeProfile = { profile: Object.fromEntries([
  "legalName", "vatNumber", "legalAddress", "city", "province", "postalCode", "email", "phone",
  "adminFirstName", "adminLastName", "adminEmail"
].map((key) => [key, "synthetic"])) };

for (const path of ["/activate?billing=required", "/upgrade?plan=pro", "/dashboard"]) {
  test(`OAuth pending license keeps billing route or redirects a complete company: ${path}`, async () => {
    const f = fixture({ fragment: `#returnTo=${encodeURIComponent(path)}`, license: async () => ({ status: "PENDING" }), profile: async () => completeProfile });
    await flush();
    assert.deepEqual(f.destinations, [{ path: path === "/dashboard" ? "/activate?billing=required" : path, replace: true }]);
  });
}

for (const lookup of ["incomplete-profile", "profile-error", "license-error"]) {
  test(`OAuth preserves company onboarding fallback: ${lookup}`, async () => {
    const f = fixture({ fragment: "#returnTo=%2Fdashboard", license: async () => {
      if (lookup === "license-error") throw new Error("Synthetic license error");
      return { status: "PENDING" };
    }, profile: async () => {
      if (lookup === "profile-error") throw new Error("Synthetic profile error");
      return null;
    } });
    await flush();
    assert.deepEqual(f.destinations, [{ path: "/onboarding/azienda?from=social", replace: true }]);
  });
}

for (const returnTo of ["//evil.example.test", "https://evil.example.test", "/\\evil.example.test"]) {
  test(`OAuth rejects external returnTo: ${returnTo}`, async () => {
    const f = fixture({ fragment: `#returnTo=${encodeURIComponent(returnTo)}` });
    await flush();
    assert.deepEqual(f.destinations, [{ path: "/dashboard", replace: true }]);
  });
}

test("OAuth preserves only the existing Google signup analytics event after authenticated identity", async () => {
  const f = fixture({ fragment: "#socialSignup=1" });
  await flush();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, "SIGNUP_COMPLETED");
  assert.deepEqual(JSON.parse(JSON.stringify(f.events[0].metadata)), { source: "google", next: "company_onboarding" });
  assert.ok(f.calls.indexOf("me") < f.calls.indexOf("analytics"));
});

test("OAuth ordinary login emits no signup event", async () => {
  const f = fixture({ fragment: "#socialSignup=0" });
  await flush();
  assert.deepEqual(f.events, []);
  assert.equal(f.sessions[0]?.user, trustedUser);
});

test("OAuth signup navigation survives unavailable analytics storage", async () => {
  const f = fixture({ fragment: "#socialSignup=1", analyticsThrows: true });
  await flush();
  assert.equal(f.sessions[0]?.user, trustedUser);
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.destinations, [{ path: "/dashboard", replace: true }]);
});
