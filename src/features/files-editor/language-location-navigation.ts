import type { ProjectFile } from "../../models.ts";
import type { EditorLanguageServiceLocation } from "../../protocol/editor-language-service.ts";
import type { LanguageServiceCopy } from "../../localization/language-service-copy.ts";
import { definitionFileKey, definitionOffsets, normalizeDefinitionTargets } from "../../application/language-services/definition-targets.ts";
import { workspaceFileUri } from "../../application/language-services/workspace-file-uri.ts";
export interface DefinitionNavigationPorts {
  workspace(): { root: string; generation: number } | null;
  files(): readonly ProjectFile[];
  open(root: string, file: ProjectFile): Promise<void>;
  openSource?(root:string,location:EditorLanguageServiceLocation):Promise<void>;
  activeUri(): string | null;
  content(): string | null;
  select(from: number, to: number): boolean;
  copy(): LanguageServiceCopy;
  status(message: string, kind: "information" | "warning"): void;
  diagnostic?(outcome: "opened" | "outside-catalog" | "stale" | "invalid-range"): void;
}
/** A window owns one navigator; concurrent opens cannot apply a prior request's selection. */
export function createLanguageDefinitionNavigator(ports: DefinitionNavigationPorts) {
  let sequence = 0;
  return async (value: EditorLanguageServiceLocation): Promise<void> => {
    const token = ++sequence, location = normalizeDefinitionTargets(value).locations[0];
    const workspace = ports.workspace(); if (!workspace || !location) return;
    const key = definitionFileKey(location.uri);
    const file = ports.files().find((item) => definitionFileKey(workspaceFileUri(workspace.root, item.workspacePath)) === key);
    if (!file && !location.readonlySource) { ports.status(ports.copy().targetUnavailable, "warning"); ports.diagnostic?.("outside-catalog"); return; }
    if(location.readonlySource){if(!ports.openSource)return;await ports.openSource(workspace.root,location);}else if(file)await ports.open(workspace.root,file);
    const current = ports.workspace();
    if (token !== sequence || current?.root !== workspace.root || current.generation !== workspace.generation || definitionFileKey(ports.activeUri()) !== key) { ports.diagnostic?.("stale"); return; }
    const content = ports.content(); if (content === null) return;
    const offsets = definitionOffsets(content, location);
    if (!offsets) { ports.status(ports.copy().invalidTargetRange, "warning"); ports.diagnostic?.("invalid-range"); return; }
    if (ports.select(offsets.from, offsets.to)) { ports.status(ports.copy().definitionOpened, "information"); ports.diagnostic?.("opened"); }
  };
}
