export type NavigationCommandId =
  | "open-repository" | "go-file" | "recent-files" | "find-workspace"
  | "navigate-back" | "navigate-forward"
  | "find-current" | "save-current" | "refresh"
  | "open-settings" | "close-settings"
  | "toggle-files" | "toggle-search" | "toggle-changes" | "toggle-git" | "toggle-stash" | "toggle-tasks" | "toggle-terminal"
  | "hide-left-tool" | "hide-bottom-tool";

export interface NavigationCopy {
  historyUnavailable: string;
  navigationMode: string;
  tabs: Record<"files" | "recent" | "workspace" | "commands", string>;
  titles: Record<"files" | "recent" | "workspace" | "commands", string>;
  hints: Record<"files" | "recent" | "workspace" | "commands", string>;
  close: string;
  useRegularExpressions: string;
  regularExpression: string;
  searchOptions: string; newLine: string; matchCase: string; words: string;
  filterIgnoredFiles: string;
  navigate: string;
  open: string;
  resultCount(mode: "files" | "recent" | "workspace" | "commands", count: number): string; openInWindow: string; findWindow: string; hideFindWindow: string; findResultsAria: string; noFindResults: string; noFindResultsDetail: string;
  workspaceSearchOptions: string;
  include: string;
  includeAria: string;
  exclude: string;
  excludeAria: string;
  context: string;
  contextLines: string;
  replace: string;
  replacementText: string;
  previewReplace: string;
  replacementRequiresIgnoredFilter: string;
  reviewRecoveries(count: number): string;
  recoveryRecords(count: number): string;
  noMatchingCommands: string;
  broaderCommand: string;
  noRecentFiles: string;
  noMatchingFiles: string;
  recentFilesDetail: string;
  catalogLoading: string;
  fileQueryDetail: string;
  searchingProject: string;
  boundedSearchDetail: string;
  searchFailed: string;
  tryAgain: string;
  searchFileContents: string;
  searchInstructions: string;
  noSubsetMatches: string;
  noMatches: string;
  zeroWidthMatch: string;
  coverageMatches(count: number): string;
  coverageFiles(searched: number, catalog: number): string;
  coverageEligible(searched: number, eligible: number, catalog: number): string;
  coverageIndexed(count: number): string;
  coverageComplete: string;
  coveragePartial(reasons: string): string;
  coverageReasons: Record<"catalogTruncated" | "candidateLimit" | "byteLimit" | "matchLimit", string>;
  coverageSkipped(count: number): string;
  commands: Record<NavigationCommandId, { label: string; detail: string; aliases: string }>;
}
