import { jest } from "@jest/globals";

// The access store is filled from two sides: the state stored in this browser
// (read asynchronously) and the server config from /api/config. The server
// config has to win, whichever arrives first. Before the fix a slow read of
// the stored state overwrote a server config that had arrived earlier.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_KEY = "sk-test-0000000000000000";

async function loadStore(options: {
  stored: Record<string, unknown>;
  server: Record<string, unknown>;
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

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as any).indexedDB;
  localStorage.clear();
});

describe("server config and stored state", () => {
  test("a server config that arrives before the stored state is not overwritten", async () => {
    const { useAccessStore } = await loadStore({
      stored: {
        customModels: "stale-from-browser",
        openaiApiKey: TEST_KEY,
      },
      server: { customModels: "from-server" },
      // the server answers first
      storageDelay: 40,
    });

    useAccessStore.getState().fetch();
    await sleep(150);

    expect(useAccessStore.persist.hasHydrated()).toBe(true);
    const access = useAccessStore.getState();
    // the server decides its own settings
    expect(access.customModels).toBe("from-server");
    // what only the browser knows is kept
    expect(access.openaiApiKey).toBe(TEST_KEY);
  });

  test("a stored login url does not survive the server switching sign-in off", async () => {
    const { useAccessStore } = await loadStore({
      stored: { loginUrl: "https://old.example.test/chat-authorize" },
      server: { loginUrl: "" },
      storageDelay: 40,
    });

    await useAccessStore.getState().whenConfigLoaded();
    expect(useAccessStore.getState().loginUrl).toBe("");
  });

  test("the user's key is not sent along with the config request", async () => {
    const { useAccessStore, fetchMock } = await loadStore({
      stored: { openaiApiKey: TEST_KEY },
      server: {},
      storageDelay: 0,
    });

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
