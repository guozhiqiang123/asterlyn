import type { CatalogSelection } from "../../application/language-services/catalog-selection.ts";
import type { ManagedInstallationRecommendation } from "../../application/language-services/installation-recommendation.ts";
import type { ManagedLanguageStatusCopy } from "../../localization/language-service-copy.ts";

export type ManagedLanguageStatusAction =
  | "open"
  | "install"
  | "cancel"
  | "verify"
  | "recover"
  | "suppress"
  | "dismiss";
export interface ManagedLanguageStatusLabels {
  readonly language: string;
  readonly server: string;
}
export interface ManagedLanguageStatusPresentation {
  readonly visible: boolean;
  readonly state: string;
  readonly tone: "information" | "warning" | "progress";
  readonly text: string;
  readonly busy: boolean;
  readonly progress: { readonly value: number; readonly maximum: number; readonly label: string } | null;
  readonly actions: readonly ManagedLanguageStatusAction[];
}

const HIDDEN: ManagedLanguageStatusPresentation = Object.freeze({
  visible: false, state: "hidden", tone: "information", text: "", busy: false, progress: null, actions: Object.freeze([]),
});

export function managedLanguageStatusPresentation(
  selection: CatalogSelection,
  recommendation: ManagedInstallationRecommendation,
  labels: ManagedLanguageStatusLabels,
  copy: ManagedLanguageStatusCopy,
): ManagedLanguageStatusPresentation {
  const show = (state: string, tone: ManagedLanguageStatusPresentation["tone"], text: string,
    actions: readonly ManagedLanguageStatusAction[] = [], busy = false,
    progress: ManagedLanguageStatusPresentation["progress"] = null): ManagedLanguageStatusPresentation => Object.freeze({
      visible: true, state, tone, text, busy, progress, actions: Object.freeze([...actions]),
    });
  if (selection.kind !== "selected") {
    if (["inactive", "ineligible-document", "unknown-language", "project-unmatched"].includes(selection.kind)) return HIDDEN;
    if (selection.kind === "unconfigured") return show(selection.kind, "information", copy.unconfigured(labels.language), ["open", "suppress", "dismiss"]);
    if (selection.kind === "platform-unavailable") return show(selection.kind, "warning", copy.platformUnavailable(labels.language), ["open", "suppress", "dismiss"]);
    if (selection.kind === "project-unknown") return show(selection.kind, "progress", copy.projectUnknown(labels.language), [], true);
    return show(selection.kind, "warning", copy.selectionRequired(labels.language), ["open", "suppress", "dismiss"]);
  }
  switch (recommendation.kind) {
    case "none": return HIDDEN;
    case "checking": return show("checking", "progress", copy.checking(labels.language), [], true);
    case "unavailable": return show(`unavailable-${recommendation.reason}`, "warning",
      recommendation.reason === "installation-facts" ? copy.factsUnavailable(labels.language)
        : recommendation.reason === "target" ? copy.targetUnavailable(labels.server) : copy.recipeUnavailable(labels.server),
      recommendation.reason === "installation-facts" ? ["open"] : ["open", "suppress", "dismiss"]);
    case "installing": {
      const { completedBytes, totalBytes } = recommendation.operation;
      const progress = totalBytes > 0 ? `${Math.floor(completedBytes * 100 / totalBytes)}%` : "";
      return show("installing", "progress", copy.installing(labels.server, progress), ["cancel", "open"], true,
        totalBytes > 0 ? { value: completedBytes, maximum: totalBytes, label: copy.progressLabel(labels.server) } : null);
    }
    case "removing": return show("removing", "progress", copy.removing(labels.server), ["cancel", "open"], true);
    case "verification-required": return show("verification-required", "warning", copy.verificationRequired(labels.server), ["verify", "open"]);
    case "recovery-available": return show("recovery-available", "warning", copy.recoveryAvailable(labels.server), ["recover", "open"]);
    case "install-available": return show("install-available", "information", copy.installAvailable(labels.server), ["install", "open", "suppress", "dismiss"]);
    case "installed": return HIDDEN;
  }
}

export function renderManagedLanguageStatus(
  presentation: ManagedLanguageStatusPresentation,
  copy: ManagedLanguageStatusCopy,
): string {
  if (!presentation.visible) return "";
  const progress = presentation.progress === null ? "" : `<progress value="${presentation.progress.value}" max="${presentation.progress.maximum}" aria-label="${escapeAttribute(presentation.progress.label)}"></progress>`;
  const actions = presentation.actions.map((action) => `<button type="button" data-managed-language-action="${action}">${escapeHtml(copy.actions[action])}</button>`).join("");
  return `<div class="managed-language-status ${presentation.tone}" data-managed-language-state="${escapeAttribute(presentation.state)}" ${presentation.busy ? 'aria-busy="true"' : ""}><span class="managed-language-status-message" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(presentation.text)}</span>${progress}<span class="managed-language-status-actions">${actions}</span></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
const escapeAttribute = escapeHtml;
