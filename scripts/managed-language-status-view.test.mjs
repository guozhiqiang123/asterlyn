import assert from "node:assert/strict";
import test from "node:test";
import { managedLanguageStatusPresentation, renderManagedLanguageStatus } from "../src/features/language-services/managed-language-status-view.ts";
import { EN_US_LANGUAGE_SERVICE_COPY, ZH_CN_LANGUAGE_SERVICE_COPY } from "../src/localization/language-service-copy.ts";

const copy = EN_US_LANGUAGE_SERVICE_COPY.management;
const labels = { language: "Rust", server: "rust-analyzer" };
const selected = { kind: "selected", languageId: "rust", provider: { key: '["dev.example.lsp","rust"]', pluginId: "dev.example.lsp", server: { id: "rust" } } };
const operation = { id: "job-1", server: { pluginId: "dev.example.lsp", serverId: "rust" }, artifactId: `sha256:${"a".repeat(64)}`,
  kind: "install", phase: "acquiring", completedBytes: 25, totalBytes: 100, failure: null };
const present = recommendation => managedLanguageStatusPresentation(selected, recommendation, labels, copy);

test("installed and ineligible documents leave the shared status bar unchanged", () => {
  assert.equal(present({ kind: "installed", status: {} }).visible, false);
  for (const kind of ["inactive", "ineligible-document", "unknown-language", "project-unmatched"]) {
    const value = managedLanguageStatusPresentation({ kind }, { kind: "none", reason: kind }, labels, copy);
    assert.equal(value.visible, false);
    assert.equal(renderManagedLanguageStatus(value, copy), "");
  }
});

test("unconfigured, unsupported and ambiguous catalog results provide one management path", () => {
  for (const kind of ["unconfigured", "platform-unavailable", "preferred-unavailable", "provider-conflict", "language-conflict"]) {
    const selection = kind === "language-conflict" ? { kind, languageIds: ["rust", "other"] }
      : kind === "provider-conflict" ? { kind, languageId: "rust", providers: [] } : { kind, languageId: "rust" };
    const value = managedLanguageStatusPresentation(selection, { kind: "none", reason: kind }, labels, copy);
    assert.equal(value.visible, true);
    assert.deepEqual(value.actions, ["open"]);
  }
});

test("checking and unavailable facts cannot render an installation action", () => {
  assert.deepEqual(present({ kind: "checking" }).actions, []);
  for (const reason of ["installation-facts", "target", "recipe"]) {
    const value = present({ kind: "unavailable", reason });
    assert.deepEqual(value.actions, ["open"]);
    assert.doesNotMatch(renderManagedLanguageStatus(value, copy), /data-managed-language-action="install"/u);
  }
});

test("install progress is bounded, labelled and cancellable", () => {
  const value = present({ kind: "installing", operation });
  assert.equal(value.text, "Installing rust-analyzer · 25%");
  assert.deepEqual(value.progress, { value: 25, maximum: 100, label: "rust-analyzer installation progress" });
  assert.deepEqual(value.actions, ["cancel", "open"]);
  const html = renderManagedLanguageStatus(value, copy);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/u);
  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /<progress value="25" max="100" aria-label="rust-analyzer installation progress"><\/progress>/u);
  assert.match(html, /data-managed-language-action="cancel"/u);
});

test("verification, recovery and missing service expose only their reviewed actions", () => {
  assert.deepEqual(present({ kind: "verification-required", status: {} }).actions, ["verify", "open"]);
  assert.deepEqual(present({ kind: "recovery-available", artifactIds: [] }).actions, ["recover", "open"]);
  assert.deepEqual(present({ kind: "install-available", providerKey: selected.provider.key }).actions, ["install", "open"]);
  assert.deepEqual(present({ kind: "removing", operation: { ...operation, kind: "remove", phase: "waiting-for-uses", completedBytes: 0, totalBytes: 0 } }).actions, ["cancel", "open"]);
});

test("status copy is localized and hostile labels are escaped", () => {
  const chinese = managedLanguageStatusPresentation(selected, { kind: "install-available", providerKey: selected.provider.key }, labels, ZH_CN_LANGUAGE_SERVICE_COPY.management);
  assert.match(chinese.text, /尚未安装/u);
  const hostile = managedLanguageStatusPresentation(selected, { kind: "install-available", providerKey: selected.provider.key }, { language: "Rust", server: '<img src=x onerror="x">' }, copy);
  const html = renderManagedLanguageStatus(hostile, copy);
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img/u);
});
