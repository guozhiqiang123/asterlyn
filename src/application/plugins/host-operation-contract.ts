import type {
  SdkHostOperationDeclaration,
  SdkToolOperationParameterDeclaration,
} from "../../../packages/plugin-sdk/index.ts";

export interface HostToolOperationContract {
  readonly id: string;
  readonly parameters: readonly SdkToolOperationParameterDeclaration[];
}

const QUERY_IDS = new Set(["adb.devices"]);
const TOOL_OPERATIONS: Readonly<Record<string, readonly SdkToolOperationParameterDeclaration[]>> = Object.freeze({
  "android.apk.inspect": Object.freeze([
    Object.freeze({ name: "artifact", kind: "workspaceArtifact" as const, suffixes: Object.freeze([".apk"]) }),
  ]),
  "android.adb.install": Object.freeze([
    Object.freeze({ name: "target", kind: "executionTargetId" as const }),
    Object.freeze({ name: "artifact", kind: "workspaceArtifact" as const, suffixes: Object.freeze([".apk"]) }),
  ]),
  "android.adb.uninstall": Object.freeze([
    Object.freeze({ name: "target", kind: "executionTargetId" as const }),
    Object.freeze({ name: "application", kind: "androidApplicationId" as const }),
  ]),
  "android.adb.launch": Object.freeze([
    Object.freeze({ name: "target", kind: "executionTargetId" as const }),
    Object.freeze({ name: "component", kind: "androidComponent" as const }),
  ]),
});

export const HOST_OPERATION_IDS: ReadonlySet<string> = Object.freeze(new Set([
  ...QUERY_IDS,
  ...Object.keys(TOOL_OPERATIONS),
]));

export function hostProcessQueryIds(
  declarations: readonly SdkHostOperationDeclaration[] | undefined,
): readonly string[] {
  return Object.freeze((declarations ?? []).map((value) => value.id).filter((id) => QUERY_IDS.has(id)));
}

export function hostToolOperationContracts(
  declarations: readonly SdkHostOperationDeclaration[] | undefined,
): readonly HostToolOperationContract[] {
  return Object.freeze((declarations ?? []).flatMap((value) => {
    const parameters = TOOL_OPERATIONS[value.id];
    return parameters ? [Object.freeze({ id: value.id, parameters })] : [];
  }));
}
