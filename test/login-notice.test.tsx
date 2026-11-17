import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { webcrypto } from "node:crypto";

// the store first: the component pulls in the locales, which the store needs
// to have loaded already
import { useAccessStore } from "../app/store/access";
import { LoginNotice } from "../app/components/login";
import { ApiPath } from "../app/constant";
import {
  importKeepingAccess,
  LOGIN_STATE_STORAGE_KEY,
} from "../app/utils/login";

const LOGIN_URL = "https://api.example.test/chat-authorize";
const API_ORIGIN = "https://api.example.test";
const TEST_KEY = "sk-test-0000000000000000";

beforeAll(() => {
  // the test environment has no SubtleCrypto of its own
  if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, "subtle", {
      value: webcrypto.subtle,
      configurable: true,
    });
  }
});

beforeAll(() => {
  // the stores this file ends up loading ask for the server config and the
  // built-in prompt lists
  global.fetch = jest.fn(async () => ({
    json: async () => ({ en: [], tw: [], cn: [] }),
  })) as unknown as typeof fetch;
});

beforeEach(() => {
  // jsdom reports the navigation it does not implement
  jest.spyOn(console, "error").mockImplementation(() => {});
  // the persisted store has no storage to write to in this test
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("stored state", () => {
  test("the server config waits for the state stored in the browser", async () => {
    // a key saved after this point is not overwritten by a late read
    await useAccessStore.getState().whenConfigLoaded();
    expect(useAccessStore.persist.hasHydrated()).toBe(true);
    expect(useAccessStore.getState()._hasHydrated).toBe(true);
  });
});

describe("where requests go after signing in", () => {
  test("every sign-in stores the key and points the endpoint at the API site", () => {
    // whatever this browser had stored before
    useAccessStore.setState({
      openaiApiKey: "sk-old-0000",
      openaiUrl: "https://somewhere-else.example.test",
      useCustomConfig: false,
      loginAt: 0,
    });

    const before = Date.now();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);

    const access = useAccessStore.getState();
    expect(access.openaiApiKey).toBe(TEST_KEY);
    expect(access.openaiUrl).toBe(API_ORIGIN);
    expect(access.useCustomConfig).toBe(true);
    expect(access.loginAt).toBeGreaterThanOrEqual(before);
  });

  test("chat, title, summary and model list requests go straight to the API site", async () => {
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    const { ChatGPTApi } = await import("../app/client/platforms/openai");
    const { OpenaiPath } = await import("../app/constant");
    const api = new ChatGPTApi();

    // title and summary use the chat path as well
    expect(api.path(OpenaiPath.ChatPath)).toBe(
      `${API_ORIGIN}/v1/chat/completions`,
    );
    expect(api.path(OpenaiPath.ListModelPath)).toBe(`${API_ORIGIN}/v1/models`);
    expect(api.path(OpenaiPath.ImagePath)).toBe(
      `${API_ORIGIN}/v1/images/generations`,
    );
  });

  test("signing out clears the key and restores the default endpoint", () => {
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    useAccessStore.getState().logout();

    const access = useAccessStore.getState();
    expect(access.openaiApiKey).toBe("");
    expect(access.openaiUrl).toBe(ApiPath.OpenAI);
    expect(access.loginAt).toBe(0);
  });
});

describe("importing local data while sign-in is configured", () => {
  const ELSEWHERE = "https://elsewhere.example.test";

  // what "import" in the settings does with a backup file, minus the file
  // dialog: merge the file into the local state and write it to the stores
  async function importBackup(change: Record<string, unknown>) {
    const { getLocalAppState, mergeAppState, setLocalAppState } = await import(
      "../app/utils/sync"
    );
    const { StoreKey } = await import("../app/constant");
    const backup = JSON.parse(JSON.stringify(getLocalAppState()));
    Object.assign(backup[StoreKey.Access], change, {
      lastUpdateTime: Date.now() + 60_000,
    });
    const local = getLocalAppState();
    mergeAppState(local, backup);
    setLocalAppState(local);
  }

  async function chatPath() {
    const { ChatGPTApi } = await import("../app/client/platforms/openai");
    const { OpenaiPath } = await import("../app/constant");
    return new ChatGPTApi().path(OpenaiPath.ChatPath);
  }

  test("a backup that only changes the endpoint does not move the requests", async () => {
    useAccessStore.setState({ loginUrl: LOGIN_URL });
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);

    await importKeepingAccess(
      () => importBackup({ openaiUrl: ELSEWHERE }),
      useAccessStore,
      true,
    );

    const access = useAccessStore.getState();
    expect(access.openaiUrl).toBe(API_ORIGIN);
    expect(access.openaiApiKey).toBe(TEST_KEY);
    expect(await chatPath()).toBe(`${API_ORIGIN}/v1/chat/completions`);
  });

  test("nor does a backup that changes the login url, the key or the endpoint switch", async () => {
    useAccessStore.setState({ loginUrl: LOGIN_URL });
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);

    await importKeepingAccess(
      () =>
        importBackup({
          loginUrl: `${ELSEWHERE}/chat-authorize`,
          openaiApiKey: "sk-from-a-file",
          useCustomConfig: false,
          loginAt: 0,
        }),
      useAccessStore,
      true,
    );

    const access = useAccessStore.getState();
    expect(access.loginUrl).toBe(LOGIN_URL);
    expect(access.openaiApiKey).toBe(TEST_KEY);
    expect(await chatPath()).toBe(`${API_ORIGIN}/v1/chat/completions`);
  });

  test("the unguarded import is what moves them (the guard is what holds)", async () => {
    useAccessStore.setState({ loginUrl: LOGIN_URL });
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);

    await importBackup({ openaiUrl: ELSEWHERE });
    expect(await chatPath()).toBe(`${ELSEWHERE}/v1/chat/completions`);
  });

  test("without sign-in the import works as before", async () => {
    useAccessStore.setState({ loginUrl: "", loginAt: 0 });

    await importKeepingAccess(
      () => importBackup({ openaiUrl: ELSEWHERE, useCustomConfig: true }),
      useAccessStore,
      true,
    );
    expect(useAccessStore.getState().openaiUrl).toBe(ELSEWHERE);
  });
});

describe("sign-in notice under a rejected reply", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAccessStore.setState({ loginUrl: LOGIN_URL, openaiApiKey: TEST_KEY });
  });

  test("shows the text and a sign-in button, and stays on the page", async () => {
    const before = window.location.href;
    render(<LoginNotice text="sign-in expired" />);

    expect(screen.getByText("sign-in expired")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
    // give anything that might have been started time to show
    await new Promise((resolve) => setTimeout(resolve, 50));
    // nothing was started: no state was created, the address did not change
    expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).toBeNull();
    expect(window.location.href).toBe(before);
  });

  test("the click starts the sign-in", async () => {
    render(<LoginNotice text="sign-in expired" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).not.toBeNull(),
    );
    const pending = JSON.parse(
      sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)!,
    );
    expect(pending.state).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });
});
