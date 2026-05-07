import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const targetUrl = "http://127.0.0.1:4173/";
const viewports = [
  { name: "desktop", width: 1440, height: 900, port: 9333 },
  { name: "mobile", width: 390, height: 844, port: 9334 }
];

for (const viewport of viewports) {
  await runViewport(viewport);
}

console.log("browser smoke passed");

async function runViewport({ name, width, height, port }) {
  const userDataDir = mkdtempSync(join(tmpdir(), `ai-lab-smoke-${name}-`));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    targetUrl
  ], { stdio: "ignore" });

  try {
    const wsUrl = await waitForWsUrl(port);
    const client = await cdp(wsUrl);
    await waitForReady(client);
    const smoke = await evaluate(client, `(() => {
      const before = document.querySelector('.metric strong')?.textContent || '';
      document.querySelector('[data-tab="Options Ladder"]').click();
      const optionsVisible = document.body.textContent.includes('Convex sleeve design');
      document.querySelector('[data-tab="Idea Board"]').click();
      document.querySelector('#ideaAuthor').value = 'QA';
      document.querySelector('#ideaTrade').value = 'RMBS common plus LEAPS';
      document.querySelector('#ideaNote').value = 'Smoke-test collaboration note';
      document.querySelector('#addIdeaButton').click();
      const ideaVisible = document.body.textContent.includes('Smoke-test collaboration note');
      const slider = document.querySelector('[data-factor="capex"]');
      slider.value = '20';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const after = document.querySelector('.metric strong')?.textContent || '';
      document.querySelector('#copyScenario').click();
      const hashOk = location.hash.startsWith('#scenario=');
      const sourceVisible = Array.from(document.querySelectorAll('[data-tab]')).length === 7;
      return {
        title: document.title,
        before,
        after,
        changed: before !== after,
        optionsVisible,
        ideaVisible,
        hashOk,
        sourceVisible,
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2
      };
    })()`);
    await client.close();
    assert(smoke.title === "AI Boom Bottleneck Investment Lab", `${name}: wrong title`);
    assert(smoke.optionsVisible, `${name}: options tab did not render`);
    assert(smoke.ideaVisible, `${name}: idea board note did not render`);
    assert(smoke.changed, `${name}: slider did not change metrics`);
    assert(smoke.hashOk, `${name}: scenario hash not created`);
    assert(smoke.sourceVisible, `${name}: tabs missing`);
    assert(smoke.noHorizontalOverflow, `${name}: horizontal overflow ${smoke.scrollWidth} > ${smoke.innerWidth}`);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function waitForWsUrl(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
      const page = pages.find((item) => item.type === "page" && item.url === targetUrl) ||
        pages.find((item) => item.type === "page" && item.url?.startsWith(targetUrl));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      await delay(150);
    }
  }
  throw new Error(`Chrome DevTools port ${port} did not become ready`);
}

async function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    send(method, params = {}) {
      const messageId = id++;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    close() {
      socket.close();
    }
  };
}

async function waitForReady(client) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await evaluate(client, `document.readyState === 'complete' && !!document.querySelector('[data-tab="Optimizer"]')`);
    if (ready) return;
    await delay(100);
  }
  throw new Error("Page did not become ready");
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1200);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
