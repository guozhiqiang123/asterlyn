export interface LanguageRecoveryAttempt {
  readonly attempt:number;
  readonly maximum:number;
  readonly delayMs:number;
  readonly reason:string;
}
/** Allow-listed read-service recovery. Permission, protocol and resource failures are terminal. */
export class LanguageRecoveryPolicy {
  private attempts=0;
  private healthySince:number|null=null;
  private readonly now:()=>number;
  constructor(now:()=>number=()=>performance.now()){this.now=now;}
  healthy(ready:boolean):void {
    if(!ready)this.healthySince=null;
    else this.healthySince??=this.now();
  }
  reserve(reason:string):LanguageRecoveryAttempt|null {
    if(this.healthySince!==null&&this.now()-this.healthySince>=180000)this.attempts=0;
    this.healthySince=null;
    if(!["backend-exited","language-start-backend-exited"].includes(reason)||this.attempts>=3)return null;
    const delayMs=[500,1000,2000][this.attempts++]!;
    return {attempt:this.attempts,maximum:3,delayMs,reason};
  }
  exhausted():boolean{return this.attempts>=3;}
}
