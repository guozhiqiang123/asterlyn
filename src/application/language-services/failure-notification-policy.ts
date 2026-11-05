import type {NativeLanguageServiceFailure} from "../../protocol/generated-native-language-types.ts";

interface FailureState {
  readonly state:string;
  readonly code?:string;
  readonly reported?:boolean;
  readonly progress?:{readonly phase:string};
  readonly failure?:Pick<NativeLanguageServiceFailure,"code">;
}
/** Only settled failures notify. Deliberate stops and bounded recovery stay quiet. */
export function shouldNotifyLanguageFailure(status:FailureState):boolean {
  const settled=status.state==="failed"||((status.state==="ready"||status.state==="partial")&&status.progress?.phase==="failed");
  return settled&&!status.reported&&!['cancelled','authority-revoked'].includes(status.failure?.code??'')
    &&!['requested-stop','session-ended','cancelled','request-cancelled','authority-revoked','language-approval-revoked','language-execution-identity-changed'].includes(status.code??'');
}
