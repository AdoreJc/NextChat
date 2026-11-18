/**
 * @jest-environment node
 */
import { jest } from "@jest/globals";

// LOGIN_URL reaches the browser through /api/config, in the single-site
// build only.

const ORIGINAL_ENV = { ...process.env };
const LOGIN_URL = "https://api.example.test/chat-authorize";

async function loadConfig(env: Record<string, string>) {
  jest.resetModules();
  delete process.env.LOGIN_URL;
  delete process.env.NEXT_PUBLIC_SINGLE_SITE;
  Object.assign(process.env, env);
  const { GET } = await import("../app/api/config/route");
  return (await GET()).json();
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("LOGIN_URL in /api/config", () => {
  test("is handed to the browser", async () => {
    expect((await loadConfig({ LOGIN_URL })).loginUrl).toBe(LOGIN_URL);
    expect((await loadConfig({ LOGIN_URL: `  ${LOGIN_URL} ` })).loginUrl).toBe(
      LOGIN_URL,
    );
  });

  test("is empty when not set", async () => {
    expect((await loadConfig({})).loginUrl).toBe("");
    expect((await loadConfig({ LOGIN_URL: "" })).loginUrl).toBe("");
  });

  test("has to be https, http only for localhost and 127.0.0.1", async () => {
    for (const bad of [
      "http://api.example.test/chat-authorize",
      "javascript:alert(1)",
      "not a url",
      "/chat-authorize",
    ]) {
      expect((await loadConfig({ LOGIN_URL: bad })).loginUrl).toBe("");
    }
    for (const local of [
      "http://localhost:3000/chat-authorize",
      "http://127.0.0.1:3000/chat-authorize",
    ]) {
      expect((await loadConfig({ LOGIN_URL: local })).loginUrl).toBe(local);
    }
  });

  test("is ignored outside the single-site build", async () => {
    expect(
      (await loadConfig({ LOGIN_URL, NEXT_PUBLIC_SINGLE_SITE: "0" })).loginUrl,
    ).toBe("");
  });
});
