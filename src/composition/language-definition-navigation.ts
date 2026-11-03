import {createLanguageDefinitionNavigator as createNavigator,type DefinitionNavigationPorts} from "../features/files-editor/language-location-navigation.ts";
import {diagnostics} from "../application/diagnostics.ts";
export type {DefinitionNavigationPorts};
export function createLanguageDefinitionNavigator(ports:DefinitionNavigationPorts){
  return createNavigator({...ports,diagnostic:ports.diagnostic??(outcome=>diagnostics.report("info","language.definition.navigation",`outcome=${outcome}`))});
}
export {createFindLocationSourcePorts as createFindLanguageResultsPorts} from "../features/files-editor/find-location-source.ts";
