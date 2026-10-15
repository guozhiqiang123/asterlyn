import type { TaskExecutionState } from "../../application/tasks/task-execution-controller.ts";
import type { TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import type { TaskArtifactDiscovery } from "../../models.ts";
import { renderHostAction, renderHostDialog, type HostAction } from "../../presentation/host-presentation.ts";

export type TaskArtifactViewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly discovery: TaskArtifactDiscovery }
  | { readonly status: "unavailable" };

export function renderTaskExecutionReview(state: TaskExecutionState, copy: TaskExecutionCopy, artifactState: TaskArtifactViewState | null = null): string {
  const review = state.review;
  if (!review) return "";
  const args = review.args.length ? review.args.map((arg) => `<code>${escapeHtml(arg)}</code>`).join(" ") : "<em>∅</em>";
  const terminal = state.status === "succeeded" || state.status === "failed" || state.status === "cancelled" || state.status === "crashed";
  const active = state.status === "queued" || state.status === "running" || state.status === "cancelling";
  const output = renderOutput(state);
  const artifacts = terminal && state.status === "succeeded" ? renderArtifacts(artifactState, copy) : "";
  const actions = taskExecutionActions(state, copy, terminal, active);
  const bodyHtml = `<dl><dt>${escapeHtml(copy.provenance)}</dt><dd>${escapeHtml(review.pluginId)} / ${escapeHtml(review.providerId)} / ${escapeHtml(review.taskId)} — ${escapeHtml(review.label)}</dd><dt>${escapeHtml(copy.executable)}</dt><dd><code>${escapeHtml(review.canonicalExecutablePath)}</code><small> (${escapeHtml(review.executablePath)})</small></dd><dt>${escapeHtml(copy.arguments)}</dt><dd>${args}</dd><dt>${escapeHtml(copy.cwd)}</dt><dd><code>${escapeHtml(review.cwd)}</code></dd><dt>${escapeHtml(copy.trust)}</dt><dd>${escapeHtml(review.trust)}</dd></dl>${review.trust !== "trusted" ? `<p role="alert">${escapeHtml(copy.trustRequired)}</p>` : ""}<p role="status" aria-live="polite">${escapeHtml((copy.status[state.status] ?? state.status))}</p>${state.error ? `<p role="alert">${escapeHtml(state.error)}</p>` : ""}${output ? `<pre class="task-execution-output">${output}</pre>` : ""}${state.outputTruncated ? `<p role="alert">${escapeHtml(copy.outputTruncated)}</p>` : ""}${artifacts}`;
  return renderHostDialog({ id: "task-execution", title: copy.title, className: "task-execution-review", bodyHtml, actions });
}

function taskExecutionActions(
  state: TaskExecutionState,
  copy: TaskExecutionCopy,
  terminal: boolean,
  active: boolean,
): readonly HostAction[] {
  if (terminal) return [
    taskExecutionAction("close", copy.closeOutput, "neutral"),
    taskExecutionAction("retry", copy.retry, "recommended", { defaultFocus: true }),
  ];
  if (active) return [taskExecutionAction(
    "cancel",
    state.status === "cancelling" ? copy.cancelling : copy.cancel,
    "neutral",
    { disabled: state.status === "cancelling", defaultFocus: state.status !== "cancelling" },
  )];
  const review = state.review!;
  const starting = state.status === "starting";
  const leading = review.trust === "trusted" || review.trust === "unknown"
    ? [taskExecutionAction("deny", copy.denyTrust, "destructive", { placement: "leading", disabled: starting })]
    : [];
  const trailing: HostAction[] = [taskExecutionAction("cancel", copy.cancel, "neutral")];
  if (review.trust === "trusted") {
    trailing.push(taskExecutionAction("confirm", starting ? copy.starting : copy.confirm, "recommended", {
      disabled: state.status !== "review",
      defaultFocus: state.status === "review",
    }));
  } else {
    trailing.push(taskExecutionAction("trust", copy.trustAction, "recommended", { defaultFocus: true }));
  }
  return [...leading, ...trailing];
}

function taskExecutionAction(
  id: string,
  label: string,
  intent: HostAction["intent"],
  options: Pick<HostAction, "placement" | "disabled" | "defaultFocus"> = {},
): HostAction {
  return { id, label, intent, ...options, attributes: { "data-task-execution-action": id } };
}
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function renderOutput(state: TaskExecutionState): string {
  const streams = new Map<string, number[]>();
  for (const entry of state.outputs) {
    const bytes = streams.get(entry.stream) ?? [];
    try { const binary = atob(entry.dataBase64); for (let index = 0; index < binary.length; index += 1) bytes.push(binary.charCodeAt(index)); } catch { continue; }
    streams.set(entry.stream, bytes);
  }
  return [...streams].map(([stream, bytes]) => `<strong>${escapeHtml(stream)}</strong>\n${escapeHtml(new TextDecoder().decode(new Uint8Array(bytes)))}`).join("\n");
}

function renderArtifacts(state: TaskArtifactViewState | null, copy: TaskExecutionCopy): string {
  if (!state) return "";
  if (state.status === "loading") return `<section class="task-artifacts" aria-labelledby="task-artifacts-title"><h3 id="task-artifacts-title">${escapeHtml(copy.artifacts)}</h3><p role="status" aria-live="polite">${escapeHtml(copy.artifactSearching)}</p></section>`;
  if (state.status === "unavailable") return `<section class="task-artifacts" aria-labelledby="task-artifacts-title"><h3 id="task-artifacts-title">${escapeHtml(copy.artifacts)}</h3><p role="status">${escapeHtml(copy.artifactUnavailable)}</p></section>`;
  const rows = state.discovery.artifacts.map((artifact, index) => {
    const name = artifact.workspacePath.split("/").at(-1) ?? artifact.workspacePath;
    const reveal = renderHostAction({
      id: `reveal-artifact.${index}`,
      label: copy.revealArtifact,
      intent: "neutral",
      compact: true,
      title: copy.revealArtifact,
      attributes: { "data-task-execution-action": "reveal-artifact", "data-task-artifact-index": index },
    });
    return `<li><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(artifact.kind.toLocaleUpperCase())} · ${escapeHtml(copy.artifactSize(artifact.byteLength))}</small><code>${escapeHtml(artifact.workspacePath)}</code></span>${reveal}</li>`;
  }).join("");
  const content = rows ? `<ul>${rows}</ul>` : `<p role="status">${escapeHtml(copy.artifactNone)}</p>`;
  const truncated = state.discovery.truncated ? `<p role="alert">${escapeHtml(copy.artifactTruncated)}</p>` : "";
  return `<section class="task-artifacts" aria-labelledby="task-artifacts-title"><h3 id="task-artifacts-title">${escapeHtml(copy.artifacts)}</h3>${content}${truncated}</section>`;
}
