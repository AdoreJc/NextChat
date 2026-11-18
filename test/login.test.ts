import { jest } from "@jest/globals";
import { webcrypto } from "node:crypto";
import {
  AUTH_CALLBACK_PATH,
  buildAuthorizeUrl,
  captureAuthCallback,
  codeChallengeFor,
  completeLogin,
  createCodeVerifier,
  createLoginState,
  dropPendingLogin,
  EXCHANGE_PATH,
  getApiOrigin,
  getLoginUrl,
  importSettingsLink,
  isLoginEnabled,
  LOGIN_STATE_STORAGE_KEY,
  loginNoticeFor,
  needsLogin,
  normalizeLoginUrl,
  parseAuthCallbackHash,
  startLogin,
  takeAuthCallback,
  withUnauthorizedHint,
} from "../app/utils/login";

// Sign-in through the API site: authorization code + PKCE. The key only comes
// back in the body of the exchange request, and that request is only made
// when the `state` matches the one this browser created, exactly once.

const LOGIN_URL = "https://api.example.test/chat-authorize";
const API_ORIGIN = "https://api.example.test";
const CHAT_ORIGIN = "https://chat.example.test";
const TEST_KEY = "sk-test-0000000000000000";
const TEST_CODE = "one-time-code-000000000000";
const UNAUTHORIZED = "the key is missing or invalid";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

beforeAll(() => {
  // the test environment has no SubtleCrypto of its own
  if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, "subtle", {
      value: subtle,
      configurable: true,
    });
  }
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

function fakeLocation(origin = CHAT_ORIGIN) {
  return {
    origin,
    assign: jest.fn<(url: string) => void>(),
    replace: jest.fn<(url: string) => void>(),
  };
}

function fakeWindow(hash: string) {
  return {
    location: { hash, pathname: "/", search: "" },
    history: {
      state: null,
      replaceState: jest.fn<History["replaceState"]>(),
    },
  };
}

/** a `fetch` that answers the exchange request */
function exchangeFetch(status = 200, body: unknown = undefined) {
  return jest.fn(async (_url: any, _init?: any) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? { success: true, data: { key: TEST_KEY } },
  })) as unknown as jest.MockedFunction<typeof fetch>;
}

describe("state and code_verifier", () => {
  test("state fits the contract and is different every time", () => {
    const states = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const state = createLoginState();
      expect(state).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
      states.add(state);
    }
    expect(states.size).toBe(50);
  });

  test("code_verifier is 43 to 128 characters of [A-Za-z0-9_-]", () => {
    const verifiers = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const verifier = createCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
      verifiers.add(verifier);
    }
    expect(verifiers.size).toBe(50);
  });

  test("both come from crypto.getRandomValues", () => {
    const spy = jest.spyOn(crypto, "getRandomValues");
    createLoginState();
    createCodeVerifier();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test("code_challenge is base64url(SHA-256(verifier)) without padding", async () => {
    // RFC 7636, appendix B
    await expect(
      codeChallengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", subtle),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    // computed independently: sha256 of 43 times "a"
    await expect(codeChallengeFor("a".repeat(43), subtle)).resolves.toBe(
      webcrypto.subtle
        ? Buffer.from(
            await webcrypto.subtle.digest(
              "SHA-256",
              Buffer.from("a".repeat(43), "ascii"),
            ),
          )
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "")
        : "",
    );
    const challenge = await codeChallengeFor(createCodeVerifier(), subtle);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("leaving for the authorize page", () => {
  test("the address follows the contract and redirect_uri is the site root", () => {
    const url = new URL(
      buildAuthorizeUrl(LOGIN_URL, CHAT_ORIGIN, "abc", "challenge"),
    );
    expect(url.origin + url.pathname).toBe(LOGIN_URL);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "code_challenge",
      "code_challenge_method",
      "redirect_uri",
      "state",
    ]);
    expect(url.searchParams.get("redirect_uri")).toBe(CHAT_ORIGIN + "/");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // url-encoded in the address itself
    expect(url.search).toContain(
      "redirect_uri=https%3A%2F%2Fchat.example.test%2F",
    );
  });

  test("state and verifier are stored together, only the challenge leaves", async () => {
    const storage = memoryStorage();
    const location = fakeLocation();
    await expect(
      startLogin(
        { loginUrl: LOGIN_URL },
        { storage, location, singleSite: true },
      ),
    ).resolves.toBe(true);

    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(location.replace).not.toHaveBeenCalled();
    const address = location.assign.mock.calls[0][0];
    const target = new URL(address);

    const pending = JSON.parse(storage.data.get(LOGIN_STATE_STORAGE_KEY)!);
    expect(Object.keys(pending).sort()).toEqual(["state", "verifier"]);
    expect(pending.state).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

    expect(target.searchParams.get("state")).toBe(pending.state);
    expect(target.searchParams.get("code_challenge")).toBe(
      await codeChallengeFor(pending.verifier, subtle),
    );
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("redirect_uri")).toBe(CHAT_ORIGIN + "/");
    // the verifier is in no address
    expect(address).not.toContain(pending.verifier);
  });

  test("the #/login route replaces the history entry", async () => {
    const location = fakeLocation();
    await startLogin(
      { loginUrl: LOGIN_URL },
      { storage: memoryStorage(), location, singleSite: true, replace: true },
    );
    expect(location.replace).toHaveBeenCalledTimes(1);
    expect(location.assign).not.toHaveBeenCalled();
  });
});

describe("callback", () => {
  const STATE = "s".repeat(43);
  const VERIFIER = "v".repeat(43);
  const pending = () =>
    memoryStorage({
      [LOGIN_STATE_STORAGE_KEY]: JSON.stringify({
        state: STATE,
        verifier: VERIFIER,
      }),
    });
  const good = { code: TEST_CODE, state: STATE, error: "" };
  const deps = (over: Record<string, unknown> = {}) => ({
    loginUrl: LOGIN_URL,
    origin: CHAT_ORIGIN,
    save: jest.fn<(key: string, apiOrigin: string) => void>(),
    storage: pending(),
    fetch: exchangeFetch(),
    ...over,
  });

  test("a matching state exchanges the code and stores the key without asking", async () => {
    const d = deps();
    const confirm = jest.spyOn(window, "confirm");

    await expect(completeLogin(good, d)).resolves.toEqual({ ok: true });

    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(API_ORIGIN + EXCHANGE_PATH);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      code: TEST_CODE,
      code_verifier: VERIFIER,
      redirect_uri: CHAT_ORIGIN + "/",
    });
    // no cookies, no Authorization
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");

    expect(d.save).toHaveBeenCalledTimes(1);
    expect(d.save).toHaveBeenCalledWith(TEST_KEY, API_ORIGIN);
    expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector(".modal-mask")).toBeNull();
    // state and verifier are used up together
    expect(d.storage.data.has(LOGIN_STATE_STORAGE_KEY)).toBe(false);
    confirm.mockRestore();
  });

  test("a different state: no exchange request, nothing stored", async () => {
    const d = deps();
    await expect(
      completeLogin({ ...good, state: "x".repeat(43) }, d),
    ).resolves.toEqual({ ok: false, reason: "state_mismatch" });
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  test("a missing state: no exchange request, nothing stored", async () => {
    const d = deps();
    await expect(completeLogin({ ...good, state: "" }, d)).resolves.toEqual({
      ok: false,
      reason: "state_mismatch",
    });
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  test("a callback nobody asked for: no exchange request, nothing stored", async () => {
    for (const storage of [
      memoryStorage(),
      null,
      // not what this site stores
      memoryStorage({ [LOGIN_STATE_STORAGE_KEY]: STATE }),
      memoryStorage({
        [LOGIN_STATE_STORAGE_KEY]: JSON.stringify({ state: STATE }),
      }),
    ]) {
      const d = deps({ storage });
      await expect(completeLogin(good, d)).resolves.toEqual({
        ok: false,
        reason: "state_mismatch",
      });
      expect(d.fetch).not.toHaveBeenCalled();
      expect(d.save).not.toHaveBeenCalled();
    }
  });

  test("a state works once: the second use makes no exchange request", async () => {
    const d = deps();
    await expect(completeLogin(good, d)).resolves.toEqual({ ok: true });
    await expect(completeLogin(good, d)).resolves.toEqual({
      ok: false,
      reason: "state_mismatch",
    });
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.save).toHaveBeenCalledTimes(1);
  });

  test("a failed check also uses state and verifier up", async () => {
    const d = deps();
    await completeLogin({ ...good, state: "x".repeat(43) }, d);
    expect(d.storage.data.has(LOGIN_STATE_STORAGE_KEY)).toBe(false);
    await expect(completeLogin(good, d)).resolves.toEqual({
      ok: false,
      reason: "state_mismatch",
    });
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  test("dropping a pending sign-in removes state and verifier", () => {
    const storage = pending();
    dropPendingLogin(storage);
    expect(storage.data.size).toBe(0);
  });

  test("an error callback makes no exchange request and stores nothing", async () => {
    for (const [error, reason] of [
      ["access_denied", "access_denied"],
      ["server_error", "server_error"],
      ["anything_else", "server_error"],
    ]) {
      const d = deps();
      await expect(
        // an error wins over a code in the same callback
        completeLogin({ code: TEST_CODE, state: STATE, error }, d),
      ).resolves.toEqual({ ok: false, reason });
      expect(d.fetch).not.toHaveBeenCalled();
      expect(d.save).not.toHaveBeenCalled();
    }
  });

  test("a missing or malformed code makes no exchange request", async () => {
    for (const code of ["", "code with space", "c".repeat(600)]) {
      const d = deps();
      await expect(completeLogin({ ...good, code }, d)).resolves.toEqual({
        ok: false,
        reason: "invalid_response",
      });
      expect(d.fetch).not.toHaveBeenCalled();
      expect(d.save).not.toHaveBeenCalled();
    }
  });

  test("a failed exchange stores nothing", async () => {
    const rejected = deps({
      fetch: exchangeFetch(400, {
        success: false,
        message: "invalid grant",
        code: "invalid_grant",
      }),
    });
    await expect(completeLogin(good, rejected)).resolves.toEqual({
      ok: false,
      reason: "exchange_failed",
      message: "invalid grant",
    });
    expect(rejected.save).not.toHaveBeenCalled();

    const serverError = deps({ fetch: exchangeFetch(500, {}) });
    await expect(completeLogin(good, serverError)).resolves.toEqual({
      ok: false,
      reason: "exchange_failed",
    });
    expect(serverError.save).not.toHaveBeenCalled();

    const offline = deps({
      fetch: jest.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    await expect(completeLogin(good, offline)).resolves.toEqual({
      ok: false,
      reason: "exchange_failed",
    });
    expect(offline.save).not.toHaveBeenCalled();
  });

  test("a refused exchange hands on the reason the API site gave", async () => {
    // e.g. the account already holds as many tokens as it may
    const d = deps({
      fetch: exchangeFetch(400, {
        success: false,
        message: "  token limit reached <b>x</b>  ",
        code: "invalid_grant",
      }),
    });
    await expect(completeLogin(good, d)).resolves.toEqual({
      ok: false,
      reason: "exchange_failed",
      // handed on as text, the page renders it as text
      message: "token limit reached <b>x</b>",
    });
    expect(d.save).not.toHaveBeenCalled();
  });

  test("any answer but 200 is a failure, with a general reason when none is given", async () => {
    for (const [status, body] of [
      [403, {}],
      [403, { message: 42 }],
      [500, { message: "" }],
      [201, { success: true, data: { key: TEST_KEY } }],
      [204, { success: true, data: { key: TEST_KEY } }],
    ] as [number, unknown][]) {
      const d = deps({ fetch: exchangeFetch(status, body) });
      const result = await completeLogin(good, d);
      expect(result).toEqual({ ok: false, reason: "exchange_failed" });
      expect("message" in result).toBe(false);
      expect(d.save).not.toHaveBeenCalled();
    }
    // an answer that is not JSON
    const broken = deps({
      fetch: jest.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      })),
    });
    await expect(completeLogin(good, broken)).resolves.toEqual({
      ok: false,
      reason: "exchange_failed",
    });
  });

  test("a failed exchange does not start another sign-in", async () => {
    const d = deps({ fetch: exchangeFetch(400, { message: "no" }) });
    // a navigation is the one thing the test page cannot do: it reports it
    const reported = jest.spyOn(console, "error").mockImplementation(() => {});
    const before = window.location.href;
    sessionStorage.clear();

    await completeLogin(good, d);

    // one request, no pending sign-in left, nothing navigated
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.storage.data.size).toBe(0);
    expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).toBeNull();
    expect(reported).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);

    // the same checks do notice a sign-in that is started
    await startLogin({ loginUrl: LOGIN_URL }, { singleSite: true });
    expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).not.toBeNull();
    expect(reported).toHaveBeenCalled();
    sessionStorage.clear();
    reported.mockRestore();
  });

  test("an exchange answer without a usable key stores nothing", async () => {
    for (const body of [
      {},
      { success: false, data: { key: TEST_KEY } },
      { success: true },
      { success: true, data: { key: "" } },
      { success: true, data: { key: "sk with space" } },
      { success: true, data: { key: 42 } },
      { key: TEST_KEY },
    ]) {
      const d = deps({ fetch: exchangeFetch(200, body) });
      await expect(completeLogin(good, d)).resolves.toEqual({
        ok: false,
        reason: "invalid_response",
      });
      expect(d.save).not.toHaveBeenCalled();
    }
  });

  test("without a usable login url there is no exchange request", async () => {
    for (const loginUrl of ["", "http://api.example.test/chat-authorize"]) {
      const d = deps({ loginUrl });
      await expect(completeLogin(good, d)).resolves.toEqual({
        ok: false,
        reason: "server_error",
      });
      expect(d.fetch).not.toHaveBeenCalled();
      expect(d.save).not.toHaveBeenCalled();
    }
  });

  test("results never carry the key, the code or the verifier", async () => {
    const d = deps({ fetch: exchangeFetch(400, {}) });
    const text = JSON.stringify(await completeLogin(good, d));
    expect(text).not.toContain(TEST_KEY);
    expect(text).not.toContain(TEST_CODE);
    expect(text).not.toContain(VERIFIER);
  });
});

describe("address bar", () => {
  test("only the callback route with parameters is parsed", () => {
    expect(
      parseAuthCallbackHash(`#/auth-callback?code=${TEST_CODE}&state=abc`),
    ).toEqual({ code: TEST_CODE, state: "abc", error: "" });
    expect(
      parseAuthCallbackHash("#/auth-callback?error=access_denied&state=abc"),
    ).toEqual({ code: "", state: "abc", error: "access_denied" });
    expect(parseAuthCallbackHash("#/auth-callback")).toBeNull();
    expect(parseAuthCallbackHash(`#/chat?code=${TEST_CODE}`)).toBeNull();
    expect(parseAuthCallbackHash(`#/?code=${TEST_CODE}&state=abc`)).toBeNull();
    expect(parseAuthCallbackHash("")).toBeNull();
  });

  test("a key in the callback address is ignored", async () => {
    const STATE = "s".repeat(43);
    const params = parseAuthCallbackHash(
      `#/auth-callback?key=${TEST_KEY}&state=${STATE}`,
    )!;
    // it is not even read
    expect(params).toEqual({ code: "", state: STATE, error: "" });
    expect(JSON.stringify(params)).not.toContain(TEST_KEY);

    const save = jest.fn();
    const fetch = exchangeFetch();
    await expect(
      completeLogin(params, {
        loginUrl: LOGIN_URL,
        origin: CHAT_ORIGIN,
        save,
        fetch,
        storage: memoryStorage({
          [LOGIN_STATE_STORAGE_KEY]: JSON.stringify({
            state: STATE,
            verifier: "v".repeat(43),
          }),
        }),
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_response" });
    expect(fetch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  test("the parameters are taken out of the address with history.replaceState", () => {
    const win = fakeWindow(`#/auth-callback?code=${TEST_CODE}&state=abc`);
    captureAuthCallback(win);

    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    const [, , url] = win.history.replaceState.mock.calls[0];
    expect(url).toBe("/#" + AUTH_CALLBACK_PATH);
    expect(String(url)).not.toContain(TEST_CODE);

    // kept in memory for the callback page, handed out once
    expect(takeAuthCallback(fakeWindow("#/auth-callback"))).toEqual({
      code: TEST_CODE,
      state: "abc",
      error: "",
    });
    expect(takeAuthCallback(fakeWindow("#/auth-callback"))).toBeNull();
  });

  test("failed callbacks are cleaned up as well", () => {
    const win = fakeWindow("#/auth-callback?error=server_error&state=abc");
    captureAuthCallback(win);
    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    expect(takeAuthCallback(fakeWindow("#/auth-callback"))).toEqual({
      code: "",
      state: "abc",
      error: "server_error",
    });
  });

  test("parameters that appear in a running page are removed and dropped", () => {
    // nothing was captured while the page loaded
    const win = fakeWindow(`#/auth-callback?code=${TEST_CODE}&state=abc`);
    expect(takeAuthCallback(win)).toBe("dropped");
    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    expect(String(win.history.replaceState.mock.calls[0][2])).not.toContain(
      TEST_CODE,
    );
    expect(takeAuthCallback(fakeWindow("#/auth-callback"))).toBeNull();
  });

  test("a captured callback survives the address being rewritten back", () => {
    const hash = `#/auth-callback?code=${TEST_CODE}&state=abc`;
    captureAuthCallback(fakeWindow(hash));
    const win = fakeWindow(hash);
    expect(takeAuthCallback(win)).toEqual({
      code: TEST_CODE,
      state: "abc",
      error: "",
    });
    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
  });

  test("other routes are left alone", () => {
    const win = fakeWindow("#/chat");
    captureAuthCallback(win);
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });

  test("works on the real window: the address holds no parameters", () => {
    window.location.hash = `#/auth-callback?code=${TEST_CODE}&state=abc`;
    captureAuthCallback();
    expect(window.location.href).not.toContain(TEST_CODE);
    expect(window.location.hash).toBe("#/auth-callback");
    takeAuthCallback();
  });
});

describe("LOGIN_URL", () => {
  test("has to be https; http only for localhost and 127.0.0.1", () => {
    expect(normalizeLoginUrl(LOGIN_URL)).toBe(LOGIN_URL);
    expect(normalizeLoginUrl(`  ${LOGIN_URL} `)).toBe(LOGIN_URL);
    expect(normalizeLoginUrl("http://localhost:3000/chat-authorize")).toBe(
      "http://localhost:3000/chat-authorize",
    );
    expect(normalizeLoginUrl("http://127.0.0.1:3000/chat-authorize")).toBe(
      "http://127.0.0.1:3000/chat-authorize",
    );
    for (const bad of [
      "",
      "   ",
      undefined,
      null,
      "not a url",
      "/chat-authorize",
      "javascript:alert(1)",
      "ftp://api.example.test/chat-authorize",
      "http://api.example.test/chat-authorize",
      "http://localhost.example.test/chat-authorize",
      "http://127.0.0.1.example.test/chat-authorize",
    ]) {
      expect(normalizeLoginUrl(bad)).toBe("");
    }
  });

  test("the API site is the origin of the login url", () => {
    expect(getApiOrigin(LOGIN_URL)).toBe(API_ORIGIN);
    expect(getApiOrigin("http://localhost:3000/chat-authorize?x=1")).toBe(
      "http://localhost:3000",
    );
  });

  test("an unusable address counts as not configured", () => {
    for (const loginUrl of [
      "javascript:alert(1)",
      "http://api.example.test/chat-authorize",
    ]) {
      expect(getLoginUrl({ loginUrl }, true)).toBe("");
      expect(isLoginEnabled({ loginUrl }, true)).toBe(false);
    }
    expect(getLoginUrl({ loginUrl: LOGIN_URL }, true)).toBe(LOGIN_URL);
  });

  test("it only works in the single-site build", () => {
    expect(isLoginEnabled({ loginUrl: LOGIN_URL }, false)).toBe(false);
    expect(isLoginEnabled({ loginUrl: LOGIN_URL }, true)).toBe(true);
  });
});

describe("no LOGIN_URL: nothing changes", () => {
  const anyReply = { isLast: true, repliedAt: Date.now() };

  test("there is no sign-in entry and no redirect", async () => {
    for (const access of [{}, { loginUrl: "" }, { loginUrl: "   " }]) {
      expect(isLoginEnabled(access, true)).toBe(false);
      expect(needsLogin(access, true)).toBe(false);
      expect(
        loginNoticeFor(UNAUTHORIZED, UNAUTHORIZED, access, anyReply, true),
      ).toBe(null);
      const location = fakeLocation();
      const storage = memoryStorage();
      await expect(
        startLogin(access, { location, storage, singleSite: true }),
      ).resolves.toBe(false);
      expect(location.assign).not.toHaveBeenCalled();
      expect(location.replace).not.toHaveBeenCalled();
      expect(storage.data.size).toBe(0);
    }
  });

  test("the old settings link still asks and then imports", async () => {
    const confirm = jest.fn(async () => true);
    const apply = jest.fn();
    const payload = { key: TEST_KEY, url: "https://api.example.test" };

    await expect(
      importSettingsLink(JSON.stringify(payload), {
        loginEnabled: false,
        confirm,
        apply,
      }),
    ).resolves.toBe("imported");
    expect(confirm).toHaveBeenCalledWith(payload);
    expect(apply).toHaveBeenCalledWith(payload);
  });

  test("the old settings link imports nothing when declined", async () => {
    const apply = jest.fn();
    await expect(
      importSettingsLink(JSON.stringify({ key: TEST_KEY }), {
        loginEnabled: false,
        confirm: async () => false,
        apply,
      }),
    ).resolves.toBe("declined");
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("with LOGIN_URL", () => {
  test("the sign-in entry shows until there is a key", () => {
    expect(needsLogin({ loginUrl: LOGIN_URL }, true)).toBe(true);
    expect(needsLogin({ loginUrl: LOGIN_URL, openaiApiKey: "" }, true)).toBe(
      true,
    );
    expect(
      needsLogin({ loginUrl: LOGIN_URL, openaiApiKey: TEST_KEY }, true),
    ).toBe(false);
  });

  test("the old settings link is ignored: no dialog, no import", async () => {
    const confirm = jest.fn(async () => true);
    const apply = jest.fn();

    await expect(
      importSettingsLink(
        JSON.stringify({ key: TEST_KEY, url: "https://evil.example.test" }),
        { loginEnabled: true, confirm, apply },
      ),
    ).resolves.toBe("ignored");
    expect(confirm).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("sign-in notice under a 401 reply", () => {
  const LOGIN_AT = 1_000_000;
  const signedIn = {
    loginUrl: LOGIN_URL,
    openaiApiKey: TEST_KEY,
    loginAt: LOGIN_AT,
  };
  const reply = `${UNAUTHORIZED}\n\n{"error":"Invalid token"}`;
  const fresh = { isLast: true, repliedAt: LOGIN_AT + 1 };

  test("a streamed 401 reply gets the notice", () => {
    expect(loginNoticeFor(reply, UNAUTHORIZED, signedIn, fresh, true)).toBe(
      "expired",
    );
    expect(
      loginNoticeFor(reply, UNAUTHORIZED, { loginUrl: LOGIN_URL }, fresh, true),
    ).toBe("required");
    expect(
      loginNoticeFor("an ordinary reply", UNAUTHORIZED, signedIn, fresh, true),
    ).toBe(null);
  });

  test("a 401 answer to a request without streaming gets the notice too", () => {
    // what the non-streaming path hands on: the error body as text
    const body = '```\n{"error":{"message":"Invalid token"}}\n```';
    expect(loginNoticeFor(body, UNAUTHORIZED, signedIn, fresh, true)).toBe(
      null,
    );

    const hinted = withUnauthorizedHint(body, 401, UNAUTHORIZED);
    expect(hinted).toBe(`${UNAUTHORIZED}\n\n${body}`);
    expect(
      loginNoticeFor(hinted as string, UNAUTHORIZED, signedIn, fresh, true),
    ).toBe("expired");
  });

  test("other answers are handed on unchanged", () => {
    expect(withUnauthorizedHint("fine", 200, UNAUTHORIZED)).toBe("fine");
    expect(withUnauthorizedHint("server error", 500, UNAUTHORIZED)).toBe(
      "server error",
    );
    // image answers are not text
    const images = [{ type: "image_url", image_url: { url: "x" } }];
    expect(withUnauthorizedHint(images, 401, UNAUTHORIZED)).toBe(images);
  });

  test("replies rejected before signing in again get no button", () => {
    const old = { isLast: true, repliedAt: LOGIN_AT - 1 };
    expect(loginNoticeFor(reply, UNAUTHORIZED, signedIn, old, true)).toBe(null);
    // nor does anything but the last reply of a conversation
    const earlier = { isLast: false, repliedAt: LOGIN_AT + 1 };
    expect(loginNoticeFor(reply, UNAUTHORIZED, signedIn, earlier, true)).toBe(
      null,
    );
    expect(
      loginNoticeFor(
        reply,
        UNAUTHORIZED,
        { loginUrl: LOGIN_URL },
        earlier,
        true,
      ),
    ).toBe(null);
  });
});
