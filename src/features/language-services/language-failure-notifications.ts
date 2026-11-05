import type {HostNotificationPublisher} from "../../application/notifications/notification-center.ts";
import type {LanguageServiceStatus} from "./language-service-client.ts";
import {languageServiceFailureMessage} from "../../localization/language-service-failure-copy.ts";
import {shouldNotifyLanguageFailure} from "../../application/language-services/failure-notification-policy.ts";

/** Loaded on the first actionable failure; ordinary indexing adds no notification work. */
export class LanguageFailureNotifications {
  private readonly episodes=new Map<string,string>();
  private readonly publisher:HostNotificationPublisher;
  private readonly locale:()=>"en"|"zh-CN";
  constructor(publisher:HostNotificationPublisher,locale:()=>"en"|"zh-CN"){this.publisher=publisher;this.locale=locale;}
  reset():void {this.episodes.clear();}
  forget(id:string):void {this.episodes.delete(id);}
  observe(id:string,status:LanguageServiceStatus):void {
    if(status.state==="ready"&&(!status.progress||status.progress.phase==="ready")){this.episodes.delete(id);return;}
    if(!shouldNotifyLanguageFailure(status))return;
    const signature=JSON.stringify([status.failure?.code,status.code,status.failure?.project]);
    if(this.episodes.get(id)===signature)return;
    const message=languageServiceFailureMessage(status.failure,status.code,this.locale());
    if(message){this.episodes.set(id,signature);this.publisher.publish({kind:"error",message,source:"language-services"});}
  }
}
