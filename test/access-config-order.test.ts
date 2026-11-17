import { jest } from "@jest/globals";

// Warm-up: the store pulls in most of the client code. Loading it once here,
// while the file is being set up, keeps that first (slow) load out of every
// timed hook and test below; the fresh copies they load reuse the compiled
// modules.
import "../app/store/access";

// The access store is filled from two sides: the state stored in this browser
// (read asynchronously) and the server config from /api/config. The server
// config has to win, whichever arrives first. Before the fix a slow read of
// the stored state overwrote a server config that had arrived earlier.

const TEST_KEY = "sk-test-0000000000000000";

type AccessStore = typeof import("../app/store/access").useAccessStore;

/** a fresh copy of the store over the given browser storage and server */
async function loadStore(options: {
  stored: Record<string, unknown>;
  server: Record<string, unknown>;
  /** how long the browser storage takes to answer, ms */
  storageDelay: number;
}) {
  jest.resetModules();
  // the browser storage the stores are read from: an IndexedDB that fails
  // after a delay, which makes the stores fall back to localStorage
  (globalThis as any).indexedDB = {
    open() {
      const request: { onerror?: () => void; error?: Error } = {
        error: new Error("no IndexedDB in this test"),
      };
      setTimeout(() => request.onerror?.(), options.storageDelay);
      return request;
    },
  };
  localStorage.clear();
  localStorage.setItem(
    "access-control",
    JSON.stringify({ state: options.stored, version: 2 }),
  );

  const fetchMock = jest.fn(async (_url: any, _init?: any) => ({
    json: async () => options.server,
  }));
  global.fetch = fetchMock as unknown as typeof fetch;

  const { useAccessStore } = await import("../app/store/access");
  return { useAccessStore, fetchMock };
}

function quiet() {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
}

afterAll(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).indexedDB;
  localStorage.clear();
});

describe("a server config that arrives before the stored state", () => {
  let useAccessStore: AccessStore;

  beforeAll(async () => {
    quiet();
    ({ useAccessStore } = await loadStore({
      stored: {
        customModels: "stale-from-browser",
        openaiApiKey: TEST_KEY,
      },
      server: { customModels: "from-server" },
      // the server answers first
      storageDelay: 40,
    }));
  });

  test("is not overwritten", async () => {
    // settles when the config request is done and the stored state is read
    await useAccessStore.getState().whenConfigLoaded();

    expect(useAccessStore.persist.hasHydrated()).toBe(true);
    const access = useAccessStore.getState();
    // the server decides its own settings
    expect(access.customModels).toBe("from-server");
    // what only the browser knows is kept
    expect(access.openaiApiKey).toBe(TEST_KEY);
  });
});

describe("a stored login url", () => {
  let useAccessStore: AccessStore;

  beforeAll(async () => {
    quiet();
    ({ useAccessStore } = await loadStore({
      stored: { loginUrl: "https://old.example.test/chat-authorize" },
      server: { loginUrl: "" },
      storageDelay: 40,
    }));
  });

  test("does not survive the server switching sign-in off", async () => {
    await useAccessStore.getState().whenConfigLoaded();
    expect(useAccessStore.getState().loginUrl).toBe("");
  });
});

describe("the config request", () => {
  let useAccessStore: AccessStore;
  let fetchMock: Awaited<ReturnType<typeof loadStore>>["fetchMock"];

  beforeAll(async () => {
    quiet();
    ({ useAccessStore, fetchMock } = await loadStore({
      stored: { openaiApiKey: TEST_KEY },
      server: {},
      storageDelay: 0,
    }));
  });

  test("does not carry the user's key", async () => {
    // read the stored state first, so there is a key that could be sent
    await useAccessStore.getState().whenHydrated();
    expect(useAccessStore.getState().openaiApiKey).toBe(TEST_KEY);
    await useAccessStore.getState().whenConfigLoaded();

    const configCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/config",
    );
    expect(configCalls).toHaveLength(1);
    const [, init] = configCalls[0];
    expect(init.headers).toEqual({});
    expect(JSON.stringify(init)).not.toContain(TEST_KEY);
  });
});
