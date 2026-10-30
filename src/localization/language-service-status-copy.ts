export interface LanguageServiceStatusCopy {
  title:string; statusCommand:string; retry:string; forget:string; debugOn:string; debugOff:string;
  debug:string; debugHint:string; close:string; empty:string; elapsed(seconds:number):string;
  stages:Record<"preparing"|"awaiting-approval"|"declined"|"indexing"|"ready"|"failed"|"stopped"|"model"|"sources"|"backend"|"refreshing",string>;
  failure:string; partial:string;partiallyReady:string;units:Record<"modules"|"files"|"items",string>;
}
export const EN_LANGUAGE_STATUS:LanguageServiceStatusCopy={
  units:{modules:"modules",files:"files",items:"items"},title:"Language services",statusCommand:"Show language service progress",retry:"Retry language services",
  forget:"Clear this project's approval and stop services",debugOn:"Enable language service debug tracing",debugOff:"Disable language service debug tracing",
  debug:"Debug tracing",debugHint:"Only for this app session. Records operation metadata, never source text or raw server traffic. Enable it before retrying a failed project import.",close:"Close language service status",empty:"No language service is running for this project.",elapsed:seconds=>`${seconds}s`,
  stages:{preparing:"Preparing language services", "awaiting-approval":"Waiting for project approval",declined:"Not enabled for this session",indexing:"Indexing code",ready:"Ready",failed:"Language services unavailable",stopped:"Stopped",model:"Loading project model",sources:"Preparing source model",backend:"Starting language backend",refreshing:"Updating code index"},
  partiallyReady:"Partially available",failure:"Check the project model or logs, then retry.",partial:"Some language features are still being prepared.",
};
export const ZH_LANGUAGE_STATUS:LanguageServiceStatusCopy={
  units:{modules:"个模块",files:"个文件",items:"项"},title:"语言服务",statusCommand:"查看语言服务进度",retry:"重试语言服务",forget:"清除此项目授权并停止服务",
  debugOn:"开启语言服务调试追踪",debugOff:"关闭语言服务调试追踪",debug:"调试追踪",debugHint:"仅当前应用会话生效。记录操作元数据，不记录源码或原始服务通信。排查项目导入失败时，请先开启再重试。",close:"关闭语言服务状态",empty:"此项目尚无运行中的语言服务。",elapsed:seconds=>`${seconds} 秒`,
  stages:{preparing:"准备语言服务", "awaiting-approval":"等待项目授权",declined:"本次会话未启用",indexing:"正在索引代码",ready:"已就绪",failed:"语言服务不可用",stopped:"已停止",model:"加载项目模型",sources:"准备源码模型",backend:"启动语言后端",refreshing:"更新代码索引"},
  partiallyReady:"部分功能尚未就绪",failure:"请检查项目模型或日志，然后重试。",partial:"部分语言功能仍在准备中。",
};
