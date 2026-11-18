import { jest } from "@jest/globals";

// The app puts the sign-in key guard on `window.fetch` when its entry module
// loads. This loads the real entry module and sends requests through
// `window.fetch` as the rest of the app does: without the installation this
// test fails.

const API_ORIGIN = "https://api.example.test";
const OTHER = "https://other.example.test";
const TEST_KEY = "sk-test-0000000000000000";
const withKey = { headers: { Authorization: `Bearer ${TEST_KEY}` } };

let network: jest.Mock<(input: any, init?: any) => Promise<any>>;
const sentTo = () => network.mock.calls.map(([input]) => String(input));

beforeAll(async () => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  // what the page had before the app loaded; it also answers the requests
  // for the server config and the built-in prompt lists
  network = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ en: [], tw: [], cn: [] }),
  }));
  window.fetch = network as unknown as typeof fetch;
  global.fetch = window.fetch;

  // the store first: the app pulls in the locales, which the store needs to
  // have loaded already
  const { useAccessStore } = await import("../app/store/access");
  await import("../app/components/home");
  await useAccessStore.getState().whenConfigLoaded();
  useAccessStore.getState().setLogin(TEST_KEY, API_ORIGIN);
  network.mockClear();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("after the app has loaded", () => {
  test("window.fetch is the guard, not what the page had before", () => {
    expect(window.fetch).not.toBe(network);
  });

  test("a request with the sign-in key to another site is not sent", async () => {
    const Locale = (await import("../app/locales")).default;

    await expect(
      window.fetch(`${OTHER}/v1/chat/completions`, withKey),
    ).rejects.toThrow(Locale.Login.KeyBlocked);
    expect(sentTo()).toEqual([]);
  });

  test("the same request to the API site of the sign-in goes out", async () => {
    await window.fetch(`${API_ORIGIN}/v1/chat/completions`, withKey);
    expect(sentTo()).toEqual([`${API_ORIGIN}/v1/chat/completions`]);
  });
});
