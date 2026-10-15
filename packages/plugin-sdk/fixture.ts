import type { SdkPluginModule } from "./index.ts";

export const representativePlugin: SdkPluginModule = {
  sdkMajor: 1,
  id: "example.plugin",
  version: "1.2.3",
  manifest: {
    sdkMajor: 1,
    id: "example.plugin",
    version: "1.2.3",
    nameKey: "plugin.example.name",
    descriptionKey: "plugin.example.description",
    settings: [],
  },
  matches: ({ identity }) => identity.generation >= 0,
  activate: async ({ taskCache, contribute }) => {
    contribute({
      kind: "provider",
      id: "tasks",
      label: "Tasks",
      snapshot: () => ({ status: "ready", tasks: [], cache: { status: "stale" } }),
      refresh: () => ({
        request: { pluginId: "example.plugin", providerId: "tasks", taskId: ":help", label: "Help", executablePath: "/bin/gradle", args: ["help"] },
        apply: () => undefined,
      }),
      run: (taskId) => taskId === ":help" ? {
        request: { pluginId: "example.plugin", providerId: "tasks", taskId, label: "Help", executablePath: "/bin/gradle", args: ["help"] },
        apply: () => undefined,
      } : null,
      invalidate: async () => { await taskCache.markDirty("tasks", "watcher-ambiguous"); },
    });
  },
};
