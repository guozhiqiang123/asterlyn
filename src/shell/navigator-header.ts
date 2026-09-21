/**
 * The left tool window header is one shared DOM host for the Files and Changes tools. Files presents
 * the project name alone and hands the whole header — except its own control cluster — to the
 * workspace-root context target; Changes presents its own title and changed-entry tally and releases
 * that target.
 */
export interface NavigatorHeaderHost {
  readonly header: HTMLElement;
  readonly title: HTMLElement;
  readonly count: HTMLElement;
  readonly hide: HTMLButtonElement;
}

export function navigatorHeaderHost(root: ParentNode): NavigatorHeaderHost {
  const require = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing navigator header element: ${selector}`);
    return element;
  };
  return {
    header: require("#navigator-header"),
    title: require("#navigator-title"),
    count: require("#navigator-count"),
    hide: require("#hide-left-tool"),
  };
}

export function renderFilesNavigatorHeader(
  host: NavigatorHeaderHost,
  projectName: string,
  hideLabel: string,
): void {
  host.title.textContent = projectName;
  // The project name identifies the workspace; the workspace file tally is deliberately not shown.
  host.count.classList.add("hidden");
  host.count.textContent = "";
  host.count.removeAttribute("title");
  host.header.dataset.projectRoot = "";
  hideToolWindow(host, hideLabel);
}

export function renderChangesNavigatorHeader(
  host: NavigatorHeaderHost,
  title: string,
  changedEntries: number,
  countTitle: string,
  hideLabel: string,
): void {
  clearNavigatorRootTarget(host);
  host.title.textContent = title;
  host.count.classList.remove("hidden");
  host.count.textContent = changedEntries.toString();
  host.count.title = countTitle;
  hideToolWindow(host, hideLabel);
}

export function clearNavigatorRootTarget(host: NavigatorHeaderHost): void {
  delete host.header.dataset.projectRoot;
}

function hideToolWindow(host: NavigatorHeaderHost, label: string): void {
  host.hide.setAttribute("aria-label", label);
  host.hide.title = label;
}
