/** A result file is identified independently of its displayed path (e.g. dependency sources). */
export interface FindTreeEntry { readonly index:number; readonly fileKey:string; readonly path:string; readonly line:number; readonly column:number; }
export interface FindResultNode { readonly id:string; readonly kind:"directory"|"file"; readonly name:string; readonly path:string; readonly children:FindResultNode[]; readonly entries:FindTreeEntry[]; count:number; }
export interface FindResultRow { readonly id:string; readonly parentId:string|null; readonly depth:number; readonly label:string; readonly node?:FindResultNode; readonly entry?:FindTreeEntry; }
export function buildFindResultTree(entries:readonly FindTreeEntry[]):FindResultNode[]{
  const roots:FindResultNode[]=[],directories=new Map<string,FindResultNode>(),files=new Map<string,FindResultNode>();
  for(const entry of entries){
    const existing=files.get(entry.fileKey);if(existing){existing.entries.push(entry);continue;}
    const parts=entry.path.split("/").filter(Boolean);if(!parts.length)continue;let children=roots;
    for(let i=0;i<parts.length-1;i++){
      const path=parts.slice(0,i+1).join("/");let node=directories.get(path);
      if(!node){node={id:`directory:${path}`,kind:"directory",name:parts[i]!,path,children:[],entries:[],count:0};directories.set(path,node);children.push(node);}
      children=node.children;
    }
    let file=files.get(entry.fileKey);
    if(!file){file={id:`file:${entry.fileKey}`,kind:"file",name:parts.at(-1)!,path:entry.path,children:[],entries:[],count:0};files.set(entry.fileKey,file);children.push(file);}
    file.entries.push(entry);
  }
  const finish=(nodes:FindResultNode[])=>{nodes.sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name)||a.id.localeCompare(b.id):a.kind==="directory"?-1:1);let count=0;for(const n of nodes){n.entries.sort((a,b)=>a.line-b.line||a.column-b.column||a.index-b.index);n.count=n.kind==="file"?n.entries.length:finish(n.children);count+=n.count;}return count;};finish(roots);return roots;
}
export function findResultBranches(nodes:readonly FindResultNode[]):FindResultNode[]{return nodes.flatMap(n=>[n,...findResultBranches(n.children)]);}
export function findResultRows(nodes:readonly FindResultNode[],expanded:ReadonlySet<string>):FindResultRow[]{
  const rows:FindResultRow[]=[];
  const visit=(items:readonly FindResultNode[],depth:number,parentId:string|null)=>{for(let node of items){let label=node.name;
    while(node.kind==="directory"&&node.children.length===1&&node.children[0]?.kind==="directory"){node=node.children[0];label+=`/${node.name}`;}
    rows.push({id:node.id,parentId,depth,label,node});if(!expanded.has(node.id))continue;
    if(node.kind==="directory")visit(node.children,depth+1,node.id);
    else for(const entry of node.entries)rows.push({id:`result:${entry.index}`,parentId:node.id,depth:depth+1,label:`${entry.line}:${entry.column}`,entry});
  }};visit(nodes,0,null);return rows;
}
