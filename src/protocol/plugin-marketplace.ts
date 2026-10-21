import type { DesktopCommandName } from "./generated-desktop-protocol.ts";
import { assert, record } from "./desktop-result-validation-primitives.ts";
import type { SdkPluginManifest } from "../../packages/plugin-sdk/index.ts";

export type PluginSourceCatalogStatus = "available" | "noRelease" | "error" | "rateLimited";

export interface PluginSourceCatalog {
  readonly status: PluginSourceCatalogStatus;
  readonly checkedAtEpochMs: number;
  readonly stale: boolean;
  readonly version: string | null;
  readonly releaseUrl: string | null;
  readonly assetName: string | null;
  readonly assetDownloadUrl: string | null;
  readonly assetSizeBytes: number | null;
  readonly digest: string | null;
  readonly error: string | null;
  readonly rateLimitResetEpochMs: number | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface PluginSource {
  readonly repository: string;
  readonly name: string;
  readonly description: string;
  readonly builtIn: boolean;
  readonly enabled: boolean;
  readonly catalog: PluginSourceCatalog | null;
}

export interface PluginSourceSnapshot {
  readonly schemaVersion: 1;
  readonly generation: number;
  readonly sources: readonly PluginSource[];
  readonly recovered: boolean;
}

export interface PluginMarketplaceBridge {
  listPluginSources(): Promise<PluginSourceSnapshot>;
  upsertPluginSource(repository: string, name: string, description: string): Promise<PluginSourceSnapshot>;
  setPluginSourceEnabled(repository: string, enabled: boolean): Promise<PluginSourceSnapshot>;
  removePluginSource(repository: string): Promise<PluginSourceSnapshot>;
  refreshPluginSource(repository: string): Promise<PluginSourceSnapshot>;
  listPluginInstallations(): Promise<PluginInstallationSnapshot>;
  listInstalledPluginManifests(): Promise<InstalledPluginManifestSnapshot>;
  preparePluginInstall(repository: string): Promise<PluginPackageAdmissionReview>;
  confirmPluginInstall(reviewToken: string): Promise<PluginInstallationSnapshot>;
  cancelPluginInstall(reviewToken: string): Promise<void>;
  restartForPluginChanges(): Promise<void>;
  setInstalledPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginInstallationSnapshot>;
  selectInstalledPluginRollback(pluginId: string, version: string, packageDigest: string): Promise<PluginInstallationSnapshot>;
  uninstallInstalledPlugin(pluginId: string): Promise<PluginInstallationSnapshot>;
}

export type PluginRuntimeStatus = "pendingRuntime" | "pendingRestart" | "active" | "knownGood" | "quarantined";
export interface AdmittedPluginVersion { readonly version: string; readonly packageDigest: string; readonly contentDigest?: string | null; readonly admittedAtEpochMs: number; readonly runtimeStatus: PluginRuntimeStatus; }
export interface InstalledPlugin { readonly pluginId: string; readonly repository: string; readonly enabled: boolean; readonly bundledFallback: boolean; readonly activeVersion: string | null; readonly knownGoodVersion: string | null; readonly pendingVersion: string | null; readonly versions: readonly AdmittedPluginVersion[]; }
export interface PluginInstallationSnapshot { readonly schemaVersion: 1 | 2; readonly generation: number; readonly plugins: readonly InstalledPlugin[]; readonly recovered: boolean; }
export interface InstalledPluginManifestEntry { readonly pluginId: string; readonly pluginVersion: string; readonly packageDigest: string; readonly manifest: SdkPluginManifest | null; readonly error: string | null; }
export interface InstalledPluginManifestSnapshot { readonly schemaVersion: 1; readonly generation: number; readonly manifests: readonly InstalledPluginManifestEntry[]; }
export interface PluginPackageAdmissionReview { readonly reviewToken: string; readonly repository: string; readonly sourceGeneration: number; readonly assetName: string; readonly assetSizeBytes: number; readonly digest: string; readonly pluginId: string; readonly version: string; readonly licenseExpression: string; readonly capabilities: readonly string[]; readonly permissions: readonly string[]; readonly hostOperations: readonly string[]; readonly enabledAfterInstall: boolean; readonly expandedBytes: number; }

export function validatePluginSourceSnapshot(value: unknown, command: DesktopCommandName): PluginSourceSnapshot {
  const snapshot = record(value, command);
  assert(typeof snapshot.schemaVersion === "number", command, "schemaVersion must be a number");
  assert(typeof snapshot.generation === "number", command, "generation must be a number");
  assert(typeof snapshot.recovered === "boolean", command, "recovered must be a boolean");
  assert(snapshot.schemaVersion === 1, command, "expected plugin source schema 1");
  assert(Number.isSafeInteger(snapshot.generation) && snapshot.generation > 0, command, "invalid source generation");
  assert(Array.isArray(snapshot.sources), command, "sources must be an array");
  assert(snapshot.sources.length <= 64, command, "too many plugin sources");
  const repositories = new Set<string>();
  for (const sourceValue of snapshot.sources) {
    const source = record(sourceValue, command);
    assert(typeof source.repository === "string", command, "repository must be a string");
    assert(typeof source.name === "string", command, "name must be a string");
    assert(typeof source.description === "string", command, "description must be a string");
    assert(typeof source.builtIn === "boolean", command, "builtIn must be a boolean");
    assert(typeof source.enabled === "boolean", command, "enabled must be a boolean");
    assert(source.repository.length <= 200 && /^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(source.repository), command, "invalid repository identity");
    assert(!repositories.has(source.repository), command, "duplicate repository identity");
    repositories.add(source.repository);
    assert(source.name.length > 0 && source.name.length <= 80, command, "invalid source name");
    assert(source.description.length > 0 && source.description.length <= 500, command, "invalid source description");
    assert(source.catalog === null || typeof source.catalog === "object", command, "catalog must be an object or null");
    if (source.catalog !== null) validateCatalog(source.catalog, command);
  }
  return value as PluginSourceSnapshot;
}

function validateCatalog(value: unknown, command: DesktopCommandName): void {
  const catalog = record(value, command);
  assert(typeof catalog.status === "string", command, "status must be a string");
  assert(typeof catalog.checkedAtEpochMs === "number", command, "checkedAtEpochMs must be a number");
  assert(typeof catalog.stale === "boolean", command, "stale must be a boolean");
  for (const field of ["version", "releaseUrl", "assetName", "assetDownloadUrl", "digest", "error", "etag", "lastModified"] as const) {
    assert(catalog[field] === null || typeof catalog[field] === "string", command, `${field} must be a string or null`);
  }
  assert(
    ["available", "noRelease", "error", "rateLimited"].includes(catalog.status),
    command,
    "invalid source catalog status",
  );
  for (const field of ["assetSizeBytes", "rateLimitResetEpochMs"] as const) {
    assert(
      catalog[field] === null || (typeof catalog[field] === "number" && Number.isSafeInteger(catalog[field]) && catalog[field] > 0),
      command,
      `${field} must be a positive integer or null`,
    );
  }
  const hasRelease = catalog.version !== null && catalog.releaseUrl !== null && catalog.assetName !== null && catalog.assetDownloadUrl !== null &&
    catalog.assetSizeBytes !== null && catalog.digest !== null;
  assert(catalog.status !== "available" || hasRelease, command, "available catalog requires complete Release metadata");
  assert(catalog.status === "available" || catalog.error !== null, command, "unavailable catalog requires an error");
  assert(!hasRelease || catalog.status === "available" || catalog.stale === true, command, "cached Release metadata must be stale");
}

export function validatePluginInstallationSnapshot(value: unknown, command: DesktopCommandName): PluginInstallationSnapshot {
  const snapshot = record(value, command);
  assert(snapshot.schemaVersion === 1 || snapshot.schemaVersion === 2, command, "expected plugin installation schema 1 or 2");
  assert(typeof snapshot.generation === "number" && Number.isSafeInteger(snapshot.generation) && snapshot.generation > 0, command, "invalid installation generation");
  assert(typeof snapshot.recovered === "boolean", command, "recovered must be a boolean");
  assert(Array.isArray(snapshot.plugins) && snapshot.plugins.length <= 64, command, "invalid installed plugin list");
  for (const item of snapshot.plugins) {
    const plugin = record(item, command);
    assert(typeof plugin.pluginId === "string" && plugin.pluginId.length > 0, command, "invalid installed plugin ID");
    assert(typeof plugin.repository === "string" && plugin.repository.includes("/"), command, "invalid installed repository");
    assert(typeof plugin.enabled === "boolean" && typeof plugin.bundledFallback === "boolean", command, "invalid installed flags");
    for (const field of ["activeVersion", "knownGoodVersion", "pendingVersion"] as const) assert(plugin[field] === null || typeof plugin[field] === "string", command, `${field} must be a string or null`);
    assert(Array.isArray(plugin.versions) && plugin.versions.length <= 64, command, "invalid admitted version list");
    for (const item of plugin.versions) {
      const version = record(item, command);
      assert(typeof version.version === "string" && typeof version.packageDigest === "string" && /^sha256:[a-f0-9]{64}$/u.test(version.packageDigest), command, "invalid admitted version");
      assert(version.contentDigest === undefined || version.contentDigest === null || (typeof version.contentDigest === "string" && /^sha256:[a-f0-9]{64}$/u.test(version.contentDigest)), command, "invalid admitted content digest");
      assert(typeof version.admittedAtEpochMs === "number" && Number.isSafeInteger(version.admittedAtEpochMs), command, "invalid admission time");
      assert(["pendingRuntime", "pendingRestart", "active", "knownGood", "quarantined"].includes(String(version.runtimeStatus)), command, "invalid runtime status");
    }
  }
  return value as PluginInstallationSnapshot;
}

export function validateInstalledPluginManifestSnapshot(
  value: unknown,
  command: DesktopCommandName,
): InstalledPluginManifestSnapshot {
  const snapshot = record(value, command);
  assert(snapshot.schemaVersion === 1, command, "expected installed plugin manifest schema 1");
  assert(typeof snapshot.generation === "number" && Number.isSafeInteger(snapshot.generation) && snapshot.generation > 0, command, "invalid installed manifest generation");
  assert(Array.isArray(snapshot.manifests) && snapshot.manifests.length <= 64, command, "invalid installed manifest list");
  const ids = new Set<string>();
  for (const value of snapshot.manifests) {
    const entry = record(value, command);
    assert(typeof entry.pluginId === "string" && entry.pluginId.length > 0 && entry.pluginId.length <= 128, command, "invalid installed manifest plugin ID");
    assert(!ids.has(entry.pluginId), command, "duplicate installed manifest plugin ID");
    ids.add(entry.pluginId);
    assert(typeof entry.pluginVersion === "string" && entry.pluginVersion.length > 0 && entry.pluginVersion.length <= 64, command, "invalid installed manifest version");
    assert(typeof entry.packageDigest === "string" && /^sha256:[a-f0-9]{64}$/u.test(entry.packageDigest), command, "invalid installed manifest digest");
    assert(entry.error === null || (typeof entry.error === "string" && entry.error.length > 0 && entry.error.length <= 512), command, "invalid installed manifest diagnostic");
    assert(entry.manifest === null || typeof entry.manifest === "object", command, "invalid installed plugin manifest");
    assert((entry.manifest === null) !== (entry.error === null), command, "installed manifest must contain data or a diagnostic");
    if (entry.manifest !== null) validateManagementManifest(entry.manifest, entry, command);
  }
  return value as InstalledPluginManifestSnapshot;
}

function validateManagementManifest(value: unknown, entry: Record<string, unknown>, command: DesktopCommandName): void {
  const manifest = record(value, command);
  assert(manifest.sdkMajor === 1, command, "unsupported installed manifest SDK major");
  assert(manifest.id === entry.pluginId && manifest.version === entry.pluginVersion, command, "installed manifest identity mismatch");
  assert(validManifestText(manifest.nameKey) && validManifestText(manifest.descriptionKey), command, "invalid installed manifest message keys");
  const localization = record(manifest.localization, command);
  assert(typeof localization.defaultLocale === "string" && localization.defaultLocale.length > 0 && localization.defaultLocale.length <= 35, command, "invalid installed manifest default locale");
  const locales = record(localization.locales, command);
  const localeEntries = Object.entries(locales);
  assert(localeEntries.length > 0 && localeEntries.length <= 16 && Object.hasOwn(locales, localization.defaultLocale), command, "invalid installed manifest locales");
  let characters = 0;
  for (const [locale, rawMessages] of localeEntries) {
    assert(locale.length > 0 && locale.length <= 35, command, "invalid installed manifest locale");
    const messages = record(rawMessages, command);
    assert(Object.keys(messages).length <= 512, command, "too many installed manifest messages");
    characters += locale.length;
    for (const [key, message] of Object.entries(messages)) {
      assert(validManifestText(key) && typeof message === "string" && message.length > 0 && message.length <= 4_096, command, "invalid installed manifest message");
      characters += key.length + message.length;
      assert(characters <= 262_144, command, "installed manifest localization is too large");
    }
  }
  assert(Array.isArray(manifest.settings) && manifest.settings.length <= 32, command, "invalid installed manifest settings");
  const settingIds = new Set<string>();
  for (const rawSetting of manifest.settings) {
    const setting = record(rawSetting, command);
    assert(validManifestText(setting.id) && !settingIds.has(setting.id), command, "invalid installed manifest setting ID");
    settingIds.add(setting.id);
    assert((setting.kind === "boolean" || setting.kind === "enum") && validManifestText(setting.labelKey), command, "invalid installed manifest setting");
    assert(setting.descriptionKey === undefined || validManifestText(setting.descriptionKey), command, "invalid installed manifest setting description");
    if (setting.kind === "boolean") {
      assert(typeof setting.defaultValue === "boolean" && (setting.options === undefined || (Array.isArray(setting.options) && setting.options.length === 0)), command, "invalid boolean plugin setting");
      continue;
    }
    assert(typeof setting.defaultValue === "string" && Array.isArray(setting.options) && setting.options.length > 0 && setting.options.length <= 64, command, "invalid enum plugin setting");
    const values = new Set<string>();
    for (const rawOption of setting.options) {
      const option = record(rawOption, command);
      assert(typeof option.value === "string" && option.value.length > 0 && option.value.length <= 256 && !values.has(option.value) && validManifestText(option.labelKey), command, "invalid plugin setting option");
      values.add(option.value);
    }
    assert(values.has(setting.defaultValue), command, "plugin setting default is not an option");
  }
  if (manifest.taskAuthorization !== undefined) {
    const authorization = record(manifest.taskAuthorization, command);
    const workspace = record(authorization.workspaceTrust, command);
    assert(validManifestText(workspace.id) && validManifestText(workspace.labelKey), command, "invalid installed task authorization");
    assert(workspace.descriptionKey === undefined || validManifestText(workspace.descriptionKey), command, "invalid installed task authorization description");
    if (authorization.taskConfirmation !== undefined) {
      const confirmation = record(authorization.taskConfirmation, command);
      assert(validManifestText(confirmation.rememberLabelKey), command, "invalid installed task confirmation");
      assert(confirmation.rememberDescriptionKey === undefined || validManifestText(confirmation.rememberDescriptionKey), command, "invalid installed task confirmation description");
    }
  }
  if (manifest.workspaceTool !== undefined) {
    const tool = record(manifest.workspaceTool, command);
    assert(validManifestText(tool.id) && validManifestText(tool.titleKey) && ["device", "list", "puzzle"].includes(String(tool.icon)), command, "invalid installed workspace tool");
    assert(Array.isArray(tool.views) && tool.views.length > 0 && tool.views.length <= 16 && typeof tool.defaultView === "string", command, "invalid installed workspace tool views");
    const views = new Set<string>();
    for (const rawView of tool.views) {
      const view = record(rawView, command);
      assert(validManifestText(view.id) && !views.has(view.id) && validManifestText(view.labelKey), command, "invalid installed workspace tool view");
      views.add(view.id);
    }
    assert(views.has(tool.defaultView), command, "installed workspace tool default view is missing");
  }
  validateProcessQueries(manifest.processQueries, command);
  validateToolOperations(manifest.toolOperations, command);
  validateHostOperations(manifest.hostOperations, command);
}

function validateHostOperations(value: unknown, command: DesktopCommandName): void {
  if (value === undefined) return;
  assert(Array.isArray(value) && value.length <= 64, command, "invalid installed host operations");
  const ids = new Set<string>();
  const supported = new Set([
    "adb.devices",
    "android.apk.inspect",
    "android.adb.install",
    "android.adb.uninstall",
    "android.adb.launch",
  ]);
  for (const rawOperation of value) {
    const operation = record(rawOperation, command);
    assert(
      Object.keys(operation).length === 1 && validManifestText(operation.id) &&
        supported.has(String(operation.id)) && !ids.has(String(operation.id)),
      command,
      "invalid installed host operation",
    );
    ids.add(String(operation.id));
  }
}

function validateProcessQueries(value: unknown, command: DesktopCommandName): void {
  if (value === undefined) return;
  assert(Array.isArray(value) && value.length <= 32, command, "invalid installed process queries");
  const ids = new Set<string>();
  for (const rawQuery of value) {
    const query = record(rawQuery, command);
    assert(validManifestText(query.id) && !ids.has(query.id), command, "invalid installed process query ID");
    ids.add(query.id);
    validateProcessLimits(query, command, 60_000);
  }
}

function validateToolOperations(value: unknown, command: DesktopCommandName): void {
  if (value === undefined) return;
  assert(Array.isArray(value) && value.length <= 32, command, "invalid installed tool operations");
  const ids = new Set<string>();
  for (const rawOperation of value) {
    const operation = record(rawOperation, command);
    assert(validManifestText(operation.id) && !ids.has(operation.id), command, "invalid installed tool operation ID");
    ids.add(operation.id);
    assert(operation.intent === "query" || operation.intent === "mutation", command, "invalid installed tool operation intent");
    assert(Array.isArray(operation.parameters) && operation.parameters.length <= 16, command, "invalid installed tool parameters");
    const parameters = new Set<string>();
    for (const rawParameter of operation.parameters) {
      const parameter = record(rawParameter, command);
      assert(validManifestText(parameter.name) && !parameters.has(parameter.name), command, "invalid installed tool parameter name");
      parameters.add(parameter.name);
      assert(["executionTargetId", "androidApplicationId", "androidComponent", "workspaceArtifact"].includes(String(parameter.kind)), command, "invalid installed tool parameter kind");
      if (parameter.kind === "workspaceArtifact") {
        assert(Array.isArray(parameter.suffixes) && parameter.suffixes.length > 0 && parameter.suffixes.length <= 8, command, "invalid installed artifact suffixes");
        assert(parameter.suffixes.every((suffix) => typeof suffix === "string" && /^\.[a-z0-9]+$/u.test(suffix) && suffix.length <= 32), command, "invalid installed artifact suffix");
      } else {
        assert(parameter.suffixes === undefined, command, "unexpected installed tool parameter suffixes");
      }
    }
    assert(Array.isArray(operation.args) && operation.args.length <= 64, command, "invalid installed tool arguments");
    const referenced = new Set<string>();
    for (const rawArgument of operation.args) {
      const argument = record(rawArgument, command);
      if (argument.type === "literal") {
        assert(typeof argument.value === "string" && argument.value.length <= 1_024 && !argument.value.includes("\0"), command, "invalid installed tool literal");
      } else {
        assert(argument.type === "parameter" && typeof argument.name === "string" && parameters.has(argument.name), command, "invalid installed tool parameter reference");
        referenced.add(argument.name);
      }
    }
    assert(referenced.size === parameters.size, command, "unused installed tool parameter");
    validateProcessLimits(operation, command, 300_000, false);
  }
}

function validateProcessLimits(
  declaration: Record<string, unknown>,
  command: DesktopCommandName,
  maximumTimeout: number,
  validateArgs = true,
): void {
  if (validateArgs) {
    assert(Array.isArray(declaration.args) && declaration.args.length <= 64, command, "invalid installed process arguments");
    assert(declaration.args.every((argument) => typeof argument === "string" && argument.length <= 1_024 && !argument.includes("\0")), command, "invalid installed process argument");
  }
  assert(typeof declaration.timeoutMs === "number" && Number.isSafeInteger(declaration.timeoutMs) && declaration.timeoutMs > 0 && declaration.timeoutMs <= maximumTimeout, command, "invalid installed process timeout");
  assert(typeof declaration.maxOutputBytes === "number" && Number.isSafeInteger(declaration.maxOutputBytes) && declaration.maxOutputBytes > 0 && declaration.maxOutputBytes <= 1_048_576, command, "invalid installed process output limit");
  assert(Array.isArray(declaration.executables) && declaration.executables.length > 0, command, "missing installed process executable");
  for (const rawCandidate of declaration.executables) {
    const candidate = record(rawCandidate, command);
    if (candidate.type === "environment") {
      assert(typeof candidate.variable === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(candidate.variable), command, "invalid installed executable environment");
      assert(validRelativePath(candidate.relativePath, 512), command, "invalid installed executable relative path");
    } else if (candidate.type === "workspaceProperty") {
      assert(validRelativePath(candidate.path, 256) && validManifestText(candidate.key) && validRelativePath(candidate.relativePath, 512), command, "invalid installed workspace executable");
    } else if (candidate.type === "androidSdkBuildTools") {
      assert(typeof candidate.name === "string" && validRelativePath(candidate.name, 128) && !candidate.name.includes("/"), command, "invalid installed Android SDK Build Tools executable");
    } else {
      assert(candidate.type === "path" && typeof candidate.name === "string" && validRelativePath(candidate.name, 128) && !candidate.name.includes("/"), command, "invalid installed PATH executable");
    }
  }
}

function validRelativePath(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function validManifestText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function validatePluginPackageAdmissionReview(value: unknown, command: DesktopCommandName): PluginPackageAdmissionReview {
  const review = record(value, command);
  for (const field of ["reviewToken", "repository", "assetName", "digest", "pluginId", "version", "licenseExpression"] as const) assert(typeof review[field] === "string" && review[field].length > 0, command, `${field} must be non-empty`);
  assert(/^[a-f0-9]{64}$/u.test(String(review.reviewToken)), command, "invalid review token");
  assert(/^sha256:[a-f0-9]{64}$/u.test(String(review.digest)), command, "invalid package digest");
  for (const field of ["sourceGeneration", "assetSizeBytes", "expandedBytes"] as const) assert(typeof review[field] === "number" && Number.isSafeInteger(review[field]) && review[field] > 0, command, `${field} must be positive`);
  for (const field of ["capabilities", "permissions", "hostOperations"] as const) assert(Array.isArray(review[field]) && review[field].every((item) => typeof item === "string"), command, `${field} must be strings`);
  assert(review.enabledAfterInstall === false, command, "new plugins must remain disabled after admission");
  return value as PluginPackageAdmissionReview;
}
