import {workspaceFileUri} from "../../application/language-services/workspace-file-uri.ts";
import type {ProjectFile,TextFileSnapshot} from "../../models.ts";
import type {EditorLanguageServiceLocation} from "../../protocol/editor-language-service.ts";
import type {TextTabState} from "./editor-session.ts";
import {definitionFileKey} from "../../application/language-services/definition-targets.ts";

export interface FindLocationSourcePorts {
  workspace():{root:string;generation:number}|null;
  files():readonly ProjectFile[];
  buffers():readonly TextTabState[];
  capture():void;
  navigate(location:EditorLanguageServiceLocation):Promise<void>;
  read(root:string,file:ProjectFile):Promise<TextFileSnapshot>;
}

/** Locations are presentation data; only the host catalog authorizes a preview read. */
export function createFindLocationSourcePorts(ports:FindLocationSourcePorts) {
  let catalog:readonly ProjectFile[]|null=null,catalogRoot="";
  const byUri=new Map<string,ProjectFile>();
  return {
    activeWorkspaceGeneration:()=>ports.workspace()?.generation??null,
    openLocation:ports.navigate,
    readLocationSource:async(root:string,location:EditorLanguageServiceLocation):Promise<string|null>=>{
      const scope=ports.workspace();if(scope?.root!==root)return null;
      const key=definitionFileKey(location.uri);if(key===null)return null;
      const files=ports.files();
      if(catalog!==files||catalogRoot!==root){
        byUri.clear();catalog=files;catalogRoot=root;
        for(const file of files){const fileKey=definitionFileKey(workspaceFileUri(root,file.workspacePath));if(fileKey!==null)byUri.set(fileKey,file);}
      }
      const file=byUri.get(key);if(!file)return null;
      ports.capture();
      const tab=ports.buffers().find(tab=>tab.status==="ready"&&tab.document.repositoryRoot===root&&tab.document.workspacePath===file.workspacePath);
      if(tab)return tab.content.length<=512*1024?tab.content:null;
      const snapshot=await ports.read(root,file),current=ports.workspace();
      return current?.root===root&&current.generation===scope.generation&&snapshot.byteLength<=512*1024?snapshot.content:null;
    },
  };
}
