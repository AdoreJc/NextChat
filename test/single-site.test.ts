import { FEATURES, SINGLE_SITE, SITE_NAME } from "../app/config/site";
import {
  collectModels,
  collectModelsWithDefaultModel,
  filterSiteModels,
} from "../app/utils/model";
import { DEFAULT_MODELS, ServiceProvider } from "../app/constant";

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
