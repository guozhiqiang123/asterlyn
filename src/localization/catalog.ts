import type { EffectiveLocale } from "../presentation/presentation-environment.ts";

export interface CommonCopy {
  ready: string;
  operationFailed: string;
  cancel: string;
  close: string;
  retry: string;
  planned: string;
  available: string;
}

export interface ShellCopy {
  projectMenu: string;
  openProject: string;
  noProject: string;
  projectMenuFor(name: string): string;
  openProjectMenu: string;
  open: string;
  recentProjects: string;
  noOtherRecentProjects: string;
  browserDemo: string;
  search: string;
  searchFilesAndCommands: string;
  remoteActions: string;
  remoteForActions: string;
  noRemote: string;
  fetchBranch: string;
  updateBranch: string;
  pushBranch: string;
  cancelRemote: string;
  refreshProject: string;
  refreshShortcut: string;
  openSettings: string;
  settings: string;
  windowControls: string;
  minimizeWindow: string;
  minimize: string;
  maximizeWindow: string;
  maximize: string;
  restoreWindow: string;
  restore: string;
  closeWindow: string;
  toolWindows: string;
  version(name: string, version: string): string;
  files: string;
  branches: string;
  changes: string;
  toolReorder(label: string): string;
  openFolderFirst: string;
  gitUnavailableReorder: string;
  genericTool: string;
  leftToolWindow: string;
  hideFiles: string;
  hideChanges: string;
  waitingForProject: string;
  resizeLeft: string;
  editor: string;
  welcome: string;
  showOpenFiles: string;
  openFiles: string;
  editorName(name: string): string;
  openFolder: string;
  openFolderDetail: string;
  resizeGit: string;
  branchesAndLog: string;
  prepareGitOperation: string;
  gitOperations: string;
  recoverChanges: string;
  hideGit: string;
  commitLog: string;
  gitDetails: string;
  resizeBranchTree: string;
  resizeGitDetails: string;
  returnToWorkbench: string;
  backToWorkbench: string;
  settingsGroups: string;
  currentEncoding: string;
  dismissError: string;
  selectCommitOrBranch: string;
  inspectorDetail: string;
  simulateOpenFolder: string;
  demoFolderDetail: string;
  projectFolderPath: string;
  openProjectAction: string;
  whereOpenProject: string;
  targetWindowDetail: string;
  cancelOpeningProject: string;
  currentWindow: string;
  newWindow: string;
  folder: string;
  gitUnavailable: string;
  detachedAt(oid: string): string;
  noBranch: string;
  openingProject: string;
  refreshingRepository: string;
  refreshingProjectFiles: string;
}

export interface SettingsCopy {
  planned: string;
  available: string;
  sections: Record<"general" | "appearance" | "editor" | "version-control" | "code", string>;
  generalTitle: string;
  generalDescription: string;
  languageLabel: string;
  languageDescription: string;
  languageSystem: string;
  languageEnglish: string;
  languageChinese: string;
  appearanceTitle: string;
  appearanceDescription: string;
  themeLabel: string;
  themeDescription: string;
  themeSystem: string;
  themeDark: string;
  themeLight: string;
  applicationFontLabel: string;
  applicationFontDescription: string;
  applicationFontAria: string;
  editorTitle: string;
  editorDescription: string;
  editorFontLabel: string;
  editorFontDescription: string;
  editorFontSizeLabel: string;
  editorFontSizeDescription: string;
  editorFontSizeAria: string;
  lineSpacingLabel: string;
  lineSpacingDescription: string;
  lineSpacingAria: string;
  letterSpacingLabel: string;
  letterSpacingDescription: string;
  letterSpacingAria: string;
  defaultPixels(value: number): string;
  indentLabel: string;
  indentDescription: string;
  indentAria: string;
  spaces(value: number): string;
  tabWidthLabel: string;
  tabWidthDescription: string;
  tabWidthAria: string;
  versionControlTitle: string;
  versionControlDescription: string;
  diffLayoutLabel: string;
  diffLayoutDescription: string;
  diffLayoutAria: string;
  sideBySide: string;
  unified: string;
  whitespaceLabel: string;
  whitespaceDescription: string;
  showWhitespace: string;
  codeTitle: string;
  codeDescription: string;
  syntaxHighlighting: string;
  syntaxDescription: string;
  formatting: string;
  formattingDescription: string;
  includedWithApp: string;
  downloadingFont(label: string): string;
  downloadedFont: string;
  uncachedFont: string;
  cachedFont: string;
  fontReady: string;
  retryFont(label: string): string;
  editorFontAria: string;
}

export type NavigationCommandId =
  | "open-repository"
  | "go-file"
  | "recent-files"
  | "find-workspace"
  | "find-current"
  | "save-current"
  | "refresh"
  | "toggle-files"
  | "toggle-changes"
  | "toggle-git";

export interface NavigationCopy {
  navigationMode: string;
  tabs: Record<"files" | "recent" | "workspace" | "commands", string>;
  titles: Record<"files" | "recent" | "workspace" | "commands", string>;
  hints: Record<"files" | "recent" | "workspace" | "commands", string>;
  close: string;
  useRegularExpressions: string;
  regularExpression: string;
  enter: string;
  enterToSearch: string;
  navigate: string;
  open: string;
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
  commands: Record<NavigationCommandId, { label: string; detail: string; aliases: string }>;
}

export interface LocaleCatalog {
  readonly locale: EffectiveLocale;
  readonly common: CommonCopy;
  readonly shell: ShellCopy;
  readonly settings: SettingsCopy;
  readonly navigation: NavigationCopy;
  readonly editorPhrases: Readonly<Record<string, string>>;
  readonly documentDescription: string;
}
