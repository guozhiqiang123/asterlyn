import type { RemotePushState } from "./remote-push-state.ts";

export const PUSH_PREVIEW_SCROLL_THRESHOLD = 72;

interface PreservedPushPreviewScroll {
  scrollTop: number;
  previewToken: string | null;
}

const preservedScrollTops = new WeakMap<object, PreservedPushPreviewScroll>();

export interface PushPreviewScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface PushPreviewPagingState {
  dialogOpen: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  pagingFailed: boolean;
}

export function shouldLoadPushPreviewPage(
  metrics: PushPreviewScrollMetrics,
  state: PushPreviewPagingState,
  threshold = PUSH_PREVIEW_SCROLL_THRESHOLD,
): boolean {
  if (!state.dialogOpen || !state.hasMore || state.loadingMore || state.pagingFailed) {
    return false;
  }
  const distanceFromBottom = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return distanceFromBottom <= Math.max(0, threshold);
}

export function loadPushPreviewPageNearBottom(
  metrics: PushPreviewScrollMetrics,
  state: PushPreviewPagingState,
  load: () => void,
  threshold = PUSH_PREVIEW_SCROLL_THRESHOLD,
): boolean {
  if (!shouldLoadPushPreviewPage(metrics, state, threshold)) return false;
  load();
  return true;
}

export function bindPushPreviewPaging(
  host: HTMLElement,
  state: () => PushPreviewPagingState,
  load: () => void,
): () => void {
  const attempt = () => loadPushPreviewPageNearBottom({
    scrollTop: host.scrollTop,
    scrollHeight: host.scrollHeight,
    clientHeight: host.clientHeight,
  }, state(), load);
  const handleScroll = () => { attempt(); };
  const handleWheel = (event: WheelEvent) => {
    if (event.deltaY > 0) attempt();
  };
  host.addEventListener("scroll", handleScroll, { passive: true });
  host.addEventListener("wheel", handleWheel, { passive: true });
  return () => {
    host.removeEventListener("scroll", handleScroll);
    host.removeEventListener("wheel", handleWheel);
  };
}

export function bindPushPreviewPagingSurface(
  root: ParentNode,
  state: Pick<
    RemotePushState,
    "dialog" | "pushPreview" | "pushPreviewLoadingMore" | "pushPreviewPagingError"
  >,
  load: () => void,
  loadingLabel: string,
): void {
  const host = root.querySelector<HTMLElement>(".push-commit-list");
  if (!host) return;
  const saved = preservedScrollTops.get(root);
  if (saved?.previewToken === (state.pushPreview?.previewToken ?? null)) {
    host.scrollTop = saved.scrollTop;
  }
  if (saved) {
    preservedScrollTops.delete(root);
  }
  const request = () => {
    renderPushPreviewPagingLoading(root, loadingLabel);
    preservedScrollTops.set(root, {
      scrollTop: host.scrollTop,
      previewToken: state.pushPreview?.previewToken ?? null,
    });
    load();
  };
  bindPushPreviewPaging(host, () => ({
    dialogOpen: state.dialog === "push",
    hasMore: state.pushPreview?.hasMore === true,
    loadingMore: state.pushPreviewLoadingMore,
    pagingFailed: state.pushPreviewPagingError !== null,
  }), request);
  root.querySelector<HTMLButtonElement>("#push-commit-page-retry")?.addEventListener(
    "click",
    request,
  );
}

function renderPushPreviewPagingLoading(root: ParentNode, label: string): void {
  const status = root.querySelector<HTMLElement>("#push-commit-page-status");
  if (!status) return;
  status.className = "push-commit-page-status loading";
  status.removeAttribute("aria-hidden");
  status.setAttribute("role", "status");
  status.replaceChildren(spinner(), text(label));
}

function spinner(): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = "spinner";
  element.setAttribute("aria-hidden", "true");
  return element;
}

function text(value: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.textContent = value;
  return element;
}
