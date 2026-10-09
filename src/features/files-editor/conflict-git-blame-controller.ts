import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { EditorCopy } from "../../localization/catalog.ts";
import { projectConflictResultBlame } from "./conflict-blame-projection.ts";
import type { ConflictGitBlameSources, GitBlameRuntime } from "./editor-gutter.ts";
import type { GitBlameDisplayMode } from "../../preferences.ts";
import { GitBlamePaneController, sourceBlameTarget } from "./git-blame-pane-controller.ts";

type ConflictBlamePane = "ours" | "result" | "theirs";

/** Adapts the shared pane controller to exact conflict sides and a composite Result. */
export class ConflictGitBlameController {
  private readonly panes: GitBlamePaneController;
  private sources: ConflictGitBlameSources | null = null;
  private path = "";
  private revisionToken = "";
  private ours = "";
  private theirs = "";
  private result = "";
  private version = 0;
  private layout: "split" | "unified" = "split";
  private readonly runtime: GitBlameRuntime;

  constructor(
    runtime: GitBlameRuntime,
    copy: EditorCopy,
  ) {
    this.runtime = runtime;
    this.panes = new GitBlamePaneController(runtime, copy);
  }

  mount(
    sources: ConflictGitBlameSources,
    path: string,
    revisionToken: string,
    ours: string,
    theirs: string,
    result: string,
    layout: "split" | "unified",
    copy: EditorCopy,
  ): void {
    this.panes.setCopy(copy);
    this.sources = sources;
    this.path = path;
    this.revisionToken = revisionToken;
    this.ours = ours;
    this.theirs = theirs;
    this.result = result;
    this.version = 0;
    this.layout = layout;
    this.configure();
  }

  extensions(pane: ConflictBlamePane, compartment: Compartment): Extension[] {
    return this.panes.extensions(pane, compartment);
  }

  register(pane: ConflictBlamePane, view: EditorView, compartment: Compartment): void {
    this.panes.register(pane, view, compartment);
  }

  setDisplayMode(displayMode: GitBlameDisplayMode): void {
    this.panes.setDisplayMode(displayMode);
  }

  setPresentation(layout: "split" | "unified"): void {
    this.layout = layout;
    this.configure();
  }

  resultChanged(result: string): void {
    this.result = result;
    this.version += 1;
    this.configure();
  }

  destroy(): void {
    this.panes.destroy();
    this.sources = null;
    this.path = "";
    this.revisionToken = "";
    this.ours = "";
    this.theirs = "";
    this.result = "";
  }

  private configure(): void {
    const sources = this.sources;
    if (!sources) return;
    if (this.layout !== "split") {
      const unavailable = {
        identity: `conflict-unified\0${this.revisionToken}`,
        source: null,
        unavailableReason: sources.unifiedReason,
      };
      for (const pane of ["ours", "result", "theirs"] as const) {
        this.panes.setTarget(pane, unavailable);
      }
      return;
    }
    this.panes.setTarget("ours", sourceBlameTarget(sources.ours, "conflict-ours"));
    this.panes.setTarget("theirs", sourceBlameTarget(sources.theirs, "conflict-theirs"));
    const available = [
      { availability: sources.ours, text: this.ours },
      { availability: sources.theirs, text: this.theirs },
    ].filter((candidate) => candidate.availability.source !== null);
    this.panes.setTarget("result", {
      identity: [
        "conflict-result",
        this.revisionToken,
        this.version,
        ...available.map((candidate) => candidate.availability.source!.commitOid ?? ""),
      ].join("\0"),
      source: null,
      autoLoad: this.version === 0,
      unavailableReason: available.length > 0
        ? null
        : sources.ours.unavailableReason ?? sources.theirs.unavailableReason,
      ...(available.length > 0 ? {
        load: async () => projectConflictResultBlame(
          this.path,
          this.result,
          await Promise.all(available.map(async (candidate) => ({
            text: candidate.text,
            blame: await this.runtime.load(candidate.availability.source!),
          }))),
        ),
      } : {}),
    });
  }
}
