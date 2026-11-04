import type {HostNotificationPublisher} from "../../application/notifications/notification-center.ts";
import type {LanguageServiceStatus} from "./language-service-client.ts";
import {EN_LANGUAGE_STATUS,ZH_LANGUAGE_STATUS} from "../../localization/language-service-status-copy.ts";
import {projectLanguageFailureMessage} from "../../localization/project-language-failure-copy.ts";

/** Loaded on the first actionable failure; ordinary indexing adds no notification work. */
export class LanguageProjectFailureNotifications {
  private readonly episodes=new Map<string,string>();
  private readonly publisher:HostNotificationPublisher;
  private readonly locale:()=>"en"|"zh-CN";
  constructor(publisher:HostNotificationPublisher,locale:()=>"en"|"zh-CN"){this.publisher=publisher;this.locale=locale;}
  reset():void {this.episodes.clear();}
  forget(id:string):void {this.episodes.delete(id);}
  observe(id:string,status:LanguageServiceStatus):void {
    if(status.state==="ready"&&(!status.progress||status.progress.phase==="ready")){this.episodes.delete(id);return;}
    if((status.state!=="failed"&&status.progress?.phase!=="failed")||(!status.failure?.project&&status.failure?.code!=="resource-limit"))return;
    const signature=JSON.stringify(status.failure);
    if(this.episodes.get(id)===signature)return;
    const message=status.failure?.code==="resource-limit"?(this.locale()==="zh-CN"?ZH_LANGUAGE_STATUS:EN_LANGUAGE_STATUS).failureReasons["resource-limit"]:projectLanguageFailureMessage(status.failure?.project,this.locale());
    if(message){this.episodes.set(id,signature);this.publisher.publish({kind:"error",message,source:"language-services"});}
  }
}
