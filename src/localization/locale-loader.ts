import type { EffectiveLocale } from "../presentation/presentation-environment.ts";
import type { LocaleCatalog } from "./catalog.ts";
import { EN_US } from "./en-US.ts";

export async function loadLocale(locale: EffectiveLocale): Promise<LocaleCatalog> {
  if (locale === "zh-CN") {
    return (await import("./zh-CN.ts")).ZH_CN;
  }
  return EN_US;
}
