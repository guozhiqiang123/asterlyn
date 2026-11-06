// Generated from native catalog models. Run npm run protocol:catalog. Do not edit.
export type CatalogAffiliation = "language-official" | "community";

export type CatalogLanguage = {
  readonly "extensions": ReadonlyArray<string>;
  readonly "fileNames": ReadonlyArray<string>;
  readonly "id": string;
  readonly "labelKey": string;
};

export type CatalogPlatform = "macos-arm64" | "macos-x64" | "linux-arm64" | "linux-x64" | "windows-arm64" | "windows-x64";

export type CatalogServer = {
  readonly "id": string;
  readonly "labelKey": string;
  readonly "languageIds": ReadonlyArray<string>;
  readonly "platforms": ReadonlyArray<CatalogPlatform>;
  readonly "requireRootMarker": boolean;
  readonly "rootMarkers": ReadonlyArray<string>;
  readonly "upstream": CatalogUpstream;
};

export type CatalogUpstream = {
  readonly "affiliation": CatalogAffiliation;
  readonly "repository": string;
};

export type LanguageServerCatalog = {
  readonly "languages": ReadonlyArray<CatalogLanguage>;
  readonly "schemaVersion": number;
  readonly "servers": ReadonlyArray<CatalogServer>;
};
