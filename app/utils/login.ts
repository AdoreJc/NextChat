/**
 * OpenPalm Chat: sign in through the API site (authorization code + PKCE).
 *
 * The chat site sends the browser to the authorize page of the API site
 * (`LOGIN_URL`) with a random `state` and the SHA-256 of a random
 * `code_verifier`. The API site sends it back to
 * `<origin>/#/auth-callback?code=…&state=…`. When the `state` matches the one
 * this browser tab created, the one-time code and the verifier are exchanged
 * for the key with one cross-origin request. The key is never part of an
 * address; a `key` parameter in the callback is ignored.
 *
 * After that the browser talks to the API site directly.
 *
 * Nothing in this file logs or reports the key, the code or the verifier.
 */
import { SINGLE_SITE } from "../config/site";

export const LOGIN_STATE_STORAGE_KEY = "login-state";
// hash routes of the sign-in pages
export const LOGIN_PATH = "/login";
export const AUTH_CALLBACK_PATH = "/auth-callback";
// on the origin of LOGIN_URL
export const EXCHANGE_PATH = "/api/chat-authorize/exchange";

const TOKEN_BYTES = 32;
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
// printable ASCII without spaces
const CODE_PATTERN = /^[\x21-\x7e]{1,512}$/;
const KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;

type StateStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type AccessLike = {
  loginUrl?: string;
  openaiApiKey?: string;
  loginAt?: number;
};

function stateStorage(): StateStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * A usable authorize page address, or "". It has to be `https`; plain `http`
 * is only accepted for `localhost` and `127.0.0.1` (local development).
 */
export function normalizeLoginUrl(raw: string | undefined | null) {
  const text = (raw ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local)) {
      return url.toString();
    }
    return "";
  } catch {
    return "";
  }
}

/** the authorize page, or "" when sign-in is not configured or not usable */
export function getLoginUrl(access: AccessLike, singleSite = SINGLE_SITE) {
  if (!singleSite) return "";
  return normalizeLoginUrl(access.loginUrl);
}

/** the API site: the origin of the authorize page */
export function getApiOrigin(loginUrl: string) {
  return new URL(loginUrl).origin;
}

export function isLoginEnabled(access: AccessLike, singleSite = SINGLE_SITE) {
  return getLoginUrl(access, singleSite) !== "";
}

/** sign-in is configured and this browser holds no key */
export function needsLogin(access: AccessLike, singleSite = SINGLE_SITE) {
  return isLoginEnabled(access, singleSite) && !access.openaiApiKey;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 43 characters of `[A-Za-z0-9_-]` from 32 random bytes */
function randomToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function createLoginState() {
  return randomToken();
}

export function createCodeVerifier() {
  return randomToken();
}

/** PKCE S256: base64url without padding of SHA-256(verifier as ASCII) */
export async function codeChallengeFor(
  verifier: string,
  subtle: Pick<SubtleCrypto, "digest"> = crypto.subtle,
) {
  const ascii = new Uint8Array(verifier.length);
  for (let i = 0; i < verifier.length; i++) ascii[i] = verifier.charCodeAt(i);
  return base64Url(new Uint8Array(await subtle.digest("SHA-256", ascii)));
}

/**
 * `<LOGIN_URL>?redirect_uri=<origin + "/">&state=…&code_challenge=…
 * &code_challenge_method=S256`
 */
export function buildAuthorizeUrl(
  loginUrl: string,
  origin: string,
  state: string,
  codeChallenge: string,
) {
  const url = new URL(loginUrl);
  url.searchParams.set("redirect_uri", origin + "/");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type PendingLogin = { state: string; verifier: string };

/** the pending sign-in of this tab; reading it also drops it */
function takePendingLogin(storage: StateStorage | null): PendingLogin | null {
  const raw = storage?.getItem(LOGIN_STATE_STORAGE_KEY) ?? "";
  storage?.removeItem(LOGIN_STATE_STORAGE_KEY);
  try {
    const pending = JSON.parse(raw) as Partial<PendingLogin>;
    if (
      typeof pending?.state === "string" &&
      typeof pending?.verifier === "string" &&
      STATE_PATTERN.test(pending.state) &&
      VERIFIER_PATTERN.test(pending.verifier)
    ) {
      return { state: pending.state, verifier: pending.verifier };
    }
  } catch {}
  return null;
}

/** drop the pending sign-in (state and verifier) without using it */
export function dropPendingLogin(storage?: StateStorage | null) {
  takePendingLogin(storage === undefined ? stateStorage() : storage);
}

/**
 * Leave for the authorize page. Resolves to false when sign-in is not
 * configured or not possible in this browser. `replace` keeps the current
 * entry (the `#/login` route) out of the history.
 */
export async function startLogin(
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
  const verifier = createCodeVerifier();
  let challenge: string;
  try {
    challenge = await codeChallengeFor(verifier);
  } catch {
    return false;
  }
  // state and verifier are stored together and dropped together
  storage.setItem(LOGIN_STATE_STORAGE_KEY, JSON.stringify({ state, verifier }));

  const target = buildAuthorizeUrl(loginUrl, location.origin, state, challenge);
  if (options.replace) {
    location.replace(target);
  } else {
    location.assign(target);
  }
  return true;
}

export type AuthCallbackParams = {
  code: string;
  state: string;
  error: string;
};

/**
 * `#/auth-callback?code=…&state=…` → its parameters; null for other hashes.
 * Only `code`, `state` and `error` are read: a `key` parameter is ignored.
 */
export function parseAuthCallbackHash(hash: string): AuthCallbackParams | null {
  const route = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryStart = route.indexOf("?");
  const path = queryStart < 0 ? route : route.slice(0, queryStart);
  if (path !== AUTH_CALLBACK_PATH || queryStart < 0) return null;

  const params = new URLSearchParams(route.slice(queryStart + 1));
  return {
    code: params.get("code") ?? "",
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
 * while the page loads, before the app renders, so the one-time code does not stay
 * in the URL or in the history entry.
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
  | "exchange_failed"
  | "invalid_response";

export type LoginResult =
  | { ok: true }
  // `message`: the reason the API site gave for a refused exchange
  | { ok: false; reason: LoginFailure; message?: string };

/** the readable reason in a refused exchange answer, as plain text */
async function exchangeMessage(res: Pick<Response, "json">) {
  try {
    const message = (await res.json())?.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 300);
    }
  } catch {}
  return undefined;
}

/**
 * Check a callback against the `state` this tab created, then exchange the
 * one-time code for the key and hand both the key and the API site to `save`.
 *
 * The stored `state` and verifier are dropped before anything else, so they
 * work once. Without a matching `state` no request is made. No confirm
 * dialog: the `state` check is what proves this browser asked.
 */
export async function completeLogin(
  params: AuthCallbackParams,
  deps: {
    /** the configured authorize page, see `getLoginUrl` */
    loginUrl: string;
    /** origin of this site */
    origin: string;
    save: (key: string, apiOrigin: string) => void;
    storage?: StateStorage | null;
    fetch?: typeof fetch;
  },
): Promise<LoginResult> {
  const pending = takePendingLogin(
    deps.storage === undefined ? stateStorage() : deps.storage,
  );

  if (!pending || !params.state || params.state !== pending.state) {
    return { ok: false, reason: "state_mismatch" };
  }

  if (params.error) {
    return {
      ok: false,
      reason:
        params.error === "access_denied" ? "access_denied" : "server_error",
    };
  }

  if (!CODE_PATTERN.test(params.code)) {
    return { ok: false, reason: "invalid_response" };
  }

  const loginUrl = normalizeLoginUrl(deps.loginUrl);
  if (!loginUrl) {
    return { ok: false, reason: "server_error" };
  }
  const apiOrigin = getApiOrigin(loginUrl);

  let body: any;
  try {
    const res = await (deps.fetch ?? fetch)(apiOrigin + EXCHANGE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: params.code,
        code_verifier: pending.verifier,
        redirect_uri: deps.origin + "/",
      }),
      // no cookies, nothing cached, the address of this page stays here
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    // anything but 200 is a refusal; nothing is retried from here
    if (res.status !== 200) {
      const message = await exchangeMessage(res);
      return {
        ok: false,
        reason: "exchange_failed",
        ...(message ? { message } : {}),
      };
    }
    body = await res.json();
  } catch {
    return { ok: false, reason: "exchange_failed" };
  }

  const key = body?.success === true ? body?.data?.key : undefined;
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    return { ok: false, reason: "invalid_response" };
  }

  deps.save(key, apiOrigin);
  return { ok: true };
}

/**
 * The text of a reply to a request the API site answered with 401: the same
 * hint the streaming path adds, so both get the sign-in notice.
 */
export function withUnauthorizedHint<T>(
  message: T,
  status: number,
  unauthorizedText: string,
): T | string {
  if (status !== 401 || typeof message !== "string") return message;
  return [unauthorizedText, message].filter(Boolean).join("\n\n");
}

/**
 * What to show under a chat reply that reports a rejected or missing key.
 * It is only a notice with a button, the page never leaves on its own.
 *
 * Only the last reply of a conversation gets it, and only when it was written
 * after the current sign-in: replies rejected before signing in again say
 * nothing about the key in use now.
 */
export function loginNoticeFor(
  messageText: string,
  unauthorizedText: string,
  access: AccessLike,
  reply: { isLast: boolean; repliedAt: number },
  singleSite = SINGLE_SITE,
): "expired" | "required" | null {
  if (!isLoginEnabled(access, singleSite)) return null;
  if (!unauthorizedText || !messageText.includes(unauthorizedText)) return null;
  if (!reply.isLast) return null;
  if (!access.openaiApiKey) return "required";
  return reply.repliedAt > (access.loginAt ?? 0) ? "expired" : null;
}

/**
 * "Import local data" in the settings merges a backup file into the stores,
 * the access config (endpoint, key) included. With sign-in configured the
 * access config belongs to the sign-in: it is put back as it was, so a file
 * cannot change where the key is sent.
 */
export async function importKeepingAccess<T extends AccessLike>(
  runImport: () => Promise<unknown>,
  accessStore: { getState: () => T; setState: (state: T) => void },
  singleSite = SINGLE_SITE,
) {
  const before = accessStore.getState();
  await runImport();
  if (isLoginEnabled(before, singleSite)) {
    accessStore.setState(before);
  }
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
