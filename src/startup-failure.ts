export interface StartupFailureCopy {
  title: string;
  detail: string;
  retry: string;
}

const ENGLISH_COPY: StartupFailureCopy = {
  title: "Asterlyn could not start",
  detail: "The application failed to load. Your project files were not changed. Try reloading the window.",
  retry: "Reload",
};

const CHINESE_COPY: StartupFailureCopy = {
  title: "Asterlyn 未能启动",
  detail: "应用加载失败，你的项目文件没有被修改。请尝试重新加载窗口。",
  retry: "重新加载",
};

export function startupFailureCopy(
  languages: readonly string[] = [],
): StartupFailureCopy {
  return languages[0]?.toLowerCase().startsWith("zh") ? CHINESE_COPY : ENGLISH_COPY;
}

export function startupFailureMarkup(copy: StartupFailureCopy): string {
  return `<main class="startup-failure" role="alert" aria-labelledby="startup-failure-title">
    <section class="startup-failure-card">
      <div class="startup-failure-mark" aria-hidden="true">A</div>
      <h1 id="startup-failure-title">${copy.title}</h1>
      <p>${copy.detail}</p>
      <button type="button" data-startup-reload>${copy.retry}</button>
    </section>
  </main>`;
}

export function renderStartupFailure(
  documentRef: Document,
  languages: readonly string[] = [],
  reload: () => void = () => documentRef.defaultView?.location.reload(),
): boolean {
  documentRef.documentElement.dataset.startupState = "failed";
  const root = documentRef.querySelector<HTMLElement>("#app");
  if (!root) return false;

  root.innerHTML = startupFailureMarkup(startupFailureCopy(languages));
  root
    .querySelector<HTMLButtonElement>("[data-startup-reload]")
    ?.addEventListener("click", reload, { once: true });
  return true;
}
