import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const targetUrl = process.env.AI_LAB_SMOKE_URL || "http://127.0.0.1:4173/";
const viewports = [
  { name: "desktop", width: 1440, height: 900, port: 9333 },
  { name: "laptop", width: 1280, height: 800, port: 9334 },
  { name: "mobile", width: 390, height: 844, port: 9335 },
  { name: "large-mobile", width: 430, height: 932, port: 9336 }
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
      document.querySelector('#optionsInput').value = '60';
      document.querySelector('#optionsInput').dispatchEvent(new Event('change', { bubbles: true }));
      const coupledAllocation = document.querySelector('#equityInput')?.value === '40' &&
        document.querySelector('#optionsInput')?.value === '60';
      document.querySelector('#equityInput').value = '30';
      document.querySelector('#equityInput').dispatchEvent(new Event('change', { bubbles: true }));
      const reverseCoupledAllocation = document.querySelector('#equityInput')?.value === '30' &&
        document.querySelector('#optionsInput')?.value === '70';
      const sleeveTotal = Number(document.querySelector('#equityInput')?.value || 0) +
        Number(document.querySelector('#optionsInput')?.value || 0);
      const sleeveTotalVisible = document.body.textContent.includes('Equity + options split') &&
        document.body.textContent.includes('100%');
      const topbarRects = ['.brand', '.tabs', '.top-actions'].map((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      const overlaps = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 1 &&
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 1;
      const topbarNoOverlap = topbarRects.every((rect) => rect.width > 0 && rect.height > 0) &&
        !overlaps(topbarRects[0], topbarRects[1]) &&
        !overlaps(topbarRects[0], topbarRects[2]) &&
        !overlaps(topbarRects[1], topbarRects[2]);
      const titleVisible = document.querySelector('.brand h1')?.textContent === 'AI Boom Bottleneck Investment Lab' &&
        document.querySelector('.brand h1')?.getClientRects().length > 0;
      document.querySelector('#earlyMoverInput').value = 'unusual';
      document.querySelector('#earlyMoverInput').dispatchEvent(new Event('change', { bubbles: true }));
      const earlyMoverControl = document.querySelector('#earlyMoverInput')?.value === 'unusual';
      const boundedSelectors = ['.brand', '.tabs', '.top-actions', '.grid-shell', '.workspace', '.metrics-grid', '.chart-panel', '.control-rail'];
      const boundedLayout = boundedSelectors.every((selector) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= window.innerWidth + 1;
      });
      document.querySelector('#closeInspector')?.click();
      const inspectorClosed = !document.querySelector('.inspector') &&
        document.querySelector('.grid-shell')?.classList.contains('inspector-closed') &&
        document.body.textContent.includes('Show detail');
      document.querySelector('#toggleInspector')?.click();
      const inspectorReopened = !!document.querySelector('.inspector') &&
        document.body.textContent.includes('Hide detail');
      document.querySelector('[data-tab="Timeline"]').click();
      const timelineVisible = document.body.textContent.includes('Editable investment timeline');
      document.querySelector('[data-set-timeline="0.07"]').click();
      const zeroDteVisible = document.body.textContent.includes('0DTE / 1-2DTE Public Event Tape') &&
        document.body.textContent.includes('public tape only');
      document.querySelector('[data-tab="Options Ladder"]').click();
      const optionsVisible = document.body.textContent.includes('Convex sleeve design');
      const combosVisible = document.body.textContent.includes('Combo Strategy Selector') &&
        document.body.textContent.includes('Covered Call / Buy-Write') &&
        document.body.textContent.includes('Protective Collar');
      document.querySelector('[data-tab="Event Radar"]').click();
      const eventVisible = document.body.textContent.includes('Late-breaking trade radar') &&
        document.body.textContent.includes('AI chip export-control');
      document.querySelector('[data-tab="Early Movers"]').click();
      const earlyMoversVisible = document.body.textContent.includes('Known early mover filter') &&
        document.body.textContent.includes('Schedule 13D/13G') &&
        document.body.textContent.includes('Whale Rock Capital Management') &&
        document.body.textContent.includes('Open SEC filing');
      document.querySelector('#riskProfileInput').value = 'survival';
      document.querySelector('#riskProfileInput').dispatchEvent(new Event('change', { bubbles: true }));
      const survivalVisible = document.body.textContent.includes('Do-not-zero') &&
        document.querySelector('#maxLossInput')?.value === '25';
      document.querySelector('#maxLossInput').value = '0';
      document.querySelector('#maxLossInput').dispatchEvent(new Event('change', { bubbles: true }));
      const zeroPremiumLossHonored = document.querySelector('#optionsInput')?.value === '0' &&
        document.querySelector('#equityInput')?.value === '100';
      document.querySelector('[data-tab="Idea Board"]').click();
      document.querySelector('#ideaAuthor').value = 'QA';
      document.querySelector('#ideaTrade').value = 'RMBS common plus LEAPS';
      document.querySelector('#ideaNote').value = 'Smoke-test collaboration note';
      document.querySelector('#addIdeaButton').click();
      const ideaVisible = document.body.textContent.includes('Smoke-test collaboration note');
      const slider = document.querySelector('[data-factor="capex"]');
      slider.value = '20';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const sliderRetained = slider.isConnected && document.querySelector('[data-factor="capex"]') === slider;
      const hbmSlider = document.querySelector('[data-factor="hbm"]');
      hbmSlider.value = '80';
      hbmSlider.dispatchEvent(new Event('input', { bubbles: true }));
      const secondSliderWorks = hbmSlider.isConnected &&
        hbmSlider.closest('.slider-row')?.querySelector('output')?.textContent === '80';
      const after = document.querySelector('.metric strong')?.textContent || '';
      document.querySelector('#copyScenario').click();
      const hashOk = location.hash.startsWith('#scenario=');
      const sourceVisible = Array.from(document.querySelectorAll('[data-tab]')).length === 10;
      const tabClicksWork = Array.from(document.querySelectorAll('[data-tab]')).every((button) => {
        const tab = button.dataset.tab;
        button.click();
        return document.querySelector('.tab.active')?.dataset.tab === tab;
      });
      return {
        title: document.title,
        before,
        after,
        changed: before !== after,
        coupledAllocation,
        reverseCoupledAllocation,
        sleeveTotal,
        sleeveTotalVisible,
        topbarNoOverlap,
        titleVisible,
        earlyMoverControl,
        boundedLayout,
        inspectorClosed,
        inspectorReopened,
        sliderRetained,
        secondSliderWorks,
        timelineVisible,
        zeroDteVisible,
        optionsVisible,
        combosVisible,
        eventVisible,
        earlyMoversVisible,
        survivalVisible,
        zeroPremiumLossHonored,
        ideaVisible,
        hashOk,
        sourceVisible,
        tabClicksWork,
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2
      };
    })()`);
    await client.close();
    assert(smoke.title === "AI Boom Bottleneck Investment Lab", `${name}: wrong title`);
    assert(smoke.optionsVisible, `${name}: options tab did not render`);
    assert(smoke.coupledAllocation, `${name}: options/equity allocation did not rebalance`);
    assert(smoke.reverseCoupledAllocation, `${name}: equity/options reverse allocation did not rebalance`);
    assert(smoke.sleeveTotal === 100, `${name}: visible sleeves total ${smoke.sleeveTotal}, not 100`);
    assert(smoke.sleeveTotalVisible, `${name}: sleeve total helper is not visible`);
    assert(smoke.topbarNoOverlap, `${name}: topbar regions overlap`);
    assert(smoke.titleVisible, `${name}: full title text is not visible in the DOM`);
    assert(smoke.earlyMoverControl, `${name}: early mover lens control did not apply`);
    assert(smoke.boundedLayout, `${name}: primary layout extends outside the viewport`);
    assert(smoke.inspectorClosed, `${name}: inspector did not close cleanly`);
    assert(smoke.inspectorReopened, `${name}: inspector did not reopen cleanly`);
    assert(smoke.sliderRetained, `${name}: slider DOM was replaced during drag`);
    assert(smoke.secondSliderWorks, `${name}: second slider did not remain usable after first slider`);
    assert(smoke.timelineVisible, `${name}: timeline tab did not render`);
    assert(smoke.zeroDteVisible, `${name}: 0DTE event tape did not render`);
    assert(smoke.combosVisible, `${name}: combo strategy selector did not render`);
    assert(smoke.eventVisible, `${name}: event radar did not render`);
    assert(smoke.earlyMoversVisible, `${name}: early movers tab did not render`);
    assert(smoke.survivalVisible, `${name}: risk profile did not apply`);
    assert(smoke.zeroPremiumLossHonored, `${name}: 0% max premium loss did not zero options sleeve`);
    assert(smoke.ideaVisible, `${name}: idea board note did not render`);
    assert(smoke.changed, `${name}: slider did not change metrics`);
    assert(smoke.hashOk, `${name}: scenario hash not created`);
    assert(smoke.sourceVisible, `${name}: tabs missing`);
    assert(smoke.tabClicksWork, `${name}: one or more tabs did not activate`);
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
    try {
      const ready = await evaluate(client, `document.readyState === 'complete' && !!document.querySelector('[data-tab="Optimizer"]') && !!document.querySelector('#earlyMoverInput')`);
      if (ready) return;
    } catch (error) {
      if (!String(error.message).includes("default execution context")) throw error;
    }
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
