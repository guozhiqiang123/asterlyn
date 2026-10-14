import type { TaskExecutionState } from "../../application/tasks/task-execution-controller.ts";
import type { TaskExecutionCopy } from "../../localization/task-execution-copy.ts";

export function renderTaskExecutionReview(state: TaskExecutionState, copy: TaskExecutionCopy): string {
  const review = state.review;
  if (!review) return "";
  const args = review.args.length ? review.args.map((arg) => `<code>${escapeHtml(arg)}</code>`).join(" ") : "<em>∅</em>";
  const disabled = state.status !== "review" || review.trust !== "trusted";
  const output = renderOutput(state);
  return `<section class="task-execution-review" role="dialog" aria-modal="true" aria-labelledby="task-execution-title"><h2 id="task-execution-title">${escapeHtml(copy.title)}</h2><dl><dt>${escapeHtml(copy.provenance)}</dt><dd>${escapeHtml(review.pluginId)} / ${escapeHtml(review.providerId)} / ${escapeHtml(review.taskId)} — ${escapeHtml(review.label)}</dd><dt>${escapeHtml(copy.executable)}</dt><dd><code>${escapeHtml(review.canonicalExecutablePath)}</code><small> (${escapeHtml(review.executablePath)})</small></dd><dt>${escapeHtml(copy.arguments)}</dt><dd>${args}</dd><dt>${escapeHtml(copy.cwd)}</dt><dd><code>${escapeHtml(review.cwd)}</code></dd><dt>${escapeHtml(copy.trust)}</dt><dd>${escapeHtml(review.trust)}</dd></dl>${review.trust !== "trusted" ? `<p role="alert">${escapeHtml(copy.trustRequired)}</p>` : ""}<p role="status">${escapeHtml((copy.status[state.status] ?? state.status))}</p>${output ? `<pre class="task-execution-output">${output}</pre>` : ""}${state.outputTruncated ? `<p role="alert">${escapeHtml(copy.outputTruncated)}</p>` : ""}<div class="task-execution-actions">${review.trust !== "trusted" ? `<button type="button" data-task-execution-action="trust">${escapeHtml(copy.trustAction)}</button>` : ""}${review.trust === "trusted" || review.trust === "unknown" ? `<button type="button" data-task-execution-action="deny">${escapeHtml(copy.deny)}</button>` : ""}<button type="button" data-task-execution-action="confirm" ${disabled ? "disabled" : ""}>${escapeHtml(copy.confirm)}</button><button type="button" data-task-execution-action="cancel">${escapeHtml(copy.cancel)}</button></div></section>`;
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
