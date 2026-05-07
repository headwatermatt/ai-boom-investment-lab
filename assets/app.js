const state = {
  data: null,
  factors: {},
  activeTab: "Optimizer",
  selectedSymbol: "RMBS",
  portfolio: {},
  ranked: [],
  allocations: [],
  results: null,
  collabNotes: []
};

const tabs = ["Landscape", "Optimizer", "Options Ladder", "Event Radar", "Idea Board", "Sentiment", "Risk Map", "Source Ledger"];
const colors = ["#196d68", "#c9821c", "#3c5f82", "#2b7a4b", "#7f5f9a", "#9b5a3f", "#6b7f52", "#b44b43", "#4e777a", "#9a8a3f"];
const factorLabels = {
  capex: "Capex",
  hbm: "HBM",
  asic: "ASIC",
  ethernet: "Ethernet",
  taiwan: "Taiwan",
  export: "Export",
  election: "Policy",
  rates: "Rates",
  grid: "Grid",
  monetization: "ROI doubt"
};

const app = document.getElementById("app");

init();

async function init() {
  try {
    const response = await fetch("data/research_snapshot.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load research snapshot: ${response.status}`);
    state.data = await response.json();
    hydrateDefaults();
    loadScenarioFromHash();
    recalculate();
    render();
  } catch (error) {
    app.innerHTML = `<section class="error-state"><h1>Could not load the lab</h1><p>${escapeHtml(error.message)}</p><p>Run this from a local web server, for example <code>python3 -m http.server 4173</code>, then open <code>http://127.0.0.1:4173</code>.</p></section>`;
  }
}

function hydrateDefaults() {
  state.data.scenarioFactors.forEach((factor) => {
    state.factors[factor.id] = factor.default;
  });
  state.portfolio = { ...state.data.portfolioDefaults };
  state.collabNotes = loadStoredNotes();
  const first = state.data.universe.find((item) => item.symbol === state.selectedSymbol) || state.data.universe[0];
  state.selectedSymbol = first.symbol;
}

function loadScenarioFromHash() {
  if (!location.hash.startsWith("#scenario=")) return;
  try {
    const raw = decodeURIComponent(location.hash.replace("#scenario=", ""));
    const parsed = decodePayload(raw);
    if (parsed.factors) {
      Object.keys(state.factors).forEach((key) => {
        if (Number.isFinite(Number(parsed.factors[key]))) state.factors[key] = clamp(Number(parsed.factors[key]), 0, 100);
      });
    }
    if (parsed.portfolio) {
      ["capital", "equityCap", "optionsCap", "cashMin", "maxTotalLoss", "maxSingleEquity", "maxSingleOption"].forEach((key) => {
        if (Number.isFinite(Number(parsed.portfolio[key]))) state.portfolio[key] = Number(parsed.portfolio[key]);
      });
      if (parsed.portfolio.riskProfile) state.portfolio.riskProfile = String(parsed.portfolio.riskProfile);
      if (parsed.portfolio.targetReturn) state.portfolio.targetReturn = String(parsed.portfolio.targetReturn);
    }
    if (parsed.selectedSymbol) state.selectedSymbol = parsed.selectedSymbol;
    if (Array.isArray(parsed.collabNotes)) {
      state.collabNotes = sanitizeNotes(parsed.collabNotes);
      saveStoredNotes();
    }
  } catch (error) {
    console.warn("Ignored invalid scenario hash", error);
  }
}

function recalculate() {
  const probabilities = scenarioProbabilities();
  const ranked = state.data.universe
    .map((item) => scoreInstrument(item, probabilities))
    .sort((a, b) => b.rankScore - a.rankScore);

  state.ranked = ranked;
  state.allocations = buildAllocations(ranked);
  state.results = portfolioResults(state.allocations, probabilities);

  if (!state.ranked.some((item) => item.symbol === state.selectedSymbol)) {
    state.selectedSymbol = state.ranked[0].symbol;
  }
}

function scenarioProbabilities() {
  const f = state.factors;
  let bull = 0.2 + f.capex * 0.003 + f.hbm * 0.0012 + Math.max(0, 70 - f.monetization) * 0.0015 - f.rates * 0.0012 - f.taiwan * 0.0012 - f.export * 0.0008;
  let bear = 0.14 + f.monetization * 0.0022 + f.rates * 0.0016 + f.taiwan * 0.0018 + f.export * 0.0012 - f.capex * 0.0013;
  bull = clamp(bull, 0.05, 0.62);
  bear = clamp(bear, 0.05, 0.68);
  if (bull + bear > 0.9) {
    const scale = 0.9 / (bull + bear);
    bull *= scale;
    bear *= scale;
  }
  const base = 1 - bull - bear;
  return { bear, base, bull };
}

function scoreInstrument(item, probabilities) {
  const profile = getRiskProfile();
  const tilt = profile.scoreTilt || { expected: 1, convexity: 1, liquidity: 1, valuationPenalty: 1, bearPenalty: 1 };
  const factorImpact = Object.entries(item.impact).reduce((sum, [key, impact]) => {
    const centered = (state.factors[key] - 50) / 50;
    return sum + centered * impact * 7.5;
  }, 0);
  const riskPenalty = (item.valuationRisk - 50) * (state.factors.rates + state.factors.monetization) / 340;
  const adjustedBear = clamp(item.moic.bear * (1 + factorImpact / 280), 0, 8);
  const adjustedBase = clamp(item.moic.base * (1 + factorImpact / 190), 0, 8);
  const adjustedBull = clamp(item.moic.bull * (1 + factorImpact / 155), 0, 12);
  const expectedMoic = adjustedBear * probabilities.bear + adjustedBase * probabilities.base + adjustedBull * probabilities.bull;
  const downside = Math.max(0, 1 - adjustedBear);
  const rankScore =
    expectedMoic * 36 * tilt.expected +
    item.conviction * 0.38 +
    item.convexity * 0.28 * tilt.convexity +
    item.liquidity * 0.12 * tilt.liquidity +
    targetReturnBoost(item, adjustedBear, adjustedBase, adjustedBull) -
    riskPenalty * tilt.valuationPenalty -
    downside * 18 * tilt.bearPenalty;
  const stressScore = clamp(100 - item.valuationRisk * 0.35 - Math.max(0, -factorImpact) * 0.9 - downside * 40, 0, 100);
  return {
    ...item,
    adjustedMoic: { bear: adjustedBear, base: adjustedBase, bull: adjustedBull },
    expectedMoic,
    factorImpact,
    rankScore,
    stressScore
  };
}

function buildAllocations(ranked) {
  const totalCap = Math.max(1, Number(state.portfolio.equityCap) + Number(state.portfolio.optionsCap) + Number(state.portfolio.cashMin));
  const rawOptionsCap = totalCap > 100 ? state.portfolio.optionsCap * (100 / totalCap) : state.portfolio.optionsCap;
  const optionsCap = Math.min(rawOptionsCap, Number(state.portfolio.maxTotalLoss) || 100);
  const equityCap = totalCap > 100 ? state.portfolio.equityCap * (100 / totalCap) : state.portfolio.equityCap;
  const cashMin = totalCap > 100 ? state.portfolio.cashMin * (100 / totalCap) : state.portfolio.cashMin;

  const equityCandidates = ranked.filter((item) => item.expectedMoic > 1.05).slice(0, 12);
  const optionCandidates = ranked
    .filter((item) => item.optionsLiquidity >= 48 && item.convexity >= 58 && item.adjustedMoic.bull > 1.75)
    .slice(0, 8);

  const equityRaw = equityCandidates.map((item) => ({
    item,
    raw: Math.max(0.01, (item.expectedMoic - 0.85) * item.conviction * (110 - item.valuationRisk) / 100)
  }));
  const optionRaw = optionCandidates.map((item) => ({
    item,
    raw: Math.max(0.01, (item.adjustedMoic.bull - 1.1) * item.convexity * item.optionsLiquidity / 100)
  }));

  const equity = distributeWithCap(equityRaw, equityCap, state.portfolio.maxSingleEquity).map((entry) => ({
    type: "equity",
    symbol: entry.item.symbol,
    weight: entry.weight,
    dollars: entry.weight / 100 * state.portfolio.capital,
    item: entry.item
  }));
  const options = distributeWithCap(optionRaw, optionsCap, state.portfolio.maxSingleOption).map((entry) => ({
    type: "option",
    symbol: entry.item.symbol,
    weight: entry.weight,
    dollars: entry.weight / 100 * state.portfolio.capital,
    item: entry.item,
    contract: optionContract(entry.item)
  }));

  const allocated = [...equity, ...options];
  const used = allocated.reduce((sum, entry) => sum + entry.weight, 0);
  allocated.push({
    type: "cash",
    symbol: "CASH",
    weight: Math.max(cashMin, 100 - used),
    dollars: Math.max(cashMin, 100 - used) / 100 * state.portfolio.capital,
    item: null
  });
  return allocated;
}

function distributeWithCap(entries, target, cap) {
  if (!entries.length || target <= 0) return [];
  const totalRaw = entries.reduce((sum, entry) => sum + entry.raw, 0);
  let rows = entries.map((entry) => ({ ...entry, weight: Math.min(cap, target * entry.raw / totalRaw) }));
  let used = rows.reduce((sum, row) => sum + row.weight, 0);
  let loops = 0;
  while (used < target - 0.02 && loops < 8) {
    const open = rows.filter((row) => row.weight < cap - 0.01);
    if (!open.length) break;
    const openRaw = open.reduce((sum, row) => sum + row.raw, 0);
    const remainder = target - used;
    open.forEach((row) => {
      row.weight = Math.min(cap, row.weight + remainder * row.raw / openRaw);
    });
    used = rows.reduce((sum, row) => sum + row.weight, 0);
    loops += 1;
  }
  return rows.filter((row) => row.weight > 0.05);
}

function optionContract(item) {
  const moneyness = item.convexity > 82 ? 1.55 : item.convexity > 72 ? 1.4 : 1.28;
  const tenor = item.volatility > 60 ? "Jan 2028" : "Jun 2027";
  const premiumRatio = clamp(0.14 + item.volatility / 260 + item.optionsLiquidity / 900, 0.16, 0.42);
  const strike = roundToIncrement(item.price * moneyness);
  const premium = item.price * premiumRatio;
  const breakEven = strike + premium;
  const basePayoff = Math.max(0, item.price * item.adjustedMoic.base - breakEven) / premium;
  const bullPayoff = Math.max(0, item.price * item.adjustedMoic.bull - breakEven) / premium;
  return {
    tenor,
    strike,
    premium,
    premiumRatio,
    breakEven,
    basePayoff,
    bullPayoff,
    moneyness
  };
}

function portfolioResults(allocations, probabilities) {
  const capital = Number(state.portfolio.capital) || 100000;
  let bear = 0;
  let base = 0;
  let bull = 0;
  allocations.forEach((entry) => {
    const amount = entry.weight / 100;
    if (entry.type === "cash") {
      bear += amount;
      base += amount;
      bull += amount;
    } else if (entry.type === "equity") {
      bear += amount * entry.item.adjustedMoic.bear;
      base += amount * entry.item.adjustedMoic.base;
      bull += amount * entry.item.adjustedMoic.bull;
    } else {
      bear += 0;
      base += amount * entry.contract.basePayoff;
      bull += amount * entry.contract.bullPayoff;
    }
  });
  const expected = bear * probabilities.bear + base * probabilities.base + bull * probabilities.bull;
  const lossAtBear = Math.max(0, 1 - bear);
  return {
    probabilities,
    terminal: {
      bear: bear * capital,
      base: base * capital,
      bull: bull * capital,
      expected: expected * capital,
      fifth: bear * capital
    },
    moic: { bear, base, bull, expected },
    lossAtBear,
    maxOptionsLoss: allocations.filter((entry) => entry.type === "option").reduce((sum, entry) => sum + entry.dollars, 0)
  };
}

function render() {
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">AI</div>
        <div>
          <h1>${escapeHtml(state.data.metadata.title)}</h1>
          <p>${escapeHtml(state.data.metadata.horizon)} speculative bottleneck lab · ${escapeHtml(state.data.metadata.dataCutoff)} snapshot</p>
        </div>
      </div>
      <nav class="tabs" aria-label="Lab sections">
        ${tabs.map((tab) => `<button class="tab ${tab === state.activeTab ? "active" : ""}" data-tab="${tab}">${tab}</button>`).join("")}
      </nav>
      <div class="top-actions">
        <button class="ghost-action" id="copyScenario">Copy collaboration link</button>
        <button class="ghost-action" id="exportScenario">Export JSON</button>
        <button class="primary-action" id="importScenario">Import</button>
        <input class="hidden-file" id="importFile" type="file" accept="application/json,.json">
      </div>
    </header>
    <main class="grid-shell">
      ${renderControls()}
      <section class="workspace">
        ${renderMetrics()}
        ${renderActiveTab()}
      </section>
      ${renderInspector()}
    </main>
  `;
  bindEvents();
}

function renderControls() {
  const profiles = state.data.riskProfiles || [];
  const profile = getRiskProfile();
  return `
    <aside class="panel control-rail">
      <div class="panel-header">
        <h2>Scenario Controls</h2>
        <small>Editable</small>
      </div>
      <div class="control-body">
        <div class="status-strip">
          <div class="status-pill"><span>Profile</span><strong>${escapeHtml(profile.label)}</strong></div>
          <div class="status-pill"><span>Target</span><strong>${escapeHtml(state.portfolio.targetReturn || profile.target)}</strong></div>
        </div>
        <p class="control-summary">${escapeHtml(profile.summary || "")}</p>
        <div class="input-grid">
          <label class="input-field"><span>Risk profile</span><select id="riskProfileInput">${profiles.map((profile) => `<option value="${profile.id}" ${profile.id === state.portfolio.riskProfile ? "selected" : ""}>${escapeHtml(profile.label)}</option>`).join("")}</select></label>
          <label class="input-field"><span>Target payoff</span><select id="targetReturnInput">${["100x-1000x", "10x-50x", "3x-10x", "Do-not-zero"].map((target) => `<option value="${target}" ${target === state.portfolio.targetReturn ? "selected" : ""}>${target}</option>`).join("")}</select></label>
          <label class="input-field"><span>Max premium loss %</span><input id="maxLossInput" type="number" min="0" max="100" step="5" value="${state.portfolio.maxTotalLoss}"></label>
          <label class="input-field"><span>Capital</span><input id="capitalInput" type="number" min="1000" step="1000" value="${state.portfolio.capital}"></label>
          <label class="input-field"><span>Equity %</span><input id="equityInput" type="number" min="0" max="100" step="1" value="${state.portfolio.equityCap}"></label>
          <label class="input-field"><span>Options %</span><input id="optionsInput" type="number" min="0" max="100" step="1" value="${state.portfolio.optionsCap}"></label>
        </div>
        <div class="slider-group">
          ${state.data.scenarioFactors.map((factor) => `
            <div class="slider-row">
              <div class="slider-label"><strong>${escapeHtml(factor.label)}</strong><output>${state.factors[factor.id]}</output></div>
              <input type="range" min="0" max="100" step="1" value="${state.factors[factor.id]}" data-factor="${factor.id}" aria-label="${escapeHtml(factor.label)}">
              <div class="slider-help"><span>${escapeHtml(factor.low)}</span><span>${escapeHtml(factor.high)}</span></div>
            </div>
          `).join("")}
        </div>
      </div>
    </aside>
  `;
}

function renderMetrics() {
  const result = state.results;
  const profile = getRiskProfile();
  const maxLossBudget = Number(state.portfolio.maxTotalLoss) || 0;
  return `
    <section class="metrics-grid" aria-label="Portfolio metrics">
      <div class="metric"><span>Expected terminal wealth</span><strong>${formatMoney(result.terminal.expected)}</strong><em>${formatMoic(result.moic.expected)} weighted MOIC</em></div>
      <div class="metric"><span>5th percentile proxy</span><strong>${formatMoney(result.terminal.fifth)}</strong><em>${formatPercent(result.lossAtBear)} drawdown in bear case</em></div>
      <div class="metric"><span>Options max loss</span><strong>${formatMoney(result.maxOptionsLoss)}</strong><em>${maxLossBudget}% loss budget · premium sleeve at risk</em></div>
      <div class="metric"><span>${escapeHtml(profile.label)}</span><strong>${formatPercent(result.probabilities.bull)} bull</strong><em>${escapeHtml(profile.target)} · ${formatPercent(result.probabilities.bear)} bear</em></div>
    </section>
  `;
}

function renderActiveTab() {
  if (state.activeTab === "Landscape") return renderLandscape();
  if (state.activeTab === "Options Ladder") return renderOptionsLadder();
  if (state.activeTab === "Event Radar") return renderEventRadar();
  if (state.activeTab === "Idea Board") return renderIdeaBoard();
  if (state.activeTab === "Sentiment") return renderSentiment();
  if (state.activeTab === "Risk Map") return renderRiskMap();
  if (state.activeTab === "Source Ledger") return renderSourceLedger();
  return renderOptimizer();
}

function renderOptimizer() {
  return `
    <section class="tab-panel">
      <section class="panel chart-panel">
        <div class="panel-header">
          <h2>Optimized Allocation</h2>
          <small>No margin · no naked options · proxy option chains</small>
        </div>
        <div class="chart-body allocation-layout">
          ${allocationChart()}
          <div class="legend-list">
            ${state.allocations.filter((entry) => entry.weight > 1).slice(0, 12).map((entry, index) => `
              <div class="legend-item">
                <span class="legend-dot" style="background:${colors[index % colors.length]}"></span>
                <strong>${entry.symbol} ${entry.type === "option" ? "LEAPS" : entry.type}</strong>
                <span>${formatPercent(entry.weight / 100)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Ranked Opportunity Set</h2>
          <small>${state.ranked.length} names</small>
        </div>
        ${rankedTable(state.ranked)}
      </section>
    </section>
  `;
}

function renderLandscape() {
  const buckets = groupBy(state.ranked, "bucket");
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>First-principles map</h2>
        <p>The model treats AI upside as a physical bottleneck problem: compute demand transmits into HBM, packaging, test, metrology, networking, systems integration, thermal, electrical, grid, and power constraints. Public social data can raise investigation priority, but only primary sources move claim status.</p>
      </section>
      <section class="three-col">
        ${Object.entries(buckets).map(([bucket, items]) => `
          <div class="panel narrative">
            <h2>${escapeHtml(bucket)}</h2>
            <p>${items.slice(0, 5).map((item) => item.symbol).join(", ")}${items.length > 5 ? ` +${items.length - 5}` : ""}</p>
          </div>
        `).join("")}
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Universe by Bottleneck Layer</h2>
          <small>PDF basket plus expanded landscape</small>
        </div>
        ${rankedTable(state.ranked, true)}
      </section>
    </section>
  `;
}

function renderOptionsLadder() {
  const optionRows = state.ranked
    .filter((item) => item.optionsLiquidity >= 48 && item.convexity >= 58)
    .slice(0, 9)
    .map((item) => ({ item, contract: optionContract(item) }));
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>Convex sleeve design</h2>
        <p>These are proxy LEAPS candidates, not executable quotes. Before trading, import a broker option-chain CSV and replace premium, bid/ask, IV, open interest, and expiry assumptions.</p>
      </section>
      <section class="option-grid">
        ${optionRows.map(({ item, contract }) => `
          <article class="option-card selectable-card" data-select="${item.symbol}">
            <header>
              <div>
                <h3>${item.symbol} ${contract.tenor} call</h3>
                <p>${escapeHtml(item.bucket)} · ${escapeHtml(item.layer)}</p>
              </div>
              <span class="tag ${item.valuationRisk > 78 ? "warn" : "good"}">${item.optionsLiquidity} liq</span>
            </header>
            <div class="kv-list">
              <div class="kv"><span>Proxy spot</span><strong>${formatMoney(item.price)}</strong></div>
              <div class="kv"><span>Strike</span><strong>${formatMoney(contract.strike)}</strong></div>
              <div class="kv"><span>Premium est.</span><strong>${formatMoney(contract.premium)}</strong></div>
              <div class="kv"><span>Break-even</span><strong>${formatMoney(contract.breakEven)}</strong></div>
              <div class="kv"><span>Base payoff</span><strong>${formatMoic(contract.basePayoff)}</strong></div>
              <div class="kv"><span>Bull payoff</span><strong>${formatMoic(contract.bullPayoff)}</strong></div>
            </div>
          </article>
        `).join("")}
      </section>
    </section>
  `;
}

function renderEventRadar() {
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>Late-breaking trade radar</h2>
        <p>Use this page to decide whether new information should change the stack rank. High-urgency items can justify short-duration defined-risk options; long-cycle evidence should usually change sliders and portfolio weights instead.</p>
      </section>
      <section class="event-grid">
        ${state.data.eventRadar.map((event) => renderEventCard(event)).join("")}
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Return Target Playbooks</h2>
          <small>Choose the right failure mode</small>
        </div>
        <div class="archetype-grid">
          ${state.data.tradeArchetypes.map((item) => `
            <article class="archetype-card">
              <header><h3>${escapeHtml(item.label)}</h3><span class="tag ${item.id === "1000x-tail" ? "danger" : item.id === "survivable-core" ? "good" : "warn"}">${escapeHtml(item.id)}</span></header>
              <p><strong>Use when:</strong> ${escapeHtml(item.useWhen)}</p>
              <p><strong>Structure:</strong> ${escapeHtml(item.structure)}</p>
              <p>${item.bestFit.map((symbol) => `<button class="ticker-chip" data-select="${symbol}" type="button">${symbol}</button>`).join("")}</p>
              <p class="footer-note">Failure mode: ${escapeHtml(item.failureMode)}</p>
            </article>
          `).join("")}
        </div>
      </section>
    </section>
  `;
}

function renderEventCard(event) {
  const sourceLinks = event.sources
    .map((id) => state.data.sources.find((source) => source.id === id))
    .filter(Boolean)
    .map((source) => source.url ? `<a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>` : escapeHtml(source.title))
    .join(" · ");
  return `
    <article class="panel event-card">
      <div class="panel-header">
        <h2>${escapeHtml(event.headline)}</h2>
        <small>${escapeHtml(event.timeframe)}</small>
      </div>
      <div class="event-body">
        <p>${escapeHtml(event.whyItMatters)}</p>
        <p><strong>Model move:</strong> ${escapeHtml(event.tilt)}</p>
        <div class="two-mini-cols">
          <div><span class="panel-kicker">Beneficiaries</span><p>${event.beneficiaries.map((symbol) => `<button class="ticker-chip" data-select="${symbol}" type="button">${symbol}</button>`).join("")}</p></div>
          <div><span class="panel-kicker">At risk</span><p>${event.atRisk.map((symbol) => `<button class="ticker-chip muted-chip" data-select="${symbol}" type="button">${symbol}</button>`).join("")}</p></div>
        </div>
        <p class="footer-note">Sources: ${sourceLinks}</p>
      </div>
    </article>
  `;
}

function renderIdeaBoard() {
  const selected = state.ranked.find((item) => item.symbol === state.selectedSymbol) || state.ranked[0];
  const notes = [...state.collabNotes].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>Friend collaboration board</h2>
        <p>Add trade ideas, questions, dissent, or catalyst notes. They save in this browser and are included when you copy a collaboration link or export JSON. This is asynchronous collaboration; there is no account system or live shared backend.</p>
      </section>
      <section class="two-col">
        <form class="panel idea-form" id="ideaForm">
          <div class="panel-header">
            <h2>Add Trading Idea</h2>
            <small>${escapeHtml(selected.symbol)} selected</small>
          </div>
          <div class="idea-form-body">
            <label class="input-field"><span>Name</span><input id="ideaAuthor" type="text" maxlength="40" placeholder="Your name or initials"></label>
            <label class="input-field"><span>Ticker</span><select id="ideaSymbol">${state.ranked.slice(0, 26).map((item) => `<option value="${item.symbol}" ${item.symbol === state.selectedSymbol ? "selected" : ""}>${item.symbol} · ${escapeHtml(item.company)}</option>`).join("")}</select></label>
            <label class="input-field"><span>Trade expression</span><input id="ideaTrade" type="text" maxlength="120" placeholder="Example: RMBS common + Jan 2028 calls"></label>
            <div class="input-grid">
              <label class="input-field"><span>Bias</span><select id="ideaBias"><option>Bullish</option><option>Bearish</option><option>Hedge</option><option>Question</option></select></label>
              <label class="input-field"><span>Confidence</span><select id="ideaConfidence"><option>Medium</option><option>High</option><option>Low</option></select></label>
              <label class="input-field"><span>Horizon</span><select id="ideaHorizon"><option>18-36 mo</option><option>6-12 mo</option><option>3-5 yr</option><option>Event-driven</option></select></label>
            </div>
            <label class="input-field"><span>Reasoning / open question</span><textarea id="ideaNote" rows="5" maxlength="900" placeholder="Write the thesis, risk, catalyst, or disagreement you want friends to react to."></textarea></label>
            <div class="idea-actions">
              <button class="primary-action" type="button" id="addIdeaButton">Add idea</button>
              <button class="ghost-action" type="button" id="clearIdeas">Clear local ideas</button>
            </div>
          </div>
        </form>
        <section class="panel">
          <div class="panel-header">
            <h2>Shared Packet</h2>
            <small>${notes.length} ideas</small>
          </div>
          <div class="claim-list">
            <article class="claim">
              <header><h3>How to collaborate</h3><span class="tag good">static link</span></header>
              <p>Use Copy scenario link after adding notes. The URL carries the current assumptions, selected ticker, and idea board. Friends can edit it, add their own notes, then send back a new link or exported JSON.</p>
            </article>
            <article class="claim">
              <header><h3>Current scenario snapshot</h3><span class="tag">${formatPercent(state.results.probabilities.bull)} bull</span></header>
              <p>Expected terminal wealth ${formatMoney(state.results.terminal.expected)} · 5th percentile proxy ${formatMoney(state.results.terminal.fifth)} · options max loss ${formatMoney(state.results.maxOptionsLoss)}.</p>
            </article>
          </div>
        </section>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Trade Ideas</h2>
          <small>${notes.length} saved locally</small>
        </div>
        <div class="idea-list">
          ${notes.length ? notes.map((note) => renderIdea(note)).join("") : `<div class="empty-state">No ideas yet. Add the first thesis or question, then copy a collaboration link.</div>`}
        </div>
      </section>
    </section>
  `;
}

function renderIdea(note) {
  return `
    <article class="idea-card" data-select="${escapeAttr(note.symbol)}">
      <header>
        <div>
          <h3>${escapeHtml(note.symbol)} · ${escapeHtml(note.trade || "Open question")}</h3>
          <p>${escapeHtml(note.author || "Anonymous")} · ${escapeHtml(note.bias)} · ${escapeHtml(note.confidence)} confidence · ${escapeHtml(note.horizon)} · ${formatDate(note.createdAt)}</p>
        </div>
        <button class="ghost-action compact-button" data-delete-note="${escapeAttr(note.id)}" type="button">Delete</button>
      </header>
      <p>${escapeHtml(note.note)}</p>
    </article>
  `;
}

function renderSentiment() {
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>Sentiment discipline</h2>
        <p>Social sources are labeled as market color. They can change investigation priority, but they cannot confirm factual claims or override SEC filings, investor updates, or policy/energy data.</p>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Public Social Signals</h2>
          <small>Low-authority inputs</small>
        </div>
        <div class="sentiment-grid">
          ${state.data.socialSignals.map((signal) => `
            <article class="sentiment-item">
              <h3>${escapeHtml(signal.source)} · ${escapeHtml(signal.target)}</h3>
              <p>${escapeHtml(signal.polarity)} · strength ${signal.strength}/100</p>
              <p>${escapeHtml(signal.caveat)}</p>
              ${signal.url ? `<p><a href="${escapeAttr(signal.url)}" target="_blank" rel="noreferrer">Open source</a></p>` : ""}
            </article>
          `).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Claim Verification</h2>
          <small>Primary beats social</small>
        </div>
        <div class="claim-list">
          ${state.data.claims.map((claim) => claimCard(claim)).join("")}
        </div>
      </section>
    </section>
  `;
}

function renderRiskMap() {
  const top = state.ranked.slice(0, 18);
  const factorKeys = state.data.scenarioFactors.map((factor) => factor.id);
  return `
    <section class="tab-panel">
      <section class="panel">
        <div class="panel-header">
          <h2>Scenario Exposure Heatmap</h2>
          <small>Green favorable · red adverse</small>
        </div>
        <div class="risk-grid">
          <div class="risk-row">
            <div class="risk-head risk-label">Ticker</div>
            ${factorKeys.map((key) => `<div class="risk-head">${factorLabels[key]}</div>`).join("")}
          </div>
          ${top.map((item) => `
            <div class="risk-row selectable-card" data-select="${item.symbol}">
              <div class="risk-head risk-label">${item.symbol}</div>
              ${factorKeys.map((key) => {
                const value = item.impact[key] || 0;
                const color = heatColor(value);
                return `<div class="risk-cell" style="background:${color.bg};color:${color.fg}">${value.toFixed(1)}</div>`;
              }).join("")}
            </div>
          `).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Catalysts and Rebalance Triggers</h2>
          <small>Path-dependent</small>
        </div>
        <div class="claim-list">
          ${state.data.catalystCalendar.map((item) => `
            <article class="claim">
              <header><h3>${escapeHtml(item.window)} · ${escapeHtml(item.event)}</h3><span class="tag">${item.impacted.length} names</span></header>
              <p>${escapeHtml(item.trigger)}</p>
              <p>${item.impacted.map((symbol) => `<span class="tag">${symbol}</span>`).join(" ")}</p>
            </article>
          `).join("")}
        </div>
      </section>
    </section>
  `;
}

function renderSourceLedger() {
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>Source ledger</h2>
        <p>Quality 5 means primary filing, company release, or policy/energy source. Quality 2 means public social or sentiment. Private community inputs require user exports before they enter the model.</p>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Evidence Registry</h2>
          <small>${state.data.sources.length} sources</small>
        </div>
        <div class="table-wrap">
          <table class="source-table">
            <thead><tr><th>Source</th><th>Kind</th><th>Quality</th><th>Use</th></tr></thead>
            <tbody>
              ${state.data.sources.map((source) => `
                <tr>
                  <td><strong>${source.url ? `<a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>` : escapeHtml(source.title)}</strong><br><span class="footer-note">${escapeHtml(source.publisher)} · ${escapeHtml(source.date)}</span></td>
                  <td><span class="tag ${source.kind.includes("sentiment") || source.kind.includes("user") ? "warn" : "good"}">${escapeHtml(source.kind)}</span></td>
                  <td>${qualityMeter(source.quality)}</td>
                  <td>${escapeHtml(source.notes)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderInspector() {
  const selected = state.ranked.find((item) => item.symbol === state.selectedSymbol) || state.ranked[0];
  const sourceRows = selected.sources.map((id) => state.data.sources.find((source) => source.id === id)).filter(Boolean);
  return `
    <aside class="panel inspector">
      <div class="panel-header">
        <h2>Inspector</h2>
        <small>${selected.priceQuality}</small>
      </div>
      <div class="inspector-body">
        <div class="selected-title">
          <div>
            <h2>${selected.symbol} · ${escapeHtml(selected.company)}</h2>
            <p>${escapeHtml(selected.bucket)} · ${escapeHtml(selected.layer)}</p>
          </div>
          <span class="tag ${selected.pdfBasket ? "good" : ""}">${selected.pdfBasket ? "PDF basket" : "expanded"}</span>
        </div>
        <div class="mini-grid">
          <div class="mini-stat"><span>Expected</span><strong>${formatMoic(selected.expectedMoic)}</strong></div>
          <div class="mini-stat"><span>Bear/base/bull</span><strong>${formatMoic(selected.adjustedMoic.bear)} / ${formatMoic(selected.adjustedMoic.base)} / ${formatMoic(selected.adjustedMoic.bull)}</strong></div>
          <div class="mini-stat"><span>Rank score</span><strong>${selected.rankScore.toFixed(1)}</strong></div>
        </div>
        <div class="text-block">
          <h3>Thesis</h3>
          <p>${escapeHtml(selected.thesis)}</p>
        </div>
        <div class="text-block">
          <h3>What must be true</h3>
          <p>${escapeHtml(selected.mustBeTrue)}</p>
        </div>
        <div class="text-block">
          <h3>Risks</h3>
          <ul class="plain-list">${selected.risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")}</ul>
        </div>
        <div class="text-block">
          <h3>Catalysts</h3>
          <ul class="plain-list">${selected.catalysts.map((catalyst) => `<li>${escapeHtml(catalyst)}</li>`).join("")}</ul>
        </div>
        <div class="text-block">
          <h3>Source quality</h3>
          <div class="source-list">
            ${sourceRows.map((source) => `
              <div class="source-item">
                <strong>${source.url ? `<a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>` : escapeHtml(source.title)}</strong>
                <span>${escapeHtml(source.kind)} · quality ${source.quality}/5</span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    </aside>
  `;
}

function rankedTable(rows, includeLayer = false) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>${includeLayer ? "Layer" : "Bucket"}</th>
            <th>Expected</th>
            <th>Bear</th>
            <th>Base</th>
            <th>Bull</th>
            <th>Convexity</th>
            <th>Risk</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((item) => `
            <tr class="selectable ${item.symbol === state.selectedSymbol ? "selected" : ""}" data-select="${item.symbol}">
              <td><div class="symbol-cell"><strong>${item.symbol}</strong><span>${escapeHtml(item.company)}</span></div></td>
              <td>${escapeHtml(includeLayer ? item.layer : item.bucket)}</td>
              <td><strong>${formatMoic(item.expectedMoic)}</strong></td>
              <td>${formatMoic(item.adjustedMoic.bear)}</td>
              <td>${formatMoic(item.adjustedMoic.base)}</td>
              <td>${formatMoic(item.adjustedMoic.bull)}</td>
              <td>${scoreBar(item.convexity)}</td>
              <td><span class="tag ${item.valuationRisk > 78 ? "danger" : item.valuationRisk > 65 ? "warn" : "good"}">${item.valuationRisk}</span></td>
              <td>${formatMoney(item.price)} <span class="footer-note">${escapeHtml(item.priceQuality)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function allocationChart() {
  const entries = state.allocations.filter((entry) => entry.weight > 0.2);
  let start = 0;
  const rings = entries.map((entry, index) => {
    const value = entry.weight / 100;
    const segment = describeArc(110, 110, 78, start, start + value * 360);
    start += value * 360;
    return `<path d="${segment}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="24" stroke-linecap="butt"></path>`;
  }).join("");
  const bars = ["bear", "base", "bull"].map((key, index) => {
    const moic = state.results.moic[key];
    const width = Math.min(250, moic * 72);
    const y = 28 + index * 46;
    const label = key[0].toUpperCase() + key.slice(1);
    return `
      <text x="270" y="${y + 15}" font-size="12" fill="#68726c">${label}</text>
      <rect x="322" y="${y}" width="250" height="18" rx="4" fill="#edf0ee"></rect>
      <rect x="322" y="${y}" width="${width}" height="18" rx="4" fill="${index === 0 ? "#b44b43" : index === 1 ? "#196d68" : "#c9821c"}"></rect>
      <text x="${330 + width}" y="${y + 14}" font-size="12" font-weight="700" fill="#151816">${formatMoic(moic)}</text>
    `;
  }).join("");
  return `
    <svg class="chart-svg" viewBox="0 0 620 230" role="img" aria-label="Allocation and scenario payoff chart">
      <circle cx="110" cy="110" r="78" fill="none" stroke="#edf0ee" stroke-width="24"></circle>
      ${rings}
      <text x="110" y="103" text-anchor="middle" font-size="13" fill="#68726c">Expected</text>
      <text x="110" y="126" text-anchor="middle" font-size="24" font-weight="800" fill="#151816">${formatMoic(state.results.moic.expected)}</text>
      <text x="270" y="18" font-size="13" font-weight="760" fill="#151816">Terminal wealth range</text>
      ${bars}
      <line x1="322" y1="184" x2="572" y2="184" stroke="#d8ddd9"></line>
      <text x="322" y="208" font-size="12" fill="#68726c">Bear ${formatMoney(state.results.terminal.bear)}</text>
      <text x="448" y="208" font-size="12" fill="#68726c">Expected ${formatMoney(state.results.terminal.expected)}</text>
    </svg>
  `;
}

function claimCard(claim) {
  const statusClass = claim.status.includes("contradicted") ? "danger" : claim.status.includes("unverified") ? "warn" : "good";
  const sourceLinks = claim.evidence
    .map((id) => state.data.sources.find((source) => source.id === id))
    .filter(Boolean)
    .map((source) => source.url ? `<a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.id)}</a>` : escapeHtml(source.id))
    .join(" · ");
  return `
    <article class="claim">
      <header><h3>${escapeHtml(claim.claim)}</h3><span class="tag ${statusClass}">${escapeHtml(claim.status)}</span></header>
      <p>${escapeHtml(claim.notes)}</p>
      <p class="footer-note">Confidence ${Math.round(claim.confidence * 100)}% · ${sourceLinks}</p>
    </article>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      render();
    });
  });
  document.querySelectorAll("[data-factor]").forEach((input) => {
    input.addEventListener("input", () => {
      state.factors[input.dataset.factor] = Number(input.value);
      recalculate();
      render();
    });
  });
  document.querySelectorAll("[data-select]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedSymbol = row.dataset.select;
      recalculate();
      render();
    });
  });
  const capital = document.getElementById("capitalInput");
  const equity = document.getElementById("equityInput");
  const options = document.getElementById("optionsInput");
  const riskProfile = document.getElementById("riskProfileInput");
  const targetReturn = document.getElementById("targetReturnInput");
  const maxLoss = document.getElementById("maxLossInput");
  if (capital) capital.addEventListener("change", () => updatePortfolio("capital", clamp(Number(capital.value), 1000, 100000000)));
  if (equity) equity.addEventListener("change", () => updatePortfolio("equityCap", clamp(Number(equity.value), 0, 100)));
  if (options) options.addEventListener("change", () => updatePortfolio("optionsCap", clamp(Number(options.value), 0, 100)));
  if (riskProfile) riskProfile.addEventListener("change", () => applyRiskProfile(riskProfile.value));
  if (targetReturn) targetReturn.addEventListener("change", () => updatePortfolio("targetReturn", targetReturn.value));
  if (maxLoss) maxLoss.addEventListener("change", () => updatePortfolio("maxTotalLoss", clamp(Number(maxLoss.value), 0, 100)));

  document.getElementById("copyScenario")?.addEventListener("click", copyScenarioLink);
  document.getElementById("exportScenario")?.addEventListener("click", exportScenario);
  document.getElementById("importScenario")?.addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile")?.addEventListener("change", importScenario);
  document.getElementById("ideaForm")?.addEventListener("submit", addIdea);
  document.getElementById("addIdeaButton")?.addEventListener("click", addIdea);
  document.getElementById("clearIdeas")?.addEventListener("click", clearIdeas);
  document.querySelectorAll("[data-delete-note]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteIdea(button.dataset.deleteNote);
    });
  });
}

function updatePortfolio(key, value) {
  state.portfolio[key] = value;
  recalculate();
  render();
}

function applyRiskProfile(profileId) {
  const profile = (state.data.riskProfiles || []).find((item) => item.id === profileId) || getRiskProfile();
  state.portfolio.riskProfile = profile.id;
  state.portfolio.targetReturn = profile.target.includes("100x") ? "100x-1000x" :
    profile.target.includes("10x") ? "10x-50x" :
    profile.id === "survival" ? "Do-not-zero" : "3x-10x";
  state.portfolio.equityCap = profile.defaultEquity;
  state.portfolio.optionsCap = profile.defaultOptions;
  state.portfolio.cashMin = profile.defaultCash;
  state.portfolio.maxTotalLoss = profile.maxTotalLoss;
  if (Number.isFinite(Number(profile.maxSingleEquity))) state.portfolio.maxSingleEquity = Number(profile.maxSingleEquity);
  if (Number.isFinite(Number(profile.maxSingleOption))) state.portfolio.maxSingleOption = Number(profile.maxSingleOption);
  recalculate();
  render();
}

function exportScenario() {
  const payload = scenarioPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ai-bottleneck-scenario-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importScenario(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (parsed.factors) {
        Object.keys(state.factors).forEach((key) => {
          if (Number.isFinite(Number(parsed.factors[key]))) state.factors[key] = clamp(Number(parsed.factors[key]), 0, 100);
        });
      }
      if (parsed.portfolio) {
        ["capital", "equityCap", "optionsCap", "cashMin", "maxTotalLoss", "maxSingleEquity", "maxSingleOption"].forEach((key) => {
          if (Number.isFinite(Number(parsed.portfolio[key]))) state.portfolio[key] = Number(parsed.portfolio[key]);
        });
        if (parsed.portfolio.riskProfile) state.portfolio.riskProfile = String(parsed.portfolio.riskProfile);
        if (parsed.portfolio.targetReturn) state.portfolio.targetReturn = String(parsed.portfolio.targetReturn);
      }
      state.selectedSymbol = parsed.selectedSymbol || state.selectedSymbol;
      if (Array.isArray(parsed.collabNotes)) {
        state.collabNotes = sanitizeNotes(parsed.collabNotes);
        saveStoredNotes();
      }
      recalculate();
      render();
    } catch (error) {
      alert(`Invalid scenario JSON: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

async function copyScenarioLink() {
  const encoded = encodePayload(scenarioPayload());
  const url = `${location.origin}${location.pathname}#scenario=${encodeURIComponent(encoded)}`;
  history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt("Scenario link", url);
  }
}

function scenarioPayload() {
  return {
    createdAt: new Date().toISOString(),
    dataCutoff: state.data.metadata.dataCutoff,
    factors: state.factors,
    portfolio: state.portfolio,
    selectedSymbol: state.selectedSymbol,
    collabNotes: state.collabNotes
  };
}

function addIdea(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const note = sanitizeNote({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    author: document.getElementById("ideaAuthor")?.value,
    symbol: document.getElementById("ideaSymbol")?.value,
    trade: document.getElementById("ideaTrade")?.value,
    bias: document.getElementById("ideaBias")?.value,
    confidence: document.getElementById("ideaConfidence")?.value,
    horizon: document.getElementById("ideaHorizon")?.value,
    note: document.getElementById("ideaNote")?.value
  });
  if (!note.note && !note.trade) {
    alert("Add a trade expression, note, or question before saving.");
    return;
  }
  state.collabNotes = [note, ...state.collabNotes].slice(0, 40);
  state.selectedSymbol = note.symbol;
  saveStoredNotes();
  render();
}

function deleteIdea(id) {
  state.collabNotes = state.collabNotes.filter((note) => note.id !== id);
  saveStoredNotes();
  render();
}

function clearIdeas() {
  if (!state.collabNotes.length) return;
  if (!confirm("Clear locally saved ideas from this browser?")) return;
  state.collabNotes = [];
  saveStoredNotes();
  render();
}

function loadStoredNotes() {
  try {
    return sanitizeNotes(JSON.parse(localStorage.getItem("aiLabCollabNotes") || "[]"));
  } catch {
    return [];
  }
}

function saveStoredNotes() {
  localStorage.setItem("aiLabCollabNotes", JSON.stringify(state.collabNotes));
}

function sanitizeNotes(notes) {
  return notes.map(sanitizeNote).filter((note) => note.symbol && (note.note || note.trade)).slice(0, 40);
}

function sanitizeNote(note) {
  const symbols = new Set(state.data.universe.map((item) => item.symbol));
  const symbol = symbols.has(String(note.symbol || "")) ? String(note.symbol) : state.selectedSymbol;
  return {
    id: String(note.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`).slice(0, 80),
    createdAt: String(note.createdAt || new Date().toISOString()).slice(0, 40),
    author: String(note.author || "").trim().slice(0, 40),
    symbol,
    trade: String(note.trade || "").trim().slice(0, 120),
    bias: ["Bullish", "Bearish", "Hedge", "Question"].includes(note.bias) ? note.bias : "Question",
    confidence: ["Low", "Medium", "High"].includes(note.confidence) ? note.confidence : "Medium",
    horizon: ["18-36 mo", "6-12 mo", "3-5 yr", "Event-driven"].includes(note.horizon) ? note.horizon : "18-36 mo",
    note: String(note.note || "").trim().slice(0, 900)
  };
}

function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodePayload(encoded) {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function scoreBar(value) {
  return `
    <div class="score-bar">
      <div class="score-track"><div class="score-fill" style="width:${clamp(value, 0, 100)}%"></div></div>
      <span>${Math.round(value)}</span>
    </div>
  `;
}

function qualityMeter(value) {
  const blocks = Array.from({ length: 5 }, (_, index) => `<span class="legend-dot" style="background:${index < value ? "#196d68" : "#d8ddd9"}"></span>`).join("");
  return `<span style="display:inline-flex;gap:3px">${blocks}</span>`;
}

function getRiskProfile() {
  const profiles = state.data?.riskProfiles || [];
  return profiles.find((profile) => profile.id === state.portfolio.riskProfile) ||
    profiles[0] ||
    {
      id: "default",
      label: "Speculative",
      target: "Options sleeve",
      summary: "Defined-risk options and equities only.",
      scoreTilt: { expected: 1, convexity: 1, liquidity: 1, valuationPenalty: 1, bearPenalty: 1 }
    };
}

function targetReturnBoost(item, bear, base, bull) {
  const target = state.portfolio.targetReturn || getRiskProfile().target;
  const optionsEligible = item.optionsLiquidity >= 48;
  if (target === "100x-1000x") {
    return (bull - base) * 11 + item.convexity * 0.22 + (optionsEligible ? 8 : -6) - Math.max(0, bear - 0.8) * 10;
  }
  if (target === "10x-50x") {
    return Math.min(22, (bull - 1) * 5) + item.convexity * 0.09 + item.liquidity * 0.07 - Math.max(0, 0.65 - bear) * 8;
  }
  if (target === "Do-not-zero") {
    return bear * 18 + item.liquidity * 0.16 - item.valuationRisk * 0.22 - Math.max(0, bull - 5) * 2;
  }
  return base * 8 + item.liquidity * 0.12 - item.valuationRisk * 0.08;
}

function heatColor(value) {
  if (value >= 2) return { bg: "#cde9d6", fg: "#183d27" };
  if (value >= 0.6) return { bg: "#e5f3e9", fg: "#23643e" };
  if (value <= -2) return { bg: "#f2cac7", fg: "#7f2924" };
  if (value <= -0.6) return { bg: "#fae5e2", fg: "#8e342f" };
  return { bg: "#edf0ee", fg: "#68726c" };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx, cy, r, angleInDegrees) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians)
  };
}

function roundToIncrement(value) {
  if (value < 50) return Math.round(value / 2.5) * 2.5;
  if (value < 200) return Math.round(value / 5) * 5;
  return Math.round(value / 10) * 10;
}

function groupBy(rows, key) {
  return rows.reduce((memo, item) => {
    const value = item[key] || "Other";
    if (!memo[value]) memo[value] = [];
    memo[value].push(item);
    return memo;
  }, {});
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatMoney(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (absolute >= 1000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatMoic(value) {
  return `${value.toFixed(2)}x`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unsaved";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
