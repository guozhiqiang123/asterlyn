export interface EditorRuntimePreloadTarget {
  preloadRuntimes(): void;
}

export interface IdleScheduler {
  request(callback: () => void): void;
}

/**
 * Warms the lazily imported editor runtimes on the first idle moment after a workspace is open, so the
 * first file or Diff open no longer pays to fetch and parse their modules. This loads application code
 * only: it reads no repository data, holds no live timer, and never runs on the workspace-open path
 * itself. Returns a disposer that cancels a preload that has not started yet.
 */
export function scheduleEditorRuntimePreload(
  target: EditorRuntimePreloadTarget,
  scheduler: IdleScheduler = defaultIdleScheduler(),
): () => void {
  let cancelled = false;
  scheduler.request(() => {
    if (!cancelled) target.preloadRuntimes();
  });
  return () => {
    cancelled = true;
  };
}

function defaultIdleScheduler(): IdleScheduler {
  if (typeof window === "undefined") {
    return { request: (callback) => callback() };
  }
  const idle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options: { timeout: number }) => number;
  }).requestIdleCallback;
  return {
    request: (callback) => {
      if (typeof idle === "function") idle(callback, { timeout: 3_000 });
      else window.setTimeout(callback, 250);
    },
  };
}
