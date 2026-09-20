import type { LocaleCatalog } from "./catalog.ts";
import { EN_US } from "./en-US.ts";

export interface Localization {
  readonly catalog: LocaleCatalog;
  readonly number: Intl.NumberFormat;
  readonly pluralRules: Intl.PluralRules;
}

export function createLocalization(catalog: LocaleCatalog): Localization {
  return {
    catalog,
    number: new Intl.NumberFormat(catalog.locale),
    pluralRules: new Intl.PluralRules(catalog.locale),
  };
}

export const DEFAULT_LOCALIZATION = createLocalization(EN_US);
