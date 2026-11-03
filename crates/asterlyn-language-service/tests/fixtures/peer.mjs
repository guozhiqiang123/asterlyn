// Deterministic stdio peer: never reads project files, invokes tools or uses the network.
let input=Buffer.alloc(0),delayed=null;
const documents=new Map();
function frame(value){const data=Buffer.from(JSON.stringify(value));process.stdout.write(`Content-Length: ${data.length}\r\n\r\n`);process.stdout.write(data);}
function reply(id,result){frame({jsonrpc:"2.0",id,result});}
function accept(message){
 const {id,method,params}=message;
 if(method==="initialize")return reply(id,{capabilities:{textDocumentSync:1}});
 if(method==="shutdown")return reply(id,null);
 if(method==="exit"||method==="fixture/exit")return process.exit(0);
 if(method==="textDocument/didOpen"){documents.set(params.textDocument.uri,params.textDocument.text);return;}
 if(method==="textDocument/didChange"){documents.set(params.textDocument.uri,params.contentChanges[0].text);return;}
 if(method==="fixture/text")return reply(id,documents.get(params.uri));
 if(method==="fixture/delayed"){delayed=id;return;}
 if(method==="$/cancelRequest"&&params.id===delayed){reply(delayed,"late-response");delayed=null;return;}
 if(method==="fixture/protocol"){process.stdout.write("Content-Length: not-a-number\r\n\r\n");return;}
 if(id!==undefined)reply(id,null);
}
process.stdin.on("data",chunk=>{
 input=Buffer.concat([input,chunk]);if(input.length>1024*1024)process.exit(2);
 for(;;){const boundary=input.indexOf("\r\n\r\n");if(boundary<0)return;const header=input.subarray(0,boundary).toString("ascii"),match=/Content-Length: (\d+)/iu.exec(header);if(!match)process.exit(3);const length=Number(match[1]);if(length>1024*1024)process.exit(4);if(input.length<boundary+4+length)return;const body=input.subarray(boundary+4,boundary+4+length);input=input.subarray(boundary+4+length);accept(JSON.parse(body));}
});
