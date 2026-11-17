import { create } from "zustand";
import { SINGLE_SITE } from "../config/site";
import { OpenaiPath, ServiceProvider } from "../constant";
import { getHeaders } from "../client/api";
import { useAccessStore } from "./access";

/**
 * OpenPalm Chat (single-site build): once the user has an API key, the model
 * list comes from the API site itself (`GET v1/models`) instead of the
 * built-in table. Kept in memory only, nothing is persisted.
 */

const OPENAI_PROVIDER = {
  id: "openai",
  providerName: ServiceProvider.OpenAI as string,
  providerType: "openai",
  sorted: 1,
};

// endpoint types an API site may report per model (`supported_endpoint_types`)
// that can serve a chat conversation
const CHAT_ENDPOINT_TYPES = [
  "openai",
  "openai-response",
  "anthropic",
  "gemini",
];

// names of models that are not for chat: embeddings, rerank, image, video,
// audio and moderation models
const NON_CHAT_MODEL_NAME = new RegExp(
  [
    "embed", // text-embedding-*, *-embedding, bge-*/m3e via the names below
    "^bge-",
    "^m3e",
    "rerank",
    "moderation",
    "dall-?e",
    "gpt-image",
    "-image(-|$)", // gemini-*-image, qwen-image, ...
    "imagen",
    "stable-?diffusion",
    "^sdxl",
    "^sd-?[0-9]",
    "^flux",
    "midjourney",
    "^mj[-_]",
    "seedream",
    "cogview",
    "^kolors",
    "^ideogram",
    "^recraft",
    "whisper",
    "^tts",
    "-tts(-|$)",
    "transcribe",
    "^sora",
    "^veo",
    "^kling",
    "cogvideo",
    "seedance",
    "^suno",
  ].join("|"),
  "i",
);

/** whether a `v1/models` entry is a model people can chat with */
export function isChatModel(model: {
  id: string;
  supported_endpoint_types?: unknown;
}): boolean {
  const types = model.supported_endpoint_types;
  if (Array.isArray(types) && types.length > 0) {
    // the API site says what the model can do: trust it
    return types.some((t) => CHAT_ENDPOINT_TYPES.includes(String(t)));
  }
  return !NON_CHAT_MODEL_NAME.test(model.id);
}

/**
 * chat model ids of an OpenAI style `v1/models` response, without
 * duplicates; embedding, image and other non-chat models are left out
 */
export function parseModelIds(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const ids = data
    .filter(
      (m): m is { id: string; supported_endpoint_types?: unknown } =>
        typeof (m as { id?: unknown })?.id === "string" &&
        (m as { id: string }).id.length > 0,
    )
    .filter(isChatModel)
    .map((m) => m.id);
  return Array.from(new Set(ids));
}

/** shape the ids like the entries of `collectModelsWithDefaultModel` */
export function toSiteModels(ids: string[], defaultModel = "") {
  // DEFAULT_MODEL may carry a provider suffix: `name@OpenAI`
  const defaultName = defaultModel.split(/@(?!.*@)/)[0];
  return ids.map((id, index) => ({
    name: id,
    displayName: id,
    available: true,
    sorted: 1000 + index,
    provider: OPENAI_PROVIDER,
    isDefault: id === defaultName ? true : undefined,
  }));
}

type SiteModelsState = {
  /** null: not fetched, no key, or the request failed */
  ids: string[] | null;
  signature: string;
  refresh: () => Promise<void>;
};

export const useSiteModels = create<SiteModelsState>()((set, get) => ({
  ids: null,
  signature: "",

  async refresh() {
    const access = useAccessStore.getState();
    if (!SINGLE_SITE || !access.openaiApiKey) {
      set({ ids: null, signature: "" });
      return;
    }

    const signature = [
      access.openaiApiKey,
      access.useCustomConfig ? access.openaiUrl : "",
    ].join("|");
    if (signature === get().signature) {
      return;
    }
    set({ signature });

    try {
      const { ChatGPTApi } = await import("../client/platforms/openai");
      const res = await fetch(new ChatGPTApi().path(OpenaiPath.ListModelPath), {
        method: "GET",
        headers: { ...getHeaders() },
      });
      const ids = res.ok ? parseModelIds(await res.json()) : [];
      // the key or endpoint changed while the request was running
      if (get().signature !== signature) {
        return;
      }
      set({ ids: ids.length > 0 ? ids : null });
    } catch (e) {
      console.error("[Models] failed to fetch the model list", e);
      if (get().signature === signature) {
        set({ ids: null });
      }
    }
  },
}));
