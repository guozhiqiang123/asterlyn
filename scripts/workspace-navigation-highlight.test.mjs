import assert from "node:assert/strict";
import test from "node:test";

import { openCommandSurface, createCommandSurfaceState } from "../src/features/files-editor/navigation.ts";
import { renderCommandSurfaceResults } from "../src/features/files-editor/workspace-navigation-view.ts";
import { createWorkspaceSearchControls, createWorkspaceSearchState } from "../src/features/files-editor/workspace-search.ts";

function model(mode, query, overrides = {}) {
  return {
    commandSurface: openCommandSurface(createCommandSurfaceState(), mode, query),
    workspaceOpen: true,
    filesLoading: false,
    files: [], commands: [], workspaceSearch: createWorkspaceSearchState(),
    workspaceSearchControls: createWorkspaceSearchControls(), searchRequestIsCurrent: false,
    replacementText: "", replacementRecoveryCount: 0,
    ...overrides,
  };
}

function file(path) {
  return { repositoryId: ".", path, workspacePath: path };
}

test("Files and Recent visibly mark matched filename and directory characters", () => {
  const files = renderCommandSurfaceResults("files", 0, model("files", "config", {
    files: [file("config/app/config.kt")],
  }));
  assert.match(files, /<strong><mark class="command-result-match">config<\/mark>\.kt<\/strong>/);
  assert.match(files, /<small>config\/app<\/small>/);
  const recent = renderCommandSurfaceResults("recent", 0, model("recent", "config", {
    files: [file("src/config/File.kt")],
  }));
  assert.match(recent, /<strong>File\.kt<\/strong>/);
  assert.match(recent, /<small>src\/<mark class="command-result-match">config<\/mark><\/small>/);
  const separator = renderCommandSurfaceResults("files", 0, model("files", "src/app", {
    files: [file("src/app.ts")],
  }));
  assert.match(separator, /<small><mark class="command-result-match">src\/<\/mark><\/small>/);
  assert.match(separator, /<strong><mark class="command-result-match">app<\/mark>\.ts<\/strong>/);
});

test("Quick Open marks fuzzy subsequences and escapes matched source text", () => {
  const fuzzy = renderCommandSurfaceResults("files", 0, model("files", "ptree", {
    files: [file("src/ProjectTree.ts")],
  }));
  assert.equal((fuzzy.match(/<mark class="command-result-match">/g) ?? []).length, 3);
  assert.match(fuzzy, /<strong><mark class="command-result-match">P<\/mark>rojec<mark class="command-result-match">t<\/mark>T<mark class="command-result-match">ree<\/mark>\.ts<\/strong>/);
  const escaped = renderCommandSurfaceResults("files", 0, model("files", "<P", {
    files: [file("src/<Panel&>.kt")],
  }));
  assert.match(escaped, /<mark class="command-result-match">&lt;P<\/mark>anel&amp;&gt;\.kt/);
  assert.doesNotMatch(escaped, /<mark[^>]*><P/);
  const empty = renderCommandSurfaceResults("files", 0, model("files", "", {
    files: [file("src/App.ts")],
  }));
  assert.doesNotMatch(empty, /<mark/);
});

test("Files and Recent marks follow case, whole-word and regex controls", () => {
  const insensitive = renderCommandSurfaceResults("files", 0, model("files", "app", {
    files: [file("src/App.ts")],
  }));
  assert.match(insensitive, /<mark class="command-result-match">App<\/mark>/);
  const sensitive = renderCommandSurfaceResults("files", 0, model("files", "app", {
    files: [file("src/App.ts")],
    workspaceSearchControls: { ...createWorkspaceSearchControls(), caseSensitive: true },
  }));
  assert.doesNotMatch(sensitive, /<mark/);
  const whole = renderCommandSurfaceResults("recent", 0, model("recent", "app", {
    files: [file("src/app-shell.ts")],
    workspaceSearchControls: { ...createWorkspaceSearchControls(), wholeWord: true },
  }));
  assert.match(whole, /<mark class="command-result-match">app<\/mark>-shell/);
  const regex = renderCommandSurfaceResults("files", 0, model("files", "App.*\\.ts", {
    files: [file("src/AppShell.ts")],
    workspaceSearchControls: { ...createWorkspaceSearchControls(), mode: "regex" },
  }));
  assert.match(regex, /<mark class="command-result-match">AppShell\.ts<\/mark>/);
});

test("Commands mark visible text and reveal a hidden alias when it caused the match", () => {
  const command = {
    id: "find-workspace", label: "Find in Files", detail: "Search project text",
    keywords: "workspace replace", enabled: false,
  };
  const visible = renderCommandSurfaceResults("commands", 0, model("commands", "files", {
    commands: [command],
  }));
  assert.match(visible, /<strong>Find in <mark class="command-result-match">Files<\/mark><\/strong>/);
  assert.doesNotMatch(visible, /command-result-alias/);
  assert.match(visible, /disabled>/);
  const detail = renderCommandSurfaceResults("commands", 0, model("commands", "project", {
    commands: [command],
  }));
  assert.match(detail, /<small>Search <mark class="command-result-match">project<\/mark> text<\/small>/);
  const alias = renderCommandSurfaceResults("commands", 0, model("commands", "replace", {
    commands: [command],
  }));
  assert.match(alias, /class="command-result-alias">workspace <mark class="command-result-match">replace<\/mark>/);
  const id = renderCommandSurfaceResults("commands", 0, model("commands", "find-workspace", {
    commands: [command],
  }));
  assert.match(id, /class="command-result-alias"><mark class="command-result-match">find-workspace<\/mark>/);
});

test("Text keeps the exact preview range and zero-width marker highlighted", () => {
  const preview = "x <needle&> y";
  const from = preview.indexOf("<needle&>");
  const match = {
    repositoryId: ".", path: "src/components/app.component.ts", workspacePath: "src/components/app.component.ts",
    readOnly: false, ignored: false, revision: "r1", fromUtf16: from,
    toUtf16: from + 9, line: 27, columnUtf16: from + 1,
    preview, previewFromUtf16: from, previewToUtf16: from + 9,
    leadingClipped: false, trailingClipped: false,
  };
  const search = {
    ...createWorkspaceSearchState(), status: "ready",
    report: {
      requestId: "request", matches: [match], catalogCandidates: 1,
      eligibleCandidates: 1, filesSearched: 1, bytesRead: 14,
      skippedCount: 0, skippedFiles: [], coverageReasons: [],
    },
  };
  const html = renderCommandSurfaceResults("workspace", 0, model("workspace", "<needle&>", {
    workspaceSearch: search, searchRequestIsCurrent: true,
  }));
  assert.match(html, /<span class="search-result-location" title="src\/components\/app\.component\.ts:27">app\.component\.ts:27<\/span>/);
  assert.doesNotMatch(html, /app\.component\.ts:27:\d+/);
  assert.match(html, /<code>x <mark class="command-result-match">&lt;needle&amp;&gt;<\/mark> y<\/code>/);
  match.previewToUtf16 = from;
  const zeroWidth = renderCommandSurfaceResults("workspace", 0, model("workspace", "^", {
    workspaceSearch: search, searchRequestIsCurrent: true,
  }));
  assert.match(zeroWidth, /<mark class="command-result-match zero-width"[^>]*>│<\/mark>/);
});
