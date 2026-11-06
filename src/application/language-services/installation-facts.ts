import type { ManagedInstallationSnapshot } from "../../protocol/generated-native-language-types.ts";
import { validateManagedInstallationSnapshot } from "../../protocol/managed-language-installation.ts";

export type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type InstallationSnapshot = Immutable<ManagedInstallationSnapshot>;
export type InstallationFacts =
  | { readonly kind: "unavailable" | "checking" }
  | { readonly kind: "available"; readonly snapshot: InstallationSnapshot };

/** Opaque local request identity, not a native management or execution authority. */
export type InstallationFactsRequest = Readonly<object>;

/** No I/O or polling. The bridge owner resets this on workspace/activation/connection changes. */
export class ManagedInstallationFacts {
  #request: InstallationFactsRequest | null = null;
  #last: InstallationSnapshot | null = null;
  #facts: InstallationFacts = Object.freeze({ kind: "unavailable" });

  read(): InstallationFacts { return this.#facts; }

  reset(): void {
    this.#request = null;
    this.#last = null;
    this.#facts = Object.freeze({ kind: "unavailable" });
  }

  begin(): InstallationFactsRequest {
    const request = Object.freeze({});
    this.#request = request;
    this.#facts = Object.freeze({ kind: "checking" });
    return request;
  }

  accept(request: InstallationFactsRequest, value: unknown): boolean {
    if (request !== this.#request) return false;
    this.#request = null;
    this.#facts = Object.freeze({ kind: "unavailable" });
    try { validateManagedInstallationSnapshot(value); } catch { return false; }
    if (this.#last && (value.epoch !== this.#last.epoch || value.revision < this.#last.revision
      || value.indexRevision < this.#last.indexRevision
      || value.revision === this.#last.revision && value.indexRevision !== this.#last.indexRevision)) return false;
    const snapshot = freeze(structuredClone(value));
    this.#last = snapshot;
    this.#facts = Object.freeze({ kind: "available", snapshot });
    return true;
  }

  fail(request: InstallationFactsRequest): boolean {
    if (request !== this.#request) return false;
    this.#request = null;
    this.#facts = Object.freeze({ kind: "unavailable" });
    return true;
  }
}

function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
