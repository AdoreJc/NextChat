import { fireEvent, render, screen } from "@testing-library/react";
import { jest } from "@jest/globals";

// the store first: the component pulls in the locales, which the store needs
// to have loaded already
import { useAccessStore } from "../app/store/access";
import { LoginNotice } from "../app/components/login";
import { LOGIN_STATE_STORAGE_KEY } from "../app/utils/login";

// The notice under a 401 reply: a text and a button. Showing it must not
// start the sign-in by itself, only the click does.

describe("stored state", () => {
  test("the server config waits for the state stored in the browser", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    // a key saved after this point is not overwritten by a late read
    await useAccessStore.getState().whenConfigLoaded();
    expect(useAccessStore.persist.hasHydrated()).toBe(true);
    expect(useAccessStore.getState()._hasHydrated).toBe(true);
    jest.restoreAllMocks();
  });
});

describe("sign-in notice under a rejected reply", () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAccessStore.setState({
      loginUrl: "https://api.example.test/chat-authorize",
      openaiApiKey: "sk-test-0000000000000000",
    });
    // jsdom reports the navigation it does not implement
    jest.spyOn(console, "error").mockImplementation(() => {});
    // the persisted store has no storage to write to in this test
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("shows the text and a sign-in button, and stays on the page", () => {
    const before = window.location.href;
    render(<LoginNotice text="sign-in expired" />);

    expect(screen.getByText("sign-in expired")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
    // nothing was started: no state was created, the address did not change
    expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).toBeNull();
    expect(window.location.href).toBe(before);
  });

  test("the click starts the sign-in", () => {
    render(<LoginNotice text="sign-in expired" />);
    fireEvent.click(screen.getByRole("button"));
    expect(sessionStorage.getItem(LOGIN_STATE_STORAGE_KEY)).toMatch(
      /^[A-Za-z0-9_-]{32,}$/,
    );
  });
});
