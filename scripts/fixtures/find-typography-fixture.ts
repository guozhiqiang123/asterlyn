import "../../src/styles.css";
import "../../src/shared/presentation.css";
import "../../src/shell/shell.css";
import "../../src/features/files-editor/project-files.css";
import {renderProjectNavigation} from "../../src/features/files-editor/project-files-view.ts";
import {createProjectFilesState} from "../../src/features/files-editor/project-files-controller.ts";
import {buildProjectTree} from "../../src/presentation/project-tree.ts";
import {renderCommandSurface} from "../../src/features/files-editor/workspace-navigation-view.ts";
import {createWorkspaceSearchState,createWorkspaceSearchControls} from "../../src/features/files-editor/workspace-search.ts";
import {source} from "./find-results-fixture.ts";
// Actual host tree/search presentation for the rendered typography comparison.
const host=document.createElement("aside");host.id="find-font-host";host.style.cssText="position:fixed;left:-3000px;top:0;width:900px";
const treeState=createProjectFilesState();treeState.root="/repo";treeState.expandedDirectories.add("src");
host.innerHTML=`<div class="compact-file-tree" id="find-font-host-tree">${renderProjectNavigation(treeState,buildProjectTree(["src/a.ts"]),0,200)}<span class="compact-file-tree-count">2</span></div>`+renderCommandSurface({commandSurface:{mode:"workspace",query:"needle",selectedIndex:0},workspaceOpen:true,filesLoading:false,files:[],commands:[],workspaceSearch:{...createWorkspaceSearchState(),status:"ready",report:source().report},workspaceSearchControls:createWorkspaceSearchControls(),searchRequestIsCurrent:true,replacementText:"",replacementRecoveryCount:0});
host.insertAdjacentHTML("beforeend",'<div id="find-code-font-probe" style="font:20px monospace">Code</div><div id="find-rem-probe" style="width:1rem"></div>');
host.querySelector<HTMLElement>(".command-surface")!.style.position="static";document.body.append(host);
