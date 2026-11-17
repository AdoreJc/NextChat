import { parseModelIds, toSiteModels } from "../app/store/site-models";
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
