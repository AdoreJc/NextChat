import { pickSummarizeModel } from "../app/store/chat";
import { useAccessStore } from "../app/store/access";
import { ServiceProvider } from "../app/constant";

// Which model the title and summary requests go to (single-site build).
describe("title / summary model", () => {
  const session = (model: string, compressModel = "") => ({
    model: model as any,
    providerName: ServiceProvider.OpenAI,
    compressModel: compressModel as any,
    compressProviderName: compressModel ? ServiceProvider.OpenAI : ("" as any),
  });

  afterEach(() => {
    useAccessStore.setState({ summarizeModel: "" });
  });

  test("uses the model of the session, gpt models are not forced to gpt-4o-mini", () => {
    expect(pickSummarizeModel(session("gpt-4o"))).toEqual([
      "gpt-4o",
      ServiceProvider.OpenAI,
    ]);
    expect(pickSummarizeModel(session("site-model"))).toEqual([
      "site-model",
      ServiceProvider.OpenAI,
    ]);
  });

  test("uses the user's summary model when one is chosen", () => {
    expect(pickSummarizeModel(session("gpt-4o", "user-pick"))).toEqual([
      "user-pick",
      ServiceProvider.OpenAI,
    ]);
  });

  test("SUMMARIZE_MODEL from the server wins over session and user choice", () => {
    useAccessStore.setState({ summarizeModel: "site-summarizer" });

    expect(pickSummarizeModel(session("gpt-4o"))).toEqual([
      "site-summarizer",
      ServiceProvider.OpenAI,
    ]);
    expect(pickSummarizeModel(session("site-model", "user-pick"))).toEqual([
      "site-summarizer",
      ServiceProvider.OpenAI,
    ]);
  });
});
