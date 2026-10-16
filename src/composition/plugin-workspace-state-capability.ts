import type {
  BundledPlugin,
  PluginWorkspaceIdentity,
  PluginWorkspaceStateCapability,
} from "../application/plugins/index.ts";

export interface PluginWorkspaceStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = /^[a-z][a-zA-Z0-9.-]{0,127}$/;
const MAX_VALUE_LENGTH = 16_384;

export function createPluginWorkspaceStateCapability(
  storage: PluginWorkspaceStateStorage | undefined,
  plugin: BundledPlugin,
  identity: PluginWorkspaceIdentity,
): PluginWorkspaceStateCapability | undefined {
  if (!storage) return undefined;
  const prefix = `asterlyn.plugin-workspace-state.v1:${plugin.id}:${encodeURIComponent(identity.root)}:`;
  return Object.freeze({
    read: async (key: string) => {
      validateKey(key);
      const value = storage.getItem(`${prefix}${key}`);
      return value !== null && value.length <= MAX_VALUE_LENGTH ? value : null;
    },
    write: async (key: string, value: string) => {
      validateKey(key);
      if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH || value.includes("\0")) {
        throw new Error("Plugin workspace state value is invalid or too large.");
      }
      storage.setItem(`${prefix}${key}`, value);
    },
  });
}

function validateKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`Invalid plugin workspace state key: ${key}`);
}
