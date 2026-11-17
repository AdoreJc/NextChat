import {
  isChatModel,
  parseModelIds,
  toSiteModels,
} from "../app/store/site-models";
import { ServiceProvider } from "../app/constant";

// single-site build: with an API key the model list is the one the API site
// returns from `v1/models`
describe("model list from the API site", () => {
  test("reads the ids of an OpenAI style models response", () => {
    expect(
      parseModelIds({
        object: "list",
        data: [
          { id: "site-model-a", object: "model" },
          { id: "claude-style-name", object: "model" },
          { id: "site-model-a", object: "model" },
          { object: "model" },
          { id: "" },
        ],
      }),
    ).toEqual(["site-model-a", "claude-style-name"]);
  });

  test("returns nothing for error bodies and malformed responses", () => {
    expect(parseModelIds({ error: { message: "Invalid token" } })).toEqual([]);
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds({ data: "nope" })).toEqual([]);
  });

  test("leaves out embedding, image and other non-chat models by name", () => {
    const chat = [
      "gpt-6.1-sol",
      "gpt-4o",
      "claude-sonnet-4-5",
      "gemini-2.5-pro",
      "deepseek-chat",
      "qwen-max",
      "glm-4-plus",
      "o3-mini",
      "sd-chat-helper",
    ];
    const notChat = [
      "text-embedding-3-large",
      "bge-m3",
      "m3e-base",
      "jina-reranker-v2",
      "dall-e-3",
      "gpt-image-1",
      "gemini-2.5-flash-image",
      "imagen-4",
      "stable-diffusion-xl",
      "flux-pro",
      "mj_imagine",
      "whisper-1",
      "tts-1-hd",
      "gpt-4o-mini-tts",
      "omni-moderation-latest",
      "sora-2",
      "veo-3",
    ];

    const ids = parseModelIds({
      data: [...chat, ...notChat].map((id) => ({ id, object: "model" })),
    });

    expect(ids).toEqual(chat);
  });

  test("trusts the endpoint types reported by the API site over the name", () => {
    expect(
      isChatModel({
        id: "plain-name",
        supported_endpoint_types: ["embeddings"],
      }),
    ).toBe(false);
    expect(
      isChatModel({
        id: "plain-name",
        supported_endpoint_types: ["image-generation"],
      }),
    ).toBe(false);
    expect(
      isChatModel({
        id: "custom-image-chat",
        supported_endpoint_types: ["openai", "image-generation"],
      }),
    ).toBe(true);
    expect(
      isChatModel({ id: "claude-x", supported_endpoint_types: ["anthropic"] }),
    ).toBe(true);
    // no usable type information: fall back to the name
    expect(
      isChatModel({ id: "plain-name", supported_endpoint_types: [] }),
    ).toBe(true);
  });

  test("offers every id, whatever its name, through the OpenAI compatible provider", () => {
    const models = toSiteModels(["b-model", "a-model"], "");

    expect(models.map((m) => m.name)).toEqual(["b-model", "a-model"]);
    expect(models.every((m) => m.available)).toBe(true);
    expect(
      models.every((m) => m.provider.providerName === ServiceProvider.OpenAI),
    ).toBe(true);
  });

  test("marks DEFAULT_MODEL as default, with or without a provider suffix", () => {
    const pick = (defaultModel: string) =>
      toSiteModels(["a-model", "b-model"], defaultModel)
        .filter((m) => m.isDefault)
        .map((m) => m.name);

    expect(pick("b-model@OpenAI")).toEqual(["b-model"]);
    expect(pick("b-model")).toEqual(["b-model"]);
    expect(pick("not-offered")).toEqual([]);
  });
});
