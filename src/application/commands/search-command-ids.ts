import { commandId } from "./command-service.ts";

export type SearchCommandAction =
  | "locate-current" | "toggle-results-view" | "expand-results" | "collapse-results";

export const SEARCH_COMMANDS = {
  locateCurrent: commandId("search.results.locateCurrent"),
  toggleResultsView: commandId("search.results.view.toggle"),
  expandResults: commandId("search.results.expand"),
  collapseResults: commandId("search.results.collapse"),
} as const;
