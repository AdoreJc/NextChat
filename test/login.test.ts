import { jest } from "@jest/globals";
import {
  AUTH_CALLBACK_PATH,
  buildAuthorizeUrl,
  captureAuthCallback,
  completeLogin,
  createLoginState,
  getLoginUrl,
  importSettingsLink,
  isLoginEnabled,
  LOGIN_STATE_STORAGE_KEY,
  loginNoticeFor,
  needsLogin,
  parseAuthCallbackHash,
  startLogin,
  takeAuthCallback,
} from "../app/utils/login";

// Sign-in through the API site. The key that comes back is only stored when
// the `state` matches the one this browser created, exactly once.

const LOGIN_URL = "https://api.example.test/chat-authorize";
const TEST_KEY = "sk-test-0000000000000000";
const UNAUTHORIZED = "the key is missing or invalid";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

function fakeLocation(origin = "https://chat.example.test") {
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

describe("state", () => {
  test("is at least 32 characters of [A-Za-z0-9_-]", () => {
    for (let i = 0; i < 50; i++) {
      expect(createLoginState()).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    }
  });

  test("is different every time", () => {
    const states = new Set(Array.from({ length: 50 }, createLoginState));
    expect(states.size).toBe(50);
  });

  test("comes from crypto.getRandomValues", () => {
    const spy = jest.spyOn(crypto, "getRandomValues");
    createLoginState();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("leaving for the authorize page", () => {
  test("the address follows the contract and redirect_uri is the site root", () => {
    const url = new URL(
      buildAuthorizeUrl(LOGIN_URL, "https://chat.example.test", "abc"),
    );
    expect(url.origin + url.pathname).toBe(LOGIN_URL);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "redirect_uri",
      "state",
    ]);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://chat.example.test/",
    );
    expect(url.searchParams.get("state")).toBe("abc");
    // url-encoded in the address itself
    expect(url.search).toContain(
      "redirect_uri=https%3A%2F%2Fchat.example.test%2F",
    );
  });

  test("stores the state it sends", () => {
    const storage = memoryStorage();
    const location = fakeLocation();
    expect(
      startLogin(
        { loginUrl: LOGIN_URL },
        { storage, location, singleSite: true },
      ),
    ).toBe(true);

    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(location.replace).not.toHaveBeenCalled();
    const target = new URL(location.assign.mock.calls[0][0]);
    const state = target.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(storage.data.get(LOGIN_STATE_STORAGE_KEY)).toBe(state);
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://chat.example.test/",
    );
  });

  test("the #/login route replaces the history entry", () => {
    const location = fakeLocation();
    startLogin(
      { loginUrl: LOGIN_URL },
      { storage: memoryStorage(), location, singleSite: true, replace: true },
    );
    expect(location.replace).toHaveBeenCalledTimes(1);
    expect(location.assign).not.toHaveBeenCalled();
  });
});

describe("callback", () => {
  const STATE = "s".repeat(43);
  const pending = () => memoryStorage({ [LOGIN_STATE_STORAGE_KEY]: STATE });

  test("a matching state stores the key without asking", () => {
    const saveKey = jest.fn();
    const confirm = jest.spyOn(window, "confirm");
    const storage = pending();

    const result = completeLogin(
      { key: TEST_KEY, state: STATE, error: "" },
      { saveKey, storage },
    );

    expect(result).toEqual({ ok: true });
    expect(saveKey).toHaveBeenCalledTimes(1);
    expect(saveKey).toHaveBeenCalledWith(TEST_KEY);
    expect(confirm).not.toHaveBeenCalled();
    expect(document.querySelector(".modal-mask")).toBeNull();
    // used up
    expect(storage.data.has(LOGIN_STATE_STORAGE_KEY)).toBe(false);
    confirm.mockRestore();
  });

  test("a different state does not store the key", () => {
    const saveKey = jest.fn();
    const result = completeLogin(
      { key: TEST_KEY, state: "x".repeat(43), error: "" },
      { saveKey, storage: pending() },
    );
    expect(result).toEqual({ ok: false, reason: "state_mismatch" });
    expect(saveKey).not.toHaveBeenCalled();
  });

  test("a missing state does not store the key", () => {
    const saveKey = jest.fn();
    const result = completeLogin(
      { key: TEST_KEY, state: "", error: "" },
      { saveKey, storage: pending() },
    );
    expect(result).toEqual({ ok: false, reason: "state_mismatch" });
    expect(saveKey).not.toHaveBeenCalled();
  });

  test("a callback nobody asked for does not store the key", () => {
    const saveKey = jest.fn();
    for (const state of ["", STATE]) {
      const result = completeLogin(
        { key: TEST_KEY, state, error: "" },
        { saveKey, storage: memoryStorage() },
      );
      expect(result).toEqual({ ok: false, reason: "state_mismatch" });
    }
    // no storage at all
    expect(
      completeLogin(
        { key: TEST_KEY, state: STATE, error: "" },
        { saveKey, storage: null },
      ),
    ).toEqual({ ok: false, reason: "state_mismatch" });
    expect(saveKey).not.toHaveBeenCalled();
  });

  test("a state works once: the second use does not store the key", () => {
    const saveKey = jest.fn();
    const storage = pending();
    const params = { key: TEST_KEY, state: STATE, error: "" };

    expect(completeLogin(params, { saveKey, storage })).toEqual({ ok: true });
    expect(completeLogin(params, { saveKey, storage })).toEqual({
      ok: false,
      reason: "state_mismatch",
    });
    expect(saveKey).toHaveBeenCalledTimes(1);
  });

  test("a failed check also uses the state up", () => {
    const saveKey = jest.fn();
    const storage = pending();
    completeLogin(
      { key: TEST_KEY, state: "x".repeat(43), error: "" },
      { saveKey, storage },
    );
    expect(storage.data.has(LOGIN_STATE_STORAGE_KEY)).toBe(false);
    expect(
      completeLogin(
        { key: TEST_KEY, state: STATE, error: "" },
        { saveKey, storage },
      ).ok,
    ).toBe(false);
    expect(saveKey).not.toHaveBeenCalled();
  });

  test("an error callback stores nothing", () => {
    const saveKey = jest.fn();
    expect(
      completeLogin(
        { key: "", state: STATE, error: "access_denied" },
        { saveKey, storage: pending() },
      ),
    ).toEqual({ ok: false, reason: "access_denied" });
    expect(
      completeLogin(
        { key: "", state: STATE, error: "server_error" },
        { saveKey, storage: pending() },
      ),
    ).toEqual({ ok: false, reason: "server_error" });
    // an error wins over a key in the same callback
    expect(
      completeLogin(
        { key: TEST_KEY, state: STATE, error: "anything_else" },
        { saveKey, storage: pending() },
      ),
    ).toEqual({ ok: false, reason: "server_error" });
    expect(saveKey).not.toHaveBeenCalled();
  });

  test("an empty or malformed key is not stored", () => {
    const saveKey = jest.fn();
    for (const key of ["", "sk with space", "k".repeat(600)]) {
      expect(
        completeLogin(
          { key, state: STATE, error: "" },
          { saveKey, storage: pending() },
        ),
      ).toEqual({ ok: false, reason: "invalid_response" });
    }
    expect(saveKey).not.toHaveBeenCalled();
  });

  test("the failure result never carries the key", () => {
    const result = completeLogin(
      { key: TEST_KEY, state: "x".repeat(43), error: "" },
      { saveKey: jest.fn(), storage: pending() },
    );
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });
});

describe("address bar", () => {
  test("only the callback route with parameters is parsed", () => {
    expect(
      parseAuthCallbackHash(`#/auth-callback?key=${TEST_KEY}&state=abc`),
    ).toEqual({ key: TEST_KEY, state: "abc", error: "" });
    expect(
      parseAuthCallbackHash("#/auth-callback?error=access_denied&state=abc"),
    ).toEqual({ key: "", state: "abc", error: "access_denied" });
    expect(parseAuthCallbackHash("#/auth-callback")).toBeNull();
    expect(parseAuthCallbackHash(`#/chat?key=${TEST_KEY}`)).toBeNull();
    expect(parseAuthCallbackHash(`#/?key=${TEST_KEY}&state=abc`)).toBeNull();
    expect(parseAuthCallbackHash("")).toBeNull();
  });

  test("the key is taken out of the address with history.replaceState", () => {
    const win = fakeWindow(`#/auth-callback?key=${TEST_KEY}&state=abc`);
    captureAuthCallback(win);

    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    const [, , url] = win.history.replaceState.mock.calls[0];
    expect(url).toBe("/#" + AUTH_CALLBACK_PATH);
    expect(String(url)).not.toContain(TEST_KEY);

    // kept in memory for the callback page, handed out once
    expect(takeAuthCallback(fakeWindow("#/auth-callback"))).toEqual({
      key: TEST_KEY,
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
      key: "",
      state: "abc",
      error: "server_error",
    });
  });

  test("parameters that appear in a running page are removed and dropped", () => {
    // nothing was captured while the page loaded
    const win = fakeWindow(`#/auth-callback?key=${TEST_KEY}&state=abc`);
    expect(takeAuthCallback(win)).toBe("dropped");
    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    expect(String(win.history.replaceState.mock.calls[0][2])).not.toContain(
      TEST_KEY,
    );
    expect(takeAuthCallback(fakeWindow("#/auth-callback"))).toBeNull();
  });

  test("a captured callback survives the address being rewritten back", () => {
    const hash = `#/auth-callback?key=${TEST_KEY}&state=abc`;
    captureAuthCallback(fakeWindow(hash));
    const win = fakeWindow(hash);
    expect(takeAuthCallback(win)).toEqual({
      key: TEST_KEY,
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

  test("works on the real window: location and history hold no key", () => {
    window.location.hash = `#/auth-callback?key=${TEST_KEY}&state=abc`;
    captureAuthCallback();
    expect(window.location.href).not.toContain(TEST_KEY);
    expect(window.location.hash).toBe("#/auth-callback");
    takeAuthCallback();
  });
});

describe("no LOGIN_URL: nothing changes", () => {
  test("there is no sign-in entry and no redirect", () => {
    for (const access of [{}, { loginUrl: "" }, { loginUrl: "   " }]) {
      expect(isLoginEnabled(access, true)).toBe(false);
      expect(needsLogin(access, true)).toBe(false);
      expect(loginNoticeFor(UNAUTHORIZED, UNAUTHORIZED, access, true)).toBe(
        null,
      );
      const location = fakeLocation();
      const storage = memoryStorage();
      expect(startLogin(access, { location, storage, singleSite: true })).toBe(
        false,
      );
      expect(location.assign).not.toHaveBeenCalled();
      expect(location.replace).not.toHaveBeenCalled();
      expect(storage.data.size).toBe(0);
    }
  });

  test("it only works in the single-site build", () => {
    expect(isLoginEnabled({ loginUrl: LOGIN_URL }, false)).toBe(false);
    expect(isLoginEnabled({ loginUrl: LOGIN_URL }, true)).toBe(true);
  });

  test("only http(s) addresses are accepted", () => {
    expect(getLoginUrl({ loginUrl: "javascript:alert(1)" }, true)).toBe("");
    expect(getLoginUrl({ loginUrl: "not a url" }, true)).toBe("");
    expect(getLoginUrl({ loginUrl: LOGIN_URL }, true)).toBe(LOGIN_URL);
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

  test("a 401 reply gets a sign-in notice", () => {
    const reply = `${UNAUTHORIZED}\n\n{"error":"Invalid token"}`;
    expect(
      loginNoticeFor(
        reply,
        UNAUTHORIZED,
        { loginUrl: LOGIN_URL, openaiApiKey: TEST_KEY },
        true,
      ),
    ).toBe("expired");
    expect(
      loginNoticeFor(reply, UNAUTHORIZED, { loginUrl: LOGIN_URL }, true),
    ).toBe("required");
    expect(
      loginNoticeFor(
        "an ordinary reply",
        UNAUTHORIZED,
        { loginUrl: LOGIN_URL, openaiApiKey: TEST_KEY },
        true,
      ),
    ).toBe(null);
  });
});
