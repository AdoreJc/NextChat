/**
 * OpenPalm Chat: sign in through the API site.
 *
 * The chat site sends the browser to the authorize page of the API site
 * (`LOGIN_URL`) with a random `state`. The API site sends it back to
 * `<origin>/#/auth-callback?key=…&state=…`. The key is only stored when the
 * `state` matches the one this browser tab created, and a `state` can be used
 * once.
 *
 * Nothing in this file logs or reports the key.
 */
import { SINGLE_SITE } from "../config/site";

export const LOGIN_STATE_STORAGE_KEY = "login-state";
// hash routes of the sign-in pages
export const LOGIN_PATH = "/login";
export const AUTH_CALLBACK_PATH = "/auth-callback";

const STATE_BYTES = 32;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
// printable ASCII without spaces
const KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;

type StateStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type AccessLike = { loginUrl?: string; openaiApiKey?: string };

function stateStorage(): StateStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** the authorize page, or "" when sign-in is not configured or not usable */
export function getLoginUrl(access: AccessLike, singleSite = SINGLE_SITE) {
  if (!singleSite) return "";
  const raw = (access.loginUrl ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function isLoginEnabled(access: AccessLike, singleSite = SINGLE_SITE) {
  return getLoginUrl(access, singleSite) !== "";
}

/** sign-in is configured and this browser holds no key */
export function needsLogin(access: AccessLike, singleSite = SINGLE_SITE) {
  return isLoginEnabled(access, singleSite) && !access.openaiApiKey;
}

/** 43 characters of `[A-Za-z0-9_-]` from 32 random bytes */
export function createLoginState() {
  const bytes = new Uint8Array(STATE_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** `<LOGIN_URL>?redirect_uri=<origin + "/">&state=<state>` */
export function buildAuthorizeUrl(
  loginUrl: string,
  origin: string,
  state: string,
) {
  const url = new URL(loginUrl);
  url.searchParams.set("redirect_uri", origin + "/");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Leave for the authorize page. Returns false when sign-in is not configured.
 * `replace` keeps the current entry (the `#/login` route) out of the history.
 */
export function startLogin(
  access: AccessLike,
  options: {
    replace?: boolean;
    singleSite?: boolean;
    storage?: StateStorage | null;
    location?: Pick<Location, "origin" | "assign" | "replace">;
  } = {},
) {
  const loginUrl = getLoginUrl(access, options.singleSite ?? SINGLE_SITE);
  const storage =
    options.storage === undefined ? stateStorage() : options.storage;
  if (!loginUrl || !storage) return false;

  const location = options.location ?? window.location;
  const state = createLoginState();
  storage.setItem(LOGIN_STATE_STORAGE_KEY, state);

  const target = buildAuthorizeUrl(loginUrl, location.origin, state);
  if (options.replace) {
    location.replace(target);
  } else {
    location.assign(target);
  }
  return true;
}

export type AuthCallbackParams = {
  key: string;
  state: string;
  error: string;
};

/** `#/auth-callback?key=…&state=…` → its parameters; null for other hashes */
export function parseAuthCallbackHash(hash: string): AuthCallbackParams | null {
  const route = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryStart = route.indexOf("?");
  const path = queryStart < 0 ? route : route.slice(0, queryStart);
  if (path !== AUTH_CALLBACK_PATH || queryStart < 0) return null;

  const params = new URLSearchParams(route.slice(queryStart + 1));
  return {
    key: params.get("key") ?? "",
    state: params.get("state") ?? "",
    error: params.get("error") ?? "",
  };
}

let captured: AuthCallbackParams | null = null;

type CallbackWindow = {
  location: Pick<Location, "hash" | "pathname" | "search">;
  history: Pick<History, "replaceState" | "state">;
};

/** rewrite the current history entry so the address holds no parameters */
function cleanAddress(win: CallbackWindow) {
  // the framework wraps `history.replaceState` on the instance and that
  // wrapper fails on entries without a state; use the browser's own method
  const replaceState =
    typeof History !== "undefined" && win.history instanceof History
      ? History.prototype.replaceState
      : win.history.replaceState;
  replaceState.call(
    win.history,
    win.history.state ?? {},
    "",
    win.location.pathname + win.location.search + "#" + AUTH_CALLBACK_PATH,
  );
}

/**
 * Move the callback parameters out of the address bar into memory. Runs once
 * while the page loads, before the app renders, so the key never stays in the
 * URL or in the history entry.
 */
export function captureAuthCallback(win: CallbackWindow = window) {
  const params = parseAuthCallbackHash(win.location.hash);
  if (!params) return;
  captured = params;
  cleanAddress(win);
}

/**
 * The parameters captured while the page loaded; they can be taken once.
 *
 * The API site sends the browser back with a full page load. Parameters that
 * show up in the address of an already running page did not come that way:
 * they are removed from the address and dropped ("dropped").
 */
export function takeAuthCallback(
  win: CallbackWindow = window,
): AuthCallbackParams | "dropped" | null {
  const inAddress = parseAuthCallbackHash(win.location.hash) !== null;
  if (inAddress) cleanAddress(win);

  const params = captured;
  captured = null;
  if (!params && inAddress) return "dropped";
  return params;
}

export type LoginFailure =
  | "state_mismatch"
  | "access_denied"
  | "server_error"
  | "invalid_response";

export type LoginResult = { ok: true } | { ok: false; reason: LoginFailure };

/**
 * Check a callback against the `state` this tab created and store the key.
 * The stored `state` is dropped before anything else, so it works once.
 * No confirm dialog: the `state` check is what proves this browser asked.
 */
export function completeLogin(
  params: AuthCallbackParams,
  deps: {
    saveKey: (key: string) => void;
    storage?: StateStorage | null;
  },
): LoginResult {
  const storage = deps.storage === undefined ? stateStorage() : deps.storage;
  const expected = storage?.getItem(LOGIN_STATE_STORAGE_KEY) ?? "";
  storage?.removeItem(LOGIN_STATE_STORAGE_KEY);

  if (
    !STATE_PATTERN.test(expected) ||
    !params.state ||
    params.state !== expected
  ) {
    return { ok: false, reason: "state_mismatch" };
  }

  if (params.error) {
    return {
      ok: false,
      reason:
        params.error === "access_denied" ? "access_denied" : "server_error",
    };
  }

  if (!KEY_PATTERN.test(params.key)) {
    return { ok: false, reason: "invalid_response" };
  }

  deps.saveKey(params.key);
  return { ok: true };
}

/**
 * What to show under a chat message that reports a rejected or missing key.
 * It is only a notice with a button, the page never leaves on its own.
 */
export function loginNoticeFor(
  messageText: string,
  unauthorizedText: string,
  access: AccessLike,
  singleSite = SINGLE_SITE,
): "expired" | "required" | null {
  if (!isLoginEnabled(access, singleSite)) return null;
  if (!unauthorizedText || !messageText.includes(unauthorizedText)) return null;
  return access.openaiApiKey ? "expired" : "required";
}

/**
 * The old `/#/?settings={"key":…,"url":…}` link. It has no `state` check, so
 * it is ignored once sign-in is configured; otherwise it works as before
 * (asks first, then fills in key and endpoint).
 */
export async function importSettingsLink(
  text: string,
  deps: {
    loginEnabled: boolean;
    confirm: (payload: { key?: string; url?: string }) => Promise<boolean>;
    apply: (payload: { key?: string; url?: string }) => void;
  },
): Promise<"ignored" | "invalid" | "empty" | "declined" | "imported"> {
  if (deps.loginEnabled) return "ignored";

  let payload: { key?: string; url?: string };
  try {
    payload = JSON.parse(text);
  } catch {
    return "invalid";
  }
  if (!payload || (!payload.key && !payload.url)) return "empty";
  if (!(await deps.confirm(payload))) return "declined";
  deps.apply(payload);
  return "imported";
}
