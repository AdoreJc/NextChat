import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel, filterSiteModels } from "./model";
import { toSiteModels, useSiteModels } from "../store/site-models";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const siteModelIds = useSiteModels((state) => state.ids);
  const models = useMemo(() => {
    // single-site build: with an API key the list comes from the API site
    if (siteModelIds && siteModelIds.length > 0) {
      return toSiteModels(siteModelIds, accessStore.defaultModel);
    }
    return filterSiteModels(
      collectModelsWithDefaultModel(
        configStore.models,
        [configStore.customModels, accessStore.customModels].join(","),
        accessStore.defaultModel,
      ),
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
    siteModelIds,
  ]);

  return models;
}
