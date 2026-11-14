/**
 * @jest-environment node
 */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

// The single-site build must fail closed on the server: a user's API key may
// only ever be forwarded to the API site configured with BASE_URL. These tests
// fail on the upstream behaviour (fallback to api.openai.com, open provider
// routes).

const ORIGINAL_ENV = { ...process.env };
const fetchMock = jest.fn<typeof fetch>();

function chatRequest(path = "/api/openai/v1/chat/completions") {
  return new NextRequest(`http://chat.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-user-key",
    },
    body: JSON.stringify({
      model: "site-model",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

async function loadFresh<T>(
  env: Record<string, string>,
  load: () => Promise<T>,
) {
  jest.resetModules();
  for (const key of ["BASE_URL", "CODE", "CUSTOM_MODELS", "ENABLE_MCP"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  return load();
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () =>
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

describe("single-site server: /api/openai forwarding", () => {
  test("returns 503 and never calls fetch when BASE_URL is empty", async () => {
    const { requestOpenai } = await loadFresh(
      {},
      () => import("../app/api/common"),
    );

    const res = await requestOpenai(chatRequest());

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBe(true);
    expect(body.message).toContain("BASE_URL");
  });

  test("forwards only to the configured BASE_URL", async () => {
    const { requestOpenai } = await loadFresh(
      { BASE_URL: "https://api.site.test" },
      () => import("../app/api/common"),
    );

    const res = await requestOpenai(chatRequest());

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url as string).origin).toBe("https://api.site.test");
    expect(new URL(url as string).pathname).toBe("/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-user-key",
    );
  });

  test("refuses azure deployment paths without calling fetch", async () => {
    const { requestOpenai } = await loadFresh(
      { BASE_URL: "https://api.site.test" },
      () => import("../app/api/common"),
    );

    const res = await requestOpenai(
      chatRequest("/api/azure/deployments/x/chat/completions"),
    );

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("single-site server: third-party routes", () => {
  test("singleSiteBlocked answers 404", async () => {
    const { singleSiteBlocked } = await loadFresh(
      {},
      () => import("../app/api/single-site"),
    );

    expect(singleSiteBlocked()?.status).toBe(404);
  });

  test.each([
    ["anthropic", ["v1", "messages"]],
    ["google", ["v1beta", "models"]],
    ["azure", ["deployments", "x", "chat", "completions"]],
    ["deepseek", ["chat", "completions"]],
    ["stability", ["v2beta", "stable-image"]],
    ["proxy", ["v1", "models"]],
  ])("/api/%s is 404 and never calls fetch", async (provider, path) => {
    const route = await loadFresh(
      { BASE_URL: "https://api.site.test" },
      () => import("../app/api/[provider]/[...path]/route"),
    );
    const req = new NextRequest(
      `http://chat.test/api/${provider}/${path.join("/")}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer sk-user-key",
          "x-base-url": "https://third-party.test",
        },
        body: "{}",
      },
    );

    const res = await route.POST(req, { params: { provider, path } });

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("MCP server actions stay disabled even with ENABLE_MCP=true", async () => {
    const { isMcpEnabled, getMcpConfigFromFile } = await loadFresh(
      { ENABLE_MCP: "true", CODE: "test-code" },
      () => import("../app/mcp/actions"),
    );

    expect(await isMcpEnabled()).toBe(false);
    await expect(getMcpConfigFromFile("test-code")).rejects.toThrow(
      "MCP is not enabled",
    );
  });
});
