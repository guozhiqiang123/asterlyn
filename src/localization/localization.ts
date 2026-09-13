import type { LocaleCatalog } from "./catalog.ts";

export interface Localization {
  readonly catalog: LocaleCatalog;
  readonly dateTime: Intl.DateTimeFormat;
  readonly shortDateTime: Intl.DateTimeFormat;
  readonly relativeTime: Intl.RelativeTimeFormat;
  readonly number: Intl.NumberFormat;
  readonly pluralRules: Intl.PluralRules;
}

export function createLocalization(catalog: LocaleCatalog): Localization {
  return {
    catalog,
    dateTime: new Intl.DateTimeFormat(catalog.locale, { dateStyle: "medium", timeStyle: "short" }),
    shortDateTime: new Intl.DateTimeFormat(catalog.locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    relativeTime: new Intl.RelativeTimeFormat(catalog.locale, { numeric: "auto" }),
    number: new Intl.NumberFormat(catalog.locale),
    pluralRules: new Intl.PluralRules(catalog.locale),
  };
}
