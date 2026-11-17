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

/** model ids of an OpenAI style `v1/models` response, without duplicates */
export function parseModelIds(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    return [];
  }
  const ids = data
    .map((m) => (m as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
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
