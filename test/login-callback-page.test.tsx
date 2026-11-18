import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { jest } from "@jest/globals";
import { webcrypto } from "node:crypto";

// the store first: the component pulls in the locales, which the store needs
// to have loaded already
import { useAccessStore } from "../app/store/access";
import {
  captureAuthCallback,
  EXCHANGE_PATH,
  LOGIN_STATE_STORAGE_KEY,
} from "../app/utils/login";

// The page the API site sends the browser back to, when the exchange of the
// one-time code is refused: it shows the reason, offers "retry" and does not
// start another sign-in by itself.

const LOGIN_URL = "https://api.example.test/chat-authorize";
const API_ORIGIN = "https://api.example.test";
const STATE = "s".repeat(43);
const REASON = "token limit reached <b>for this account</b>";

let fetchMock: jest.MockedFunction<(url: any, init?: any) => Promise<any>>;
let reported: jest.SpiedFunction<typeof console.error>;

const exchangeCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === API_ORIGIN + EXCHANGE_PATH);

let AuthCallbackPage: typeof import("../app/components/login").AuthCallbackPage;

beforeAll(async () => {
  // icons are plain file objects in the test environment; turn the one the
  // page uses into something React can render
  const icon = (await import("../app/icons/nextchat-bot.svg")).default;
  Object.assign(
    icon,
    forwardRef(() => null),
  );
  ({ AuthCallbackPage } = await import("../app/components/login"));

  // the test environment has no SubtleCrypto of its own
  if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, "subtle", {
      value: webcrypto.subtle,
      configurable: true,
    });
  }
});

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  // a navigation is the one thing the test page cannot do: it reports it
  reported = jest.spyOn(console, "error").mockImplementation(() => {});

  fetchMock = jest.fn(async (url: any) => {
    if (url === "/api/config") {
      return { json: async () => ({ loginUrl: LOGIN_URL }) };
    }
    if (url === API_ORIGIN + EXCHANGE_PATH) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          message: REASON,
          code: "invalid_grant",
        }),
      };
    }
    return { json: async () => ({}) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  sessionStorage.clear();
});

test("a refused exchange shows the reason and a retry button, and does not sign in again by itself", async () => {
  // the browser arrives with a code and the state this tab created
  sessionStorage.setItem(
    LOGIN_STATE_STORAGE_KEY,
    JSON.stringify({ state: STATE, verifier: "v".repeat(43) }),
  );
  window.location.hash = `#/auth-callback?code=one-time-code-0000000000&state=${STATE}`;
  captureAuthCallback();

  const { container } = render(
    <MemoryRouter initialEntries={["/auth-callback"]}>
      <AuthCallbackPage />
    </MemoryRouter>,
  );

  // the reason the API site gave, as text
  await waitFor(() => expect(screen.getByText(REASON)).toBeInTheDocument());
  expect(container.querySelector("b")).toBeNull();
  expect(exchangeCalls()).toHaveLength(1);
  expect(useAccessStore.getState().openaiApiKey).toBe("");

  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(2); // retry, back to chat

  // left alone, the page stays as it is: no second exchange, no new pending
  // sign-in, no navigation
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(exchangeCalls()).toHaveLength(1);
  expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).toBeNull();
  expect(reported).not.toHaveBeenCalled();
  expect(screen.getByText(REASON)).toBeInTheDocument();

  // "retry" is what starts a sign-in (and the checks above do notice one)
  fireEvent.click(buttons[0]);
  await waitFor(() =>
    expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).not.toBeNull(),
  );
  await waitFor(() => expect(reported).toHaveBeenCalled());
});
