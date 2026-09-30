import { performance } from "node:perf_hooks";
import {
  CommandRegistry,
  commandId,
} from "../src/application/commands/command-service.ts";
import { KeybindingController } from "../src/features/keybindings/keybinding-controller.ts";
import { primarySequence } from "../src/features/keybindings/keybinding-normalizer.ts";
import {
  KEYBINDING_PROFILE_KEY,
  KeybindingStore,
  createSilentKeybindingSync,
  loadKeybindingProfile,
} from "../src/features/keybindings/keybinding-store.ts";

const COMMAND_COUNT = 5_000;
const BINDING_COUNT = 2_000;
const DISPATCH_BUDGET_MS = 1;
const SEARCH_BUDGET_MS = 50;
const PARSE_BUDGET_MS = 10;

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

const registry = new CommandRegistry();
const defaults = [];
for (let index = 0; index < COMMAND_COUNT; index += 1) {
  const id = commandId(`benchmark.command.${index}`);
  registry.register({
    id,
    category: index % 2 === 0 ? "workbench" : "view",
    userBindingScopes: ["workbench"],
    title: () => `Benchmark command ${index}`,
    detail: () => "Synthetic performance fixture",
    keywords: () => `benchmark command ${index}`,
    availability: () => ({ enabled: true }),
    execute: () => undefined,
  });
  if (index < BINDING_COUNT) {
    defaults.push({
      id: `benchmark.binding.${index}`,
      commandId: id,
      sequence: primarySequence(`F${index + 20}`),
      scopes: ["workbench"],
    });
  }
}

const storage = new MemoryStorage();
const controller = new KeybindingController(
  registry,
  new KeybindingStore(storage, createSilentKeybindingSync()),
  defaults,
  "linux",
);

const dispatchSamples = [];
for (let sample = 0; sample < 200; sample += 1) {
  const started = performance.now();
  for (let run = 0; run < 100; run += 1) {
    const index = (sample * 100 + run) % BINDING_COUNT;
    controller.dispatch(keyboard(`F${index + 20}`), "workbench");
  }
  dispatchSamples.push((performance.now() - started) / 100);
}

controller.setQuery("command 4999");
const searchSamples = samples(20, () => controller.viewModel());

const parseStorage = new MemoryStorage();
const additions = [];
let serialized = "";
for (let index = 0; index < 2_048; index += 1) {
  additions.push({ id: `${index}`, commandId: `c${index}`, sequence: primarySequence(`F${index}`) });
  const candidate = JSON.stringify({ version: 1, revision: 1, replacements: [], additions });
  if (new TextEncoder().encode(candidate).byteLength > 250 * 1024) {
    additions.pop();
    break;
  }
  serialized = candidate;
}
parseStorage.setItem(KEYBINDING_PROFILE_KEY, serialized);
const parseSamples = samples(50, () => loadKeybindingProfile(parseStorage));

const result = {
  commands: COMMAND_COUNT,
  bindings: BINDING_COUNT,
  profileBytes: new TextEncoder().encode(serialized).byteLength,
  profileOverrides: additions.length,
  dispatchP95Ms: percentile(dispatchSamples, 0.95),
  settingsSearchP95Ms: percentile(searchSamples, 0.95),
  profileParseP95Ms: percentile(parseSamples, 0.95),
};
console.log(JSON.stringify(result, null, 2));
controller.dispose();

if (
  result.dispatchP95Ms >= DISPATCH_BUDGET_MS ||
  result.settingsSearchP95Ms >= SEARCH_BUDGET_MS ||
  result.profileParseP95Ms >= PARSE_BUDGET_MS
) process.exitCode = 1;

function keyboard(key) {
  return {
    key,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
  };
}

function samples(count, operation) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    operation();
    values.push(performance.now() - started);
  }
  return values;
}

function percentile(values, value) {
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))].toFixed(3));
}
