import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel, filterSiteModels } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
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
  ]);

  return models;
}
