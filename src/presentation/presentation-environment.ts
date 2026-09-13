import type {
  AppPreferences,
  LocalePreference,
  ThemePreference,
} from "../workbench/preferences.ts";

export type EffectiveLocale = "en-US" | "zh-CN";
export type EffectiveTheme = "dark" | "light";

export interface PresentationSnapshot {
  readonly requestedLocale: LocalePreference;
  readonly locale: EffectiveLocale;
  readonly requestedTheme: ThemePreference;
  readonly theme: EffectiveTheme;
}

export interface SystemPresentationPort {
  locales(): readonly string[];
  prefersDark(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface NativeAppearancePort {
  setTheme(theme: ThemePreference): Promise<void>;
}

type Listener = (
  snapshot: PresentationSnapshot,
  previous: PresentationSnapshot,
) => void;

export class PresentationEnvironment {
  private readonly listeners = new Set<Listener>();
  private readonly releaseSystem: () => void;
  private readonly system: SystemPresentationPort;
  private readonly document: Document;
  private readonly nativeAppearance: NativeAppearancePort;
  private readonly reportError: (error: unknown) => void;
  private snapshotValue: PresentationSnapshot;
  private disposed = false;

  constructor(
    preferences: Pick<AppPreferences, "locale" | "theme">,
    system: SystemPresentationPort,
    document: Document,
    nativeAppearance: NativeAppearancePort,
    reportError: (error: unknown) => void = console.error,
  ) {
    this.system = system;
    this.document = document;
    this.nativeAppearance = nativeAppearance;
    this.reportError = reportError;
    this.snapshotValue = resolvePresentationSnapshot(preferences, system);
    applyPresentationToDocument(document, this.snapshotValue);
    void this.applyNativeTheme(preferences.theme);
    this.releaseSystem = system.subscribe(() => this.reconcileSystem());
  }

  get snapshot(): PresentationSnapshot {
    return this.snapshotValue;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updatePreferences(preferences: Pick<AppPreferences, "locale" | "theme">): boolean {
    if (this.disposed) return false;
    const next = resolvePresentationSnapshot(preferences, this.system);
    const previous = this.snapshotValue;
    if (samePresentation(previous, next)) return false;
    this.snapshotValue = next;
    applyPresentationToDocument(this.document, next);
    if (previous.requestedTheme !== next.requestedTheme) {
      void this.applyNativeTheme(next.requestedTheme);
    }
    this.emit(next, previous);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseSystem();
    this.listeners.clear();
  }

  private reconcileSystem(): void {
    this.updatePreferences({
      locale: this.snapshotValue.requestedLocale,
      theme: this.snapshotValue.requestedTheme,
    });
  }

  private async applyNativeTheme(theme: ThemePreference): Promise<void> {
    try {
      await this.nativeAppearance.setTheme(theme);
    } catch (error) {
      this.reportError(error);
    }
  }

  private emit(snapshot: PresentationSnapshot, previous: PresentationSnapshot): void {
    for (const listener of this.listeners) listener(snapshot, previous);
  }
}

export function resolvePresentationSnapshot(
  preferences: Pick<AppPreferences, "locale" | "theme">,
  system: Pick<SystemPresentationPort, "locales" | "prefersDark">,
): PresentationSnapshot {
  return {
    requestedLocale: preferences.locale,
    locale: resolveEffectiveLocale(preferences.locale, system.locales()),
    requestedTheme: preferences.theme,
    theme: resolveEffectiveTheme(preferences.theme, system.prefersDark()),
  };
}

export function resolveEffectiveLocale(
  requested: LocalePreference,
  systemLocales: readonly string[],
): EffectiveLocale {
  if (requested !== "system") return requested;
  const normalized = systemLocales.map((locale) => locale.toLowerCase());
  return normalized.some((locale) =>
    locale === "zh-cn" || locale === "zh-sg" || locale === "zh-hans" ||
    locale.startsWith("zh-hans-")
  ) ? "zh-CN" : "en-US";
}

export function resolveEffectiveTheme(
  requested: ThemePreference,
  systemPrefersDark: boolean,
): EffectiveTheme {
  return requested === "system"
    ? systemPrefersDark ? "dark" : "light"
    : requested;
}

export function applyPresentationToDocument(
  document: Document,
  snapshot: PresentationSnapshot,
): void {
  const root = document.documentElement;
  root.lang = snapshot.locale;
  root.dir = "ltr";
  root.dataset.theme = snapshot.theme;
  root.style.colorScheme = snapshot.theme;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  themeColor?.setAttribute("content", snapshot.theme === "dark" ? "#1e1f22" : "#f4f5f7");
}

export function createBrowserSystemPresentationPort(host: Window): SystemPresentationPort {
  const query = host.matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set<() => void>();
  let listening = false;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    locales: () => host.navigator.languages.length > 0
      ? host.navigator.languages
      : [host.navigator.language],
    prefersDark: () => query.matches,
    subscribe(listener) {
      listeners.add(listener);
      if (!listening) {
        listening = true;
        query.addEventListener("change", notify);
        host.addEventListener("languagechange", notify);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && listening) {
          listening = false;
          query.removeEventListener("change", notify);
          host.removeEventListener("languagechange", notify);
        }
      };
    },
  };
}

function samePresentation(left: PresentationSnapshot, right: PresentationSnapshot): boolean {
  return left.requestedLocale === right.requestedLocale &&
    left.locale === right.locale &&
    left.requestedTheme === right.requestedTheme &&
    left.theme === right.theme;
}
