import { FEATURES, SINGLE_SITE, SITE_NAME } from "../app/config/site";
import {
  collectModels,
  collectModelsWithDefaultModel,
  filterSiteModels,
} from "../app/utils/model";
import { DEFAULT_MODELS, ServiceProvider } from "../app/constant";
import { CN_MASKS } from "../app/masks/cn";
import { TW_MASKS } from "../app/masks/tw";
import { EN_MASKS } from "../app/masks/en";
import fs from "fs";

describe("single-site build", () => {
  test("is the default and switches every gated feature off", () => {
    expect(SINGLE_SITE).toBe(true);
    expect(SITE_NAME).toBe("OpenPalm Chat");
    expect(Object.values(FEATURES).every((v) => v === false)).toBe(true);
  });

  test("only offers models of the OpenAI compatible provider", () => {
    const models = filterSiteModels(collectModels(DEFAULT_MODELS, ""));
    expect(models.length).toBeGreaterThan(0);
    expect(
      models.every((m) => m.provider?.providerName === ServiceProvider.OpenAI),
    ).toBe(true);
  });

  test("keeps custom models, with or without a provider suffix", () => {
    const models = filterSiteModels(
      collectModelsWithDefaultModel(
        DEFAULT_MODELS,
        "-all,+site-model-a,+site-model-b@OpenAI",
        "site-model-a",
      ),
    );
    const available = models.filter((m) => m.available).map((m) => m.name);
    expect(available.sort()).toEqual(["site-model-a", "site-model-b"]);
  });

  test("drops models that are explicitly bound to another built-in provider", () => {
    const models = filterSiteModels(collectModels(DEFAULT_MODELS, ""));
    const names = models.map((m) => m.provider?.providerName);
    expect(names).not.toContain(ServiceProvider.Anthropic);
    expect(names).not.toContain(ServiceProvider.Google);
  });
});

describe("built-in content", () => {
  const masks = JSON.stringify([CN_MASKS, TW_MASKS, EN_MASKS]);
  const promptText = fs.readFileSync("public/prompts.json", "utf-8");

  test("ships no jailbreak masks or prompts", () => {
    for (const text of [masks, promptText]) {
      expect(text).not.toMatch(/\bDAN\b|越狱|越獄/);
    }
    expect(promptText).not.toMatch(/jailbreak/i);
    // a mask may tell the model to decline jailbreaks, it must not be one
    const names = [...CN_MASKS, ...TW_MASKS, ...EN_MASKS].map((m) => m.name);
    expect(names.join(" | ")).not.toMatch(/jailbreak/i);
  });

  test("ships no mask that makes the browser load third-party images", () => {
    expect(masks).not.toMatch(/pollinations/i);
    expect(masks).not.toMatch(/!\[[^\]]*\]\(https?:/);
  });
});
