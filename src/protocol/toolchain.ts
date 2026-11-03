/** Read-only inspected facts. This snapshot grants no execution authority. */
export interface JavaToolchainSnapshot {
  readonly id:string;
  readonly role:"build-runtime"|"build-model"|"language-server";
  readonly source:"installed"|"environment"|"project"|"user"|"command-line";
  readonly version:string; readonly major:number;
  readonly home:string; readonly executable:string; readonly identity:string;
  readonly requirement:{readonly minimumMajor:number;readonly maximumMajorExclusive?:number};
  readonly selectionReason:string;
}
