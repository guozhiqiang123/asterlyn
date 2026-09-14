const port = process.env.ASTERLYN_CDP_PORT ?? "9223";
const rounds = Number.parseInt(process.env.ASTERLYN_PRESENTATION_ROUNDS ?? "30", 10);
const idleSeconds = Number.parseInt(process.env.ASTERLYN_IDLE_SECONDS ?? "0", 10);
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const target = targets.find(
  (item) => item.type === "page" && item.url.includes("127.0.0.1:1420"),
);
if (!target) {
  throw new Error("Asterlyn browser target not found. Start Vite and Chrome remote debugging first.");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const completion = pending.get(message.id);
  if (!completion) return;
  pending.delete(message.id);
  if (message.error) completion.reject(new Error(message.error.message));
  else completion.resolve(message.result);
});

function send(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const measurement = await send("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(${async function measurePresentation(roundCount) {
    document.querySelector("#settings-button")?.click();
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const waitFor = async (predicate, settleFrames) => {
      const deadline = performance.now() + 3_000;
      while (!predicate()) {
        if (performance.now() > deadline) throw new Error("presentation update timed out");
        await frame();
      }
      if (settleFrames) await frame();
    };
    const measure = async (attribute, values, completed, settleFrames) => {
      const samples = [];
      for (let index = 0; index < roundCount + 2; index += 1) {
        const value = values[index % values.length];
        const control = document.querySelector(`[${attribute}="${value}"]`);
        if (!control) throw new Error(`missing presentation control: ${attribute}=${value}`);
        const start = performance.now();
        control.click();
        await waitFor(() => completed(value), settleFrames);
        if (index >= 2) samples.push(performance.now() - start);
      }
      samples.sort((left, right) => left - right);
      return {
        count: samples.length,
        medianMs: Number(samples[Math.floor(samples.length * 0.5)].toFixed(2)),
        p95Ms: Number(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)].toFixed(2)),
        maxMs: Number(samples.at(-1).toFixed(2)),
      };
    };
    document.querySelector('[data-settings-section="appearance"]')?.click();
    const themes = await measure(
      "data-setting-theme",
      ["dark", "light"],
      (value) => document.documentElement.dataset.theme === value,
      false,
    );
    document.querySelector('[data-settings-section="general"]')?.click();
    const locales = await measure(
      "data-setting-locale",
      ["en-US", "zh-CN"],
      (value) => document.documentElement.lang === value,
      true,
    );
    return { themes, locales };
  }})(${rounds})`,
});
if (measurement.exceptionDetails) {
  throw new Error(measurement.exceptionDetails.exception?.description ?? measurement.exceptionDetails.text);
}

const viewports = [];
await send("Runtime.evaluate", {
  expression: `(() => {
    document.querySelector('[data-settings-section="appearance"]')?.click();
    const font = document.querySelector('#setting-ui-font');
    if (font) {
      font.value = '14';
      font.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`,
});
for (const [width, height] of [[920, 640], [1280, 720]]) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: false,
  });
  const result = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const root = document.documentElement;
      const actions = Array.from(document.querySelectorAll("button.primary-button:not([hidden])"));
      return {
        width: innerWidth,
        height: innerHeight,
        horizontalOverflow: root.scrollWidth > root.clientWidth,
        clippedPrimaryActions: actions.filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.right > innerWidth || bounds.bottom > innerHeight || bounds.left < 0 || bounds.top < 0;
        }).length,
        locale: root.lang,
        theme: root.dataset.theme,
        uiFontSize: getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--ui-font-size').trim(),
      };
    })()`,
  });
  viewports.push(result.result.value);
}
await send("Emulation.clearDeviceMetricsOverride");

let idle = null;
if (idleSeconds > 0) {
  const idleResult = await send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(${async function measureIdle(seconds) {
      document.querySelector('[data-setting-theme="system"]')?.click();
      document.querySelector('#settings-back')?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let mutations = 0;
      const observer = new MutationObserver((records) => mutations += records.length);
      observer.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      const startedAt = performance.now();
      await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
      const elapsedMs = performance.now() - startedAt;
      observer.disconnect();
      return { seconds, elapsedMs: Number(elapsedMs.toFixed(1)), domMutations: mutations };
    }})(${idleSeconds})`,
  });
  if (idleResult.exceptionDetails) {
    throw new Error(idleResult.exceptionDetails.exception?.description ?? idleResult.exceptionDetails.text);
  }
  idle = idleResult.result.value;
}

console.log(JSON.stringify({ ...measurement.result.value, viewports, idle }, null, 2));
socket.close();
