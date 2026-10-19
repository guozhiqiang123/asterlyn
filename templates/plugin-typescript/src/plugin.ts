import type {
  SdkPluginActivationContext,
  SdkPluginManifest,
  SdkPluginModule,
} from "@asterlyn/plugin-sdk";

export const HELLO_PLUGIN_ID = "dev.example.hello";

export const HELLO_PLUGIN_MANIFEST: SdkPluginManifest = Object.freeze({
  sdkMajor: 1,
  id: HELLO_PLUGIN_ID,
  version: "0.1.0",
  nameKey: "name",
  descriptionKey: "description",
  localization: Object.freeze({
    defaultLocale: "en-US",
    locales: Object.freeze({
      "en-US": Object.freeze({
        name: "Hello plugin",
        description: "An example isolated Asterlyn plugin.",
      }),
      "zh-CN": Object.freeze({
        name: "Hello 插件",
        description: "一个隔离运行的 Asterlyn 插件示例。",
      }),
    }),
  }),
  settings: Object.freeze([]),
});

export const HELLO_PLUGIN: SdkPluginModule = Object.freeze({
  sdkMajor: 1,
  id: HELLO_PLUGIN_ID,
  version: HELLO_PLUGIN_MANIFEST.version,
  manifest: HELLO_PLUGIN_MANIFEST,
  matches: () => true,
  activate: ({ contribute }: SdkPluginActivationContext) => {
    const command = contribute({
      kind: "command",
      id: "hello.sayHello",
      title: () => "Hello from plugin",
      detail: () => "Run the isolated example command",
      keywords: () => "hello plugin example",
      execute: () => undefined,
    });
    return Object.freeze({ dispose: () => command.dispose() });
  },
});
