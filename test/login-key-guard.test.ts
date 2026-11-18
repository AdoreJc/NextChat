import { jest } from "@jest/globals";

// the store first: the client pulls in the locales, which the store needs to
// have loaded already
import { useAccessStore } from "../app/store/access";
import { useChatStore } from "../app/store/chat";
import { ChatGPTApi } from "../app/client/platforms/openai";
import { ApiPath, ServiceProvider } from "../app/constant";
import {
  installLoginKeyGuard,
  keyBlockedText,
  mayCarryLoginKey,
} from "../app/utils/login";

// A key received through sign-in belongs to the API site it came from.
// Three layers keep it there: the single-site client only knows one endpoint,
// signing in and out clears the settings of the other providers, and a guard
// in front of every request refuses to send the key anywhere else.

const LOGIN_URL = "https://api.example.test/chat-authorize";
const API_ORIGIN = "https://api.example.test";
const OTHER = "https://other.example.test";
const TEST_KEY = "sk-test-0000000000000000";
const BLOCKED = "not sent: wrong destination";
const PAGE = "https://chat.example.test/#/chat";

const signedIn = {
  openaiApiKey: TEST_KEY,
  loginAt: 1_000,
  loginOrigin: API_ORIGIN,
  loginUrl: LOGIN_URL,
};
const withKey: [string, string][] = [["Authorization", `Bearer ${TEST_KEY}`]];

/** every request the page tries to send: [url, headers as text] */
let sent: [string, string][];
let guardedFetch: typeof fetch;

function useNetwork() {
  sent = [];
  const network = jest.fn(async (input: any, init?: any) => {
    sent.push([String(input), JSON.stringify(init?.headers ?? {})]);
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }),
    };
  });
  const win = {
    fetch: network as unknown as typeof fetch,
    location: { href: PAGE },
  };
  guardedFetch = installLoginKeyGuard(
    win,
    () => useAccessStore.getState(),
    () => BLOCKED,
  );
  // the app sends through window.fetch
  window.fetch = guardedFetch;
  global.fetch = guardedFetch;
  return network;
}

/** one chat request without streaming, as the chat page makes it */
function chat(providerName: ServiceProvider) {
  return new Promise<{ message?: unknown; error?: Error }>((resolve) => {
    new ChatGPTApi().chat({
      messages: [{ role: "user", content: "hello" }],
      config: { model: "gpt-4o", providerName, stream: false },
      onFinish: (message: unknown) => resolve({ message }),
      onError: (error: Error) => resolve({ error }),
    } as any);
  });
}

/** what was sent, without the server config request (it carries no key) */
const requests = () =>
  sent.map(([url]) => url).filter((url) => url !== "/api/config");
const origins = () => [
  ...new Set(sent.map(([url]) => new URL(url, PAGE).origin)),
];
const keyWentTo = () =>
  sent
    .filter(([url, headers]) => (url + headers).includes(TEST_KEY))
    .map(([url]) => new URL(url, PAGE).origin);

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  useAccessStore.setState({ loginUrl: LOGIN_URL });
  useAccessStore.getState().logout();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the guard", () => {
  test("lets the key go to the origin recorded at sign-in", () => {
    for (const url of [
      `${API_ORIGIN}/v1/chat/completions`,
      `${API_ORIGIN}/v1/models?x=1`,
      API_ORIGIN,
    ]) {
      expect(mayCarryLoginKey(url, withKey, signedIn, PAGE)).toBe(true);
    }
  });

  test("refuses another origin", () => {
    for (const url of [
      `${OTHER}/v1/chat/completions`,
      // same host, other scheme or port
      "http://api.example.test/v1/chat/completions",
      "https://api.example.test:8443/v1/chat/completions",
      // looks alike
      "https://api.example.test.other.example.test/v1/models",
      `${OTHER}/?next=${API_ORIGIN}`,
    ]) {
      expect(mayCarryLoginKey(url, withKey, signedIn, PAGE)).toBe(false);
    }
  });

  test("refuses an address that cannot be read", () => {
    expect(mayCarryLoginKey("https://", withKey, signedIn, PAGE)).toBe(false);
    expect(mayCarryLoginKey("http://[bad", withKey, signedIn, PAGE)).toBe(
      false,
    );
  });

  test("refuses a relative address: that is this site, not the API site", () => {
    for (const url of ["/api/openai/v1/chat/completions", "v1/models", ""]) {
      expect(mayCarryLoginKey(url, withKey, signedIn, PAGE)).toBe(false);
    }
  });

  test("also sees the key in other headers and in the address", () => {
    expect(
      mayCarryLoginKey(`${OTHER}/x`, [["api-key", TEST_KEY]], signedIn, PAGE),
    ).toBe(false);
    expect(
      mayCarryLoginKey(`${OTHER}/x?key=${TEST_KEY}`, [], signedIn, PAGE),
    ).toBe(false);
  });

  test("falls back to the origin of the login url, and refuses without either", () => {
    const noOrigin = { ...signedIn, loginOrigin: "" };
    expect(
      mayCarryLoginKey(`${API_ORIGIN}/v1/models`, withKey, noOrigin, PAGE),
    ).toBe(true);
    expect(
      mayCarryLoginKey(`${OTHER}/v1/models`, withKey, noOrigin, PAGE),
    ).toBe(false);
    expect(
      mayCarryLoginKey(
        `${API_ORIGIN}/v1/models`,
        withKey,
        { ...noOrigin, loginUrl: "" },
        PAGE,
      ),
    ).toBe(false);
  });

  test("does not look at requests without the key", () => {
    expect(mayCarryLoginKey("/api/config", [], signedIn, PAGE)).toBe(true);
    expect(
      mayCarryLoginKey(
        `${OTHER}/x`,
        [["Authorization", "Bearer something-else"]],
        signedIn,
        PAGE,
      ),
    ).toBe(true);
  });

  test("does not apply while the key did not come from a sign-in", () => {
    const typedIn = { openaiApiKey: TEST_KEY, loginAt: 0 };
    expect(mayCarryLoginKey(`${OTHER}/v1/models`, withKey, typedIn, PAGE)).toBe(
      true,
    );
    expect(
      mayCarryLoginKey("/api/openai/v1/models", withKey, typedIn, PAGE),
    ).toBe(true);
    expect(mayCarryLoginKey(`${OTHER}/x`, withKey, {}, PAGE)).toBe(true);
  });

  test("in front of fetch: a refused request is not sent and fails readably", async () => {
    const network = useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    const headers = { Authorization: `Bearer ${TEST_KEY}` };

    await expect(
      guardedFetch(`${OTHER}/v1/chat/completions`, { headers }),
    ).rejects.toThrow(BLOCKED);
    await expect(
      guardedFetch("/api/openai/v1/chat/completions", { headers }),
    ).rejects.toThrow(BLOCKED);
    expect(network).not.toHaveBeenCalled();

    // allowed requests go out unchanged
    await guardedFetch(`${API_ORIGIN}/v1/models`, { headers });
    await guardedFetch("/api/config", { method: "post" });
    expect(sent.map(([url]) => url)).toEqual([
      `${API_ORIGIN}/v1/models`,
      "/api/config",
    ]);
  });

  test("reads the address once: what is checked is what is sent", async () => {
    useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    const headers = { Authorization: `Bearer ${TEST_KEY}` };
    // an address that reads differently every time it is turned into text
    const answers = [`${API_ORIGIN}/v1/models`, `${OTHER}/v1/models`];
    const address = { toString: () => answers.shift() ?? `${OTHER}/later` };

    await guardedFetch(address as unknown as string, { headers });

    expect(sent.map(([url]) => url)).toEqual([`${API_ORIGIN}/v1/models`]);
    expect(answers).toHaveLength(1);
  });

  test("a request that cannot be read is not sent", async () => {
    const network = useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    const address = {
      toString() {
        throw new Error("no address");
      },
    };

    await expect(guardedFetch(address as unknown as string)).rejects.toThrow(
      "no address",
    );
    expect(network).not.toHaveBeenCalled();
  });

  test("a refused request can be told from any other failure", async () => {
    useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    const refused = await guardedFetch(`${OTHER}/v1/models`, {
      headers: { Authorization: `Bearer ${TEST_KEY}` },
    }).catch((error) => error);

    expect(keyBlockedText(refused)).toBe(BLOCKED);
    expect(keyBlockedText(new Error(BLOCKED))).toBeUndefined();
    expect(keyBlockedText(new TypeError("Failed to fetch"))).toBeUndefined();
    expect(keyBlockedText(undefined)).toBeUndefined();
    expect(keyBlockedText("text")).toBeUndefined();
  });
});

describe("signing in and out", () => {
  const leftovers = {
    provider: ServiceProvider.Azure,
    azureUrl: `${OTHER}/azure`,
    azureApiKey: "azure-key",
    azureApiVersion: "2024-01-01",
    googleUrl: `${OTHER}/google`,
    googleApiKey: "google-key",
    anthropicUrl: `${OTHER}/anthropic`,
    anthropicApiKey: "anthropic-key",
    deepseekUrl: `${OTHER}/deepseek`,
    siliconflowApiKey: "siliconflow-key",
    ai302Url: `${OTHER}/302`,
  };
  const defaults = {
    provider: ServiceProvider.OpenAI,
    azureUrl: "",
    azureApiKey: "",
    azureApiVersion: "2023-08-01-preview",
    googleUrl: ApiPath.Google,
    googleApiKey: "",
    anthropicUrl: ApiPath.Anthropic,
    anthropicApiKey: "",
    deepseekUrl: ApiPath.DeepSeek,
    siliconflowApiKey: "",
    ai302Url: ApiPath["302.AI"],
  };
  const pick = () => {
    const state = useAccessStore.getState() as unknown as Record<
      string,
      unknown
    >;
    return Object.fromEntries(Object.keys(leftovers).map((k) => [k, state[k]]));
  };

  test("signing in clears what other providers left behind and records the API site", () => {
    useAccessStore.setState(leftovers);
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);

    expect(pick()).toEqual(defaults);
    expect(useAccessStore.getState().loginOrigin).toBe(API_ORIGIN);
    expect(JSON.stringify(useAccessStore.getState())).not.toContain(OTHER);
  });

  test("so does signing out", () => {
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    useAccessStore.setState(leftovers);
    useAccessStore.getState().logout();

    expect(pick()).toEqual(defaults);
    expect(useAccessStore.getState().loginOrigin).toBe("");
    expect(JSON.stringify(useAccessStore.getState())).not.toContain(OTHER);
  });
});

describe("a conversation and settings of another provider, left in this browser", () => {
  const azure = {
    provider: ServiceProvider.Azure,
    azureUrl: `${OTHER}/azure`,
    azureApiKey: "azure-key",
    azureApiVersion: "2024-01-01",
    useCustomConfig: true,
  };

  function useAzureConversation() {
    useChatStore
      .getState()
      .updateTargetSession(
        useChatStore.getState().currentSession(),
        (session) => {
          session.mask.modelConfig.providerName = ServiceProvider.Azure;
        },
      );
  }

  test("after signing in, a message in that conversation only goes to the API site", async () => {
    useNetwork();
    useAccessStore.setState(azure);
    useAzureConversation();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);

    const result = await chat(ServiceProvider.Azure);

    expect(result.error).toBeUndefined();
    expect(requests()).toEqual([`${API_ORIGIN}/v1/chat/completions`]);
    expect(keyWentTo()).toEqual([API_ORIGIN]);
  });

  test("the client has no other address, even with such settings back in place", async () => {
    useNetwork();
    useAzureConversation();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    // as if something had put them back after the sign-in
    useAccessStore.setState(azure);

    expect(
      new ChatGPTApi().path(
        "openai/deployments/gpt-4o/chat/completions?api-version=2024-01-01",
      ),
    ).toMatch(new RegExp(`^${API_ORIGIN}/`));

    await chat(ServiceProvider.Azure);
    expect(requests().map((url) => new URL(url).origin)).toEqual([API_ORIGIN]);
    expect(keyWentTo()).toEqual([API_ORIGIN]);
  });

  test("if the endpoint itself points elsewhere, the request is refused, not sent", async () => {
    useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    // as if something had changed the endpoint after the sign-in
    useAccessStore.setState({ openaiUrl: OTHER });

    const result = await chat(ServiceProvider.OpenAI);

    expect(result.error?.message).toBe(BLOCKED);
    expect(requests()).toEqual([]);

    // and through this site's own server
    useAccessStore.setState({ openaiUrl: ApiPath.OpenAI });
    expect((await chat(ServiceProvider.OpenAI)).error?.message).toBe(BLOCKED);
    expect(requests()).toEqual([]);
  });

  test("the model list request is covered as well", async () => {
    useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    useAccessStore.setState({ openaiUrl: OTHER });

    const { useSiteModels } = await import("../app/store/site-models");
    await useSiteModels.getState().refresh();
    expect(requests()).toEqual([]);
    expect(useSiteModels.getState().ids).toBeNull();
  });
});

describe("what the conversation shows", () => {
  /** send a message as the chat page does, wait for the reply to settle */
  async function send(text: string) {
    await useChatStore.getState().onUserInput(text);
    const last = () => useChatStore.getState().currentSession().messages.at(-1);
    for (let i = 0; i < 400 && last()?.streaming; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return last();
  }

  test("a refused request is explained in plain words, not as a code block", async () => {
    useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    useAccessStore.setState({ openaiUrl: OTHER });

    const reply = await send("hello");

    expect(reply?.role).toBe("assistant");
    expect(reply?.isError).toBe(true);
    expect(String(reply?.content).trim()).toBe(BLOCKED);
    expect(requests()).toEqual([]);
  });

  test("any other failure is shown as before", async () => {
    const network = useNetwork();
    useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
    network.mockRejectedValue(new TypeError("Failed to fetch"));

    const reply = await send("hello");

    expect(reply?.isError).toBe(true);
    expect(reply?.content).toContain("```json");
    expect(reply?.content).toContain("Failed to fetch");
  });
});

describe("without a sign-in nothing changes", () => {
  test("a key typed into the settings goes to the endpoint typed there", async () => {
    useNetwork();
    useAccessStore.setState({
      loginUrl: "",
      openaiApiKey: TEST_KEY,
      openaiUrl: OTHER,
      useCustomConfig: true,
    });

    const result = await chat(ServiceProvider.OpenAI);

    expect(result.error).toBeUndefined();
    expect(requests()).toEqual([`${OTHER}/v1/chat/completions`]);
  });

  test("and through this site's server with the default endpoint", async () => {
    useNetwork();
    useAccessStore.setState({
      loginUrl: "",
      openaiApiKey: TEST_KEY,
      openaiUrl: ApiPath.OpenAI,
      useCustomConfig: true,
    });

    await chat(ServiceProvider.OpenAI);
    expect(requests()).toEqual([`${ApiPath.OpenAI}/v1/chat/completions`]);
  });
});

describe("the multi-provider build", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SINGLE_SITE;

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SINGLE_SITE;
    else process.env.NEXT_PUBLIC_SINGLE_SITE = ORIGINAL;
    jest.resetModules();
  });

  test("still uses the Azure address and keeps the other providers' settings", async () => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SINGLE_SITE = "0";
    // that build loads its plugin and prompt lists when the stores start
    window.fetch = global.fetch = jest.fn(async (url: any) => ({
      json: async () =>
        String(url).includes("plugins") ? [] : { en: [], tw: [], cn: [] },
      text: async () => "",
    })) as unknown as typeof fetch;
    const { useAccessStore: store } = await import("../app/store/access");
    const { ChatGPTApi: Api } = await import("../app/client/platforms/openai");
    const azure = {
      useCustomConfig: true,
      azureUrl: `${OTHER}/azure`,
      azureApiKey: "azure-key",
      azureApiVersion: "2024-01-01",
    };
    store.setState(azure);

    const path =
      "openai/deployments/gpt-4o/chat/completions?api-version=2024-01-01";
    expect(new Api().path(path)).toBe(`${OTHER}/azure/${path}`);

    store.getState().logout();
    expect(store.getState().azureUrl).toBe(azure.azureUrl);
    expect(store.getState().azureApiKey).toBe(azure.azureApiKey);
  });
});
