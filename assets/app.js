const state = {
  data: null,
  earlyMovers: null,
  factors: {},
  activeTab: "Optimizer",
  selectedSymbol: "RMBS",
  portfolio: {},
  ranked: [],
  allocations: [],
  results: null,
  collabNotes: [],
  inspectorOpen: true
};

const tabs = ["Landscape", "Optimizer", "Timeline", "Options Ladder", "Event Radar", "Early Movers", "Idea Board", "Sentiment", "Risk Map", "Source Ledger"];
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
    state.earlyMovers = await loadEarlyMoversSnapshot();
    hydrateDefaults();
    loadScenarioFromHash();
    recalculate();
    render();
  } catch (error) {
    app.innerHTML = `<section class="error-state"><h1>Could not load the lab</h1><p>${escapeHtml(error.message)}</p><p>Run this from a local web server, for example <code>python3 -m http.server 4173</code>, then open <code>http://127.0.0.1:4173</code>.</p></section>`;
  }
}

async function loadEarlyMoversSnapshot() {
  try {
    const response = await fetch("data/early_movers_snapshot.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load early mover snapshot: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Early mover snapshot unavailable", error);
    return {
      metadata: {
        title: "SEC EDGAR Early Mover Snapshot",
        generatedAt: null,
        caveat: "Early mover snapshot unavailable in this build."
      },
      managers: [],
      signals: [],
      summaryBySymbol: [],
      sourceLinks: []
    };
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
      ["capital", "equityCap", "optionsCap", "cashMin", "maxTotalLoss", "maxSingleEquity", "maxSingleOption", "timelineMonths", "eventTapeIntensity"].forEach((key) => {
        if (Number.isFinite(Number(parsed.portfolio[key]))) state.portfolio[key] = Number(parsed.portfolio[key]);
      });
      if (parsed.portfolio.riskProfile) state.portfolio.riskProfile = String(parsed.portfolio.riskProfile);
      if (parsed.portfolio.targetReturn) state.portfolio.targetReturn = String(parsed.portfolio.targetReturn);
      if (parsed.portfolio.capAppetite) state.portfolio.capAppetite = String(parsed.portfolio.capAppetite);
      if (parsed.portfolio.earlyMoverLens) state.portfolio.earlyMoverLens = String(parsed.portfolio.earlyMoverLens);
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
  normalizePortfolioSleeves();
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
    targetReturnBoost(item, adjustedBear, adjustedBase, adjustedBull) +
    timelineBoost(item) +
    capAppetiteBoost(item) +
    earlyMoverBoost(item) +
    eventTapeBoost(item) -
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
  const optionsCap = Math.min(rawOptionsCap, getMaxPremiumLoss());
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

function comboStrategies() {
  const months = Number(state.portfolio.timelineMonths) || 0;
  const eventIntensity = clamp(Number(state.portfolio.eventTapeIntensity) || 0, 0, 100);
  const liquid = state.ranked.filter((item) => item.optionsLiquidity >= 50);
  const highConvexity = liquid.filter((item) => item.convexity >= 68);
  const highRisk = liquid.filter((item) => item.valuationRisk >= 62);
  const resilient = liquid.filter((item) => item.adjustedMoic.bear >= 0.85 && item.liquidity >= 55);
  const jumboTape = liquid.filter((item) => ["NVDA", "TSM", "AVGO", "ASML", "AMAT", "QQQ", "SPY", "SMH", "VRT", "CRDO", "ALAB"].includes(item.symbol));
  const strategies = [];

  const callSpread = pickBest(highConvexity, (item) =>
    item.rankScore + item.convexity * 0.55 + item.optionsLiquidity * 0.35 + item.valuationRisk * 0.18
  );
  if (callSpread) strategies.push({
    title: "Debit Call Spread",
    item: callSpread.item,
    score: callSpread.score,
    tone: "good",
    useWhen: "The upside thesis is strong but straight calls look too expensive or IV is elevated.",
    structure: `Buy a ${optionContract(callSpread.item).tenor} call near 25-40 delta and sell a farther OTM call against it; keep max loss to the debit paid.`,
    why: `${callSpread.item.symbol} has strong convexity (${callSpread.item.convexity}/100), usable option liquidity, and enough bull/base separation to justify capped upside.`,
    guardrail: "Best for 10x-50x style payoff targets; capped upside means it is not the purest 100x-1000x expression."
  });

  const leapDiagonal = pickBest(highConvexity.filter((item) => item.volatility >= 45), (item) =>
    item.rankScore + item.optionsLiquidity * 0.55 + item.volatility * 0.35 + Math.max(0, item.adjustedMoic.base - 1) * 12
  );
  if (leapDiagonal) strategies.push({
    title: "LEAPS Diagonal",
    item: leapDiagonal.item,
    score: leapDiagonal.score,
    tone: "warn",
    useWhen: "You want long-duration upside but expect repeated short-term volatility spikes before the thesis fully pays.",
    structure: `Own a deep ITM ${optionContract(leapDiagonal.item).tenor} call and sell short-dated OTM calls only after sharp rallies or event-vol spikes.`,
    why: `${leapDiagonal.item.symbol} combines long-cycle bottleneck upside with enough option activity to consider harvesting shorter-dated premium.`,
    guardrail: "Assignment, early exercise, and capped upside matter; do not sell calls through catalysts where you want uncapped exposure."
  });

  const coveredCall = pickBest(resilient.filter((item) => item.valuationRisk >= 55), (item) =>
    item.expectedMoic * 20 + item.optionsLiquidity * 0.4 + item.volatility * 0.28 - Math.max(0, item.convexity - 82) * 0.3
  );
  if (coveredCall) strategies.push({
    title: "Covered Call / Buy-Write",
    item: coveredCall.item,
    score: coveredCall.score,
    tone: "good",
    useWhen: "A friend wants AI exposure but prefers income and lower break-even over uncapped moonshot upside.",
    structure: `Buy common stock and sell 30-60 DTE OTM calls against only the portion you are willing to have called away.`,
    why: `${coveredCall.item.symbol} has a survivable bear/base profile and enough volatility to make overwrite math worth checking.`,
    guardrail: "This can be a bad structure for true moonshots because the short call sells away the explosive right tail."
  });

  const protectiveCollar = pickBest(highRisk, (item) =>
    item.valuationRisk * 0.7 + item.liquidity * 0.35 + item.optionsLiquidity * 0.35 + state.factors.taiwan * 0.18 + state.factors.export * 0.15
  );
  if (protectiveCollar) strategies.push({
    title: "Protective Collar",
    item: protectiveCollar.item,
    score: protectiveCollar.score,
    tone: "warn",
    useWhen: "You want to own the bottleneck winner but the current tape has geopolitical, export-control, or valuation gap risk.",
    structure: "Own common, buy a protective put, and optionally sell an OTM call to partially fund protection.",
    why: `${protectiveCollar.item.symbol} ranks with elevated valuation/event risk, so the best expression may be protected equity rather than naked upside.`,
    guardrail: "The call leg caps upside; use collars for survival profiles or event-risk windows, not for maximum convexity sleeves."
  });

  const cashSecuredPut = pickBest(resilient, (item) =>
    item.expectedMoic * 18 + item.conviction * 0.25 + item.optionsLiquidity * 0.35 + Math.max(0, item.valuationRisk - 55) * 0.25
  );
  if (cashSecuredPut) strategies.push({
    title: "Cash-Secured Put Entry",
    item: cashSecuredPut.item,
    score: cashSecuredPut.score,
    tone: "good",
    useWhen: "You like the name but want to be paid for waiting for a pullback instead of chasing a spike.",
    structure: "Sell a cash-secured put at a price where you would be happy to own common; hold full assignment cash.",
    why: `${cashSecuredPut.item.symbol} has sufficient liquidity and a constructive base case, making entry discipline more valuable than immediate FOMO.`,
    guardrail: "Return is capped and assignment is real; this is not a 100x expression, but it can improve entries for safer sleeves."
  });

  if (months <= 1 || eventIntensity >= 55) {
    const eventPremium = pickBest(jumboTape, (item) =>
      item.optionsLiquidity * 0.8 + item.volatility * 0.55 + item.liquidity * 0.25 + shortCatalystScore(item) * 3 + eventIntensity * 0.15
    );
    if (eventPremium) strategies.push({
      title: "Defined-Risk Event Strangle",
      item: eventPremium.item,
      score: eventPremium.score,
      tone: "danger",
      useWhen: "A known catalyst, policy headline, or social-tape shock can move the name hard but direction is uncertain.",
      structure: "Buy a short-dated strangle or broken-wing fly with premium sized as a throwaway event sleeve.",
      why: `${eventPremium.item.symbol} has the liquidity and tape sensitivity needed for intraday-to-weekly event structures.`,
      guardrail: "Do not use this without live IV, spread, and catalyst timing checks; most short-dated premium can expire worthless."
    });
  }

  const stockReplacement = pickBest(highConvexity, (item) =>
    item.rankScore + item.liquidity * 0.25 + item.optionsLiquidity * 0.4 + Math.max(0, state.portfolio.optionsCap - 40) * 0.18
  );
  if (stockReplacement) strategies.push({
    title: "Stock Replacement Call",
    item: stockReplacement.item,
    score: stockReplacement.score,
    tone: "warn",
    useWhen: "You want upside exposure with less capital tied up than common and accept the possibility of total premium loss.",
    structure: `Buy a deep ITM ${optionContract(stockReplacement.item).tenor} call with enough delta to behave like stock; reserve released cash for adds or hedges.`,
    why: `${stockReplacement.item.symbol} has the options liquidity and convexity profile to justify replacing some common with long calls.`,
    guardrail: "This raises timing risk versus stock; avoid if the thesis could take longer than the option tenor."
  });

  return dedupeStrategies(strategies).sort((a, b) => b.score - a.score);
}

function pickBest(items, scoreFn) {
  return items
    .map((item) => ({ item, score: scoreFn(item) }))
    .sort((a, b) => b.score - a.score)[0];
}

function dedupeStrategies(strategies) {
  const seen = new Set();
  return strategies.filter((strategy) => {
    const key = `${strategy.title}-${strategy.item.symbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
        <div class="brand-text">
          <h1>${escapeHtml(state.data.metadata.title)}</h1>
          <p>${escapeHtml(state.data.metadata.horizon)} speculative bottleneck lab · ${escapeHtml(state.data.metadata.dataCutoff)} snapshot</p>
        </div>
      </div>
      <nav class="tabs" aria-label="Lab sections">
        ${tabs.map((tab) => `<button class="tab ${tab === state.activeTab ? "active" : ""}" data-tab="${tab}">${tab}</button>`).join("")}
      </nav>
      <div class="top-actions">
        <button class="ghost-action" id="toggleInspector" title="${state.inspectorOpen ? "Hide proxy inspector" : "Show proxy inspector"}">${state.inspectorOpen ? "Hide detail" : "Show detail"}</button>
        <button class="ghost-action" id="copyScenario" title="Copy collaboration link">Copy link</button>
        <button class="ghost-action" id="exportScenario" title="Export scenario JSON">Export</button>
        <button class="primary-action" id="importScenario">Import</button>
        <input class="hidden-file" id="importFile" type="file" accept="application/json,.json">
      </div>
    </header>
    <main class="grid-shell ${state.inspectorOpen ? "" : "inspector-closed"}">
      ${renderControls()}
      <section class="workspace">
        ${renderMetrics()}
        ${renderActiveTab()}
      </section>
      ${state.inspectorOpen ? renderInspector() : ""}
    </main>
  `;
  bindEvents();
  requestAnimationFrame(keepActiveTabVisible);
}

function keepActiveTabVisible() {
  document.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "center" });
}

function renderLiveSections() {
  const workspace = document.querySelector(".workspace");
  if (workspace) workspace.innerHTML = `${renderMetrics()}${renderActiveTab()}`;
  const inspector = document.querySelector(".inspector");
  if (state.inspectorOpen && inspector) inspector.outerHTML = renderInspector();
  bindDynamicEvents();
}

function renderControls() {
  const profiles = state.data.riskProfiles || [];
  const profile = getRiskProfile();
  const sleeveTotal = roundPercent(Number(state.portfolio.equityCap) + Number(state.portfolio.optionsCap));
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
          <label class="input-field"><span>Equity sleeve %</span><input id="equityInput" type="number" min="0" max="100" step="1" value="${state.portfolio.equityCap}"></label>
          <label class="input-field"><span>Options sleeve %</span><input id="optionsInput" type="number" min="0" max="100" step="1" value="${state.portfolio.optionsCap}"></label>
          <label class="input-field"><span>Cap appetite</span><select id="capAppetiteInput">${capAppetiteOptions().map((option) => `<option value="${option.id}" ${option.id === state.portfolio.capAppetite ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>
          <label class="input-field"><span>Early mover lens</span><select id="earlyMoverInput">${earlyMoverOptions().map((option) => `<option value="${option.id}" ${option.id === state.portfolio.earlyMoverLens ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>
        </div>
        <div class="allocation-check ${Math.abs(sleeveTotal - 100) < 0.01 ? "good" : "warn"}">
          <span>Equity + options split</span>
          <strong>${sleeveTotal}%</strong>
          <em>Changing either sleeve rebalances the other to keep the visible split at 100%.</em>
        </div>
        <div class="timeline-control">
          <div class="slider-label"><strong>Investment timeline</strong><output>${escapeHtml(formatTimelineMonths(state.portfolio.timelineMonths))}</output></div>
          <input id="timelineInput" type="range" min="0" max="60" step="1" value="${state.portfolio.timelineMonths}" aria-label="Investment timeline in months">
          <div class="slider-help"><span>0DTE / tape</span><span>3-5 yr structural</span></div>
        </div>
        <div class="timeline-control">
          <div class="slider-label"><strong>0DTE / event-tape intensity</strong><output>${state.portfolio.eventTapeIntensity}</output></div>
          <input id="eventTapeInput" type="range" min="0" max="100" step="5" value="${state.portfolio.eventTapeIntensity}" aria-label="0DTE and event-tape intensity">
          <div class="slider-help"><span>Ignore</span><span>Aggressive secondary sleeve</span></div>
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
  if (state.activeTab === "Timeline") return renderTimeline();
  if (state.activeTab === "Options Ladder") return renderOptionsLadder();
  if (state.activeTab === "Event Radar") return renderEventRadar();
  if (state.activeTab === "Early Movers") return renderEarlyMovers();
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

function renderTimeline() {
  const active = activeTimelineHorizon();
  const horizonRows = state.ranked
    .map((item) => ({ item, score: timelineIdeaScore(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>Editable investment timeline</h2>
        <p>The same AI thesis needs different instruments at different durations. Move the timeline slider in Scenario Controls, or click a segment below, to shift the ranker toward event tape, earnings catalysts, thesis-build windows, or multi-year structural compounding.</p>
      </section>
      <section class="panel">
        <div class="timeline-band">
          ${state.data.timelineHorizons.map((horizon) => `
            <button class="timeline-segment ${horizon.id === active.id ? "active" : ""}" type="button" data-set-timeline="${horizon.months}">
              <strong>${escapeHtml(horizon.label)}</strong>
              <span>${escapeHtml(formatTimelineMonths(horizon.months))}</span>
            </button>
          `).join("")}
        </div>
      </section>
      <section class="two-col">
        <section class="panel">
          <div class="panel-header">
            <h2>${escapeHtml(active.label)}</h2>
            <small>${escapeHtml(formatTimelineMonths(state.portfolio.timelineMonths))}</small>
          </div>
          <div class="timeline-detail">
            <p>${escapeHtml(active.summary)}</p>
            <p><strong>Best fit:</strong> ${active.fit.map((symbol) => `<button class="ticker-chip" data-select="${symbol}" type="button">${symbol}</button>`).join("")}</p>
            <p><strong>Avoid:</strong> ${escapeHtml(active.avoid)}</p>
            <p class="footer-note">Sources: ${sourceLinks(active.sourceIds)}</p>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <h2>Market-cap aperture</h2>
            <small>${escapeHtml(capAppetiteLabel(state.portfolio.capAppetite))}</small>
          </div>
          <div class="timeline-detail">
            <p>Cap size is a ranker input, not an exclusion. Jumbo names usually fit 0DTE/1-2DTE liquidity; mid/small names usually fit 3-36 month rerating; microcaps belong in the scout lane unless liquidity and source quality are proven.</p>
            <div class="cap-grid">
              ${capAppetiteOptions().map((option) => `<button class="cap-button ${option.id === state.portfolio.capAppetite ? "active" : ""}" type="button" data-cap-appetite="${option.id}">${escapeHtml(option.label)}</button>`).join("")}
            </div>
          </div>
        </section>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Ideas Matched To This Timeline</h2>
          <small>${horizonRows.length} ranked</small>
        </div>
        <div class="timeline-idea-grid">
          ${horizonRows.map(({ item, score }) => `
            <article class="timeline-idea selectable-card" data-select="${item.symbol}">
              <header>
                <div><h3>${item.symbol} · ${escapeHtml(item.company)}</h3><p>${escapeHtml(capTierLabel(item))} · ${escapeHtml(item.bucket)} · ${escapeHtml(item.layer)}</p></div>
                <span class="tag ${score > 80 ? "good" : score > 62 ? "warn" : ""}">${Math.round(score)}</span>
              </header>
              <p>${escapeHtml(timelineReason(item))}</p>
            </article>
          `).join("")}
        </div>
      </section>
      ${renderEventTapePanel()}
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
      ${renderComboStrategies()}
    </section>
  `;
}

function renderComboStrategies() {
  const strategies = comboStrategies().slice(0, 8);
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Combo Strategy Selector</h2>
        <small>Defined-risk structures · proxy setup</small>
      </div>
      <div class="combo-grid">
        ${strategies.map((strategy) => `
          <article class="combo-card selectable-card" data-select="${strategy.item.symbol}">
            <header>
              <div>
                <h3>${escapeHtml(strategy.title)}</h3>
                <p>${strategy.item.symbol} · ${escapeHtml(strategy.item.company)}</p>
              </div>
              <span class="tag ${strategy.tone}">${Math.round(clamp(strategy.score / 4, 0, 100))} fit</span>
            </header>
            <div class="combo-body">
              <p><strong>Use when:</strong> ${escapeHtml(strategy.useWhen)}</p>
              <p><strong>Structure:</strong> ${escapeHtml(strategy.structure)}</p>
              <p><strong>Why this ticker:</strong> ${escapeHtml(strategy.why)}</p>
              <p class="footer-note">${escapeHtml(strategy.guardrail)}</p>
            </div>
          </article>
        `).join("")}
      </div>
      <p class="structure-note">Combo structures are a decision-support overlay on the current scenario, not executable quotes. Refresh option chains, bid/ask, IV rank, open interest, borrow/assignment rules, and tax treatment before trading.</p>
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
      ${renderEventTapePanel()}
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

function renderEventTapePanel() {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>0DTE / 1-2DTE Public Event Tape</h2>
        <small>Secondary sleeve · intensity ${state.portfolio.eventTapeIntensity}/100</small>
      </div>
      <div class="event-tape-grid">
        ${state.data.eventTapeCandidates.map((candidate) => `
          <article class="event-tape-card">
            <header>
              <div><h3>${escapeHtml(candidate.label)}</h3><p>${escapeHtml(candidate.duration)} · ${candidate.instruments.map((symbol) => `<span class="tag">${escapeHtml(symbol)}</span>`).join(" ")}</p></div>
              <span class="tag danger">defined risk</span>
            </header>
            <p><strong>Signals:</strong> ${escapeHtml(candidate.signals.join("; "))}</p>
            <p><strong>Structure:</strong> ${escapeHtml(candidate.structure)}</p>
            <p><strong>Guardrail:</strong> ${escapeHtml(candidate.guardrail)}</p>
            <p class="footer-note">Sources: ${sourceLinks(candidate.sources)}</p>
          </article>
        `).join("")}
      </div>
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

function renderEarlyMovers() {
  const summaryRows = earlyMoverSummaries();
  const signalRows = earlyMoverSignals();
  const ownershipCount = signalRows.filter((signal) => signal.sourceType === "13D/G").length;
  const unusualCount = signalRows.filter((signal) => signal.unusuallyBullish).length;
  const generated = state.earlyMovers?.metadata?.generatedAt ? formatDateTime(state.earlyMovers.metadata.generatedAt) : "unavailable";
  return `
    <section class="tab-panel">
      <section class="panel narrative">
        <h2>Known early mover filter</h2>
        <p>This lens tracks known funds and investors of scale with a curated success-history prior, then flags matched AI-stack holdings from SEC 13F and more time-sensitive Schedule 13D/13G filings. It is a context layer only: 13F is delayed, 13D/G is ownership disclosure, and neither proves live intent.</p>
      </section>
      <section class="metrics-grid">
        <div class="metric"><span>Tracked managers</span><strong>${state.earlyMovers.managers.length}</strong><em>SEC CIKs monitored</em></div>
        <div class="metric"><span>Matched signals</span><strong>${signalRows.length}</strong><em>${ownershipCount} from 13D/G ownership events</em></div>
        <div class="metric"><span>Unusually bullish</span><strong>${unusualCount}</strong><em>score and confidence threshold</em></div>
        <div class="metric"><span>Snapshot</span><strong>${escapeHtml(generated)}</strong><em>static EDGAR pull</em></div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Signal Filter</h2>
          <small>${escapeHtml(earlyMoverLabel(state.portfolio.earlyMoverLens))}</small>
        </div>
        <div class="lens-grid">
          ${earlyMoverOptions().map((option) => `
            <button class="lens-button ${option.id === state.portfolio.earlyMoverLens ? "active" : ""}" type="button" data-early-lens="${option.id}">
              <strong>${escapeHtml(option.label)}</strong>
              <span>${escapeHtml(option.help)}</span>
            </button>
          `).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Symbol Stack Rank</h2>
          <small>${summaryRows.length} matched AI names</small>
        </div>
        <div class="early-summary-grid">
          ${summaryRows.map((row) => `
            <article class="early-summary selectable-card" data-select="${row.symbol}">
              <header>
                <div><h3>${row.symbol} · ${escapeHtml(row.securityName)}</h3><p>${escapeHtml(row.managerNames.join(", "))}</p></div>
                <span class="tag ${row.unusuallyBullishManagers ? "good" : row.ownershipEvents ? "warn" : ""}">${row.weightedScore}</span>
              </header>
              <div class="early-stats">
                <span>${row.signalCount || row.managers} signals</span>
                <span>${row.managerCount || row.managerNames.length} managers</span>
                <span>${row.unusuallyBullishManagers} unusual</span>
                <span>${row.ownershipEvents} 13D/G</span>
                <span>${formatMoney(row.totalValueUsd)} 13F</span>
              </div>
              <p>${escapeHtml(row.rationale)}</p>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Unusual Trade / Ownership Signals</h2>
          <small>${signalRows.length} source-linked rows</small>
        </div>
        <div class="early-signal-grid">
          ${signalRows.map((signal) => `
            <article class="early-signal selectable-card" data-select="${signal.symbol}">
              <header>
                <div>
                  <h3>${signal.symbol} · ${escapeHtml(signal.managerName)}</h3>
                  <p>${escapeHtml(signal.filingType)} · ${escapeHtml(signal.latestFilingDate || signal.latestReportDate)} · ${escapeHtml(signal.stance)}</p>
                </div>
                <span class="tag ${signal.unusuallyBullish ? "good" : signal.sourceType === "13D/G" ? "warn" : ""}">${signal.signalScore}/${signal.confidence}</span>
              </header>
              <div class="early-stats">
                <span>${escapeHtml(signal.sourceType)}</span>
                <span>${formatMoney(signal.valueUsd || 0)} value</span>
                <span>${formatMoney(signal.deltaValueUsd || 0)} delta</span>
                <span>${signal.ownershipPct ? `${signal.ownershipPct}% owned` : "ownership n/a"}</span>
              </div>
              <p>${escapeHtml(signal.rationale)}</p>
              <p class="footer-note"><a href="${escapeAttr(signal.sourceUrl)}" target="_blank" rel="noreferrer">Open SEC filing</a>${signal.informationTableUrl ? ` · <a href="${escapeAttr(signal.informationTableUrl)}" target="_blank" rel="noreferrer">source table/text</a>` : ""}</p>
            </article>
          `).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Method Caveats</h2>
          <small>Do not overfit</small>
        </div>
        <div class="claim-list">
          <article class="claim">
            <header><h3>What the signal can say</h3><span class="tag good">useful context</span></header>
            <p>${escapeHtml(state.earlyMovers.metadata.caveat || "")}</p>
          </article>
          <article class="claim">
            <header><h3>What it cannot say</h3><span class="tag warn">hard limit</span></header>
            <p>It cannot see intraday trading, private funds below reporting thresholds, swaps, shorts, most offshore exposure, or whether a reported long position is hedged elsewhere.</p>
          </article>
        </div>
      </section>
    </section>
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
  const early = earlyMoverSummary(selected.symbol);
  return `
    <aside class="panel inspector">
      <div class="panel-header">
        <h2>Inspector</h2>
        <div class="inspector-actions">
          <small>${selected.priceQuality}</small>
          <button class="icon-button" id="closeInspector" type="button" aria-label="Hide proxy inspector">X</button>
        </div>
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
        ${early ? `
          <div class="text-block">
            <h3>Early mover signal</h3>
            <p>${escapeHtml(early.rationale)} Managers: ${escapeHtml(early.managerNames.join(", "))}.</p>
          </div>
        ` : ""}
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
            <th>Cap</th>
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
              <td><span class="tag">${escapeHtml(capTierLabel(item))}</span></td>
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
      updateSliderOutput(input, input.value);
      recalculate();
      renderLiveSections();
    });
  });
  bindDynamicEvents();
  const capital = document.getElementById("capitalInput");
  const equity = document.getElementById("equityInput");
  const options = document.getElementById("optionsInput");
  const riskProfile = document.getElementById("riskProfileInput");
  const targetReturn = document.getElementById("targetReturnInput");
  const maxLoss = document.getElementById("maxLossInput");
  const timeline = document.getElementById("timelineInput");
  const eventTape = document.getElementById("eventTapeInput");
  const capAppetite = document.getElementById("capAppetiteInput");
  const earlyMover = document.getElementById("earlyMoverInput");
  if (capital) capital.addEventListener("change", () => updatePortfolio("capital", clamp(Number(capital.value), 1000, 100000000)));
  if (equity) equity.addEventListener("change", () => updateSleeve("equityCap", Number(equity.value)));
  if (options) options.addEventListener("change", () => updateSleeve("optionsCap", Number(options.value)));
  if (riskProfile) riskProfile.addEventListener("change", () => applyRiskProfile(riskProfile.value));
  if (targetReturn) targetReturn.addEventListener("change", () => updatePortfolio("targetReturn", targetReturn.value));
  if (maxLoss) maxLoss.addEventListener("change", () => updateMaxPremiumLoss(Number(maxLoss.value)));
  if (timeline) {
    timeline.addEventListener("input", () => {
      state.portfolio.timelineMonths = Number(timeline.value);
      updateSliderOutput(timeline, formatTimelineMonths(state.portfolio.timelineMonths));
      recalculate();
      renderLiveSections();
    });
  }
  if (eventTape) {
    eventTape.addEventListener("input", () => {
      state.portfolio.eventTapeIntensity = clamp(Number(eventTape.value), 0, 100);
      updateSliderOutput(eventTape, state.portfolio.eventTapeIntensity);
      recalculate();
      renderLiveSections();
    });
  }
  if (capAppetite) capAppetite.addEventListener("change", () => updatePortfolio("capAppetite", capAppetite.value));
  if (earlyMover) earlyMover.addEventListener("change", () => updatePortfolio("earlyMoverLens", earlyMover.value));

  document.getElementById("toggleInspector")?.addEventListener("click", toggleInspector);
  document.getElementById("copyScenario")?.addEventListener("click", copyScenarioLink);
  document.getElementById("exportScenario")?.addEventListener("click", exportScenario);
  document.getElementById("importScenario")?.addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile")?.addEventListener("change", importScenario);
}

function bindDynamicEvents() {
  document.querySelectorAll("[data-select]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedSymbol = row.dataset.select;
      recalculate();
      render();
    });
  });
  document.querySelectorAll("[data-set-timeline]").forEach((button) => {
    button.addEventListener("click", () => updatePortfolio("timelineMonths", Number(button.dataset.setTimeline)));
  });
  document.querySelectorAll("[data-cap-appetite]").forEach((button) => {
    button.addEventListener("click", () => updatePortfolio("capAppetite", button.dataset.capAppetite));
  });
  document.querySelectorAll("[data-early-lens]").forEach((button) => {
    button.addEventListener("click", () => updatePortfolio("earlyMoverLens", button.dataset.earlyLens));
  });
  document.getElementById("ideaForm")?.addEventListener("submit", addIdea);
  document.getElementById("addIdeaButton")?.addEventListener("click", addIdea);
  document.getElementById("clearIdeas")?.addEventListener("click", clearIdeas);
  document.getElementById("closeInspector")?.addEventListener("click", toggleInspector);
  document.querySelectorAll("[data-delete-note]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteIdea(button.dataset.deleteNote);
    });
  });
}

function updateSliderOutput(input, value) {
  const output = input.closest(".slider-row, .timeline-control")?.querySelector("output");
  if (output) output.textContent = value;
}

function toggleInspector() {
  state.inspectorOpen = !state.inspectorOpen;
  render();
}

function updatePortfolio(key, value) {
  state.portfolio[key] = value;
  recalculate();
  render();
}

function updateSleeve(key, value) {
  state.portfolio.cashMin = 0;
  const next = clamp(Number(value), 0, 100);
  if (key === "optionsCap") {
    state.portfolio.optionsCap = Math.min(next, getMaxPremiumLoss());
    state.portfolio.equityCap = Math.max(0, 100 - state.portfolio.optionsCap);
  } else if (key === "equityCap") {
    state.portfolio.equityCap = next;
    state.portfolio.optionsCap = Math.max(0, 100 - state.portfolio.equityCap);
    state.portfolio.optionsCap = Math.min(state.portfolio.optionsCap, getMaxPremiumLoss());
    state.portfolio.equityCap = Math.max(0, 100 - state.portfolio.optionsCap);
  }
  recalculate();
  render();
}

function updateMaxPremiumLoss(value) {
  state.portfolio.maxTotalLoss = clamp(Number(value), 0, 100);
  if (Number(state.portfolio.optionsCap) > state.portfolio.maxTotalLoss) {
    state.portfolio.optionsCap = state.portfolio.maxTotalLoss;
    state.portfolio.equityCap = Math.max(0, 100 - state.portfolio.optionsCap);
  }
  recalculate();
  render();
}

function normalizePortfolioSleeves() {
  const maxLoss = getMaxPremiumLoss();
  const options = clamp(Number(state.portfolio.optionsCap) || 0, 0, maxLoss);
  const equity = Math.max(0, 100 - options);
  state.portfolio.cashMin = 0;
  state.portfolio.optionsCap = roundPercent(options);
  state.portfolio.equityCap = roundPercent(equity);
  state.portfolio.timelineMonths = clamp(Number(state.portfolio.timelineMonths) || 0, 0, 60);
  state.portfolio.eventTapeIntensity = clamp(Number(state.portfolio.eventTapeIntensity) || 0, 0, 100);
  if (!capAppetiteOptions().some((option) => option.id === state.portfolio.capAppetite)) state.portfolio.capAppetite = "all";
  if (!earlyMoverOptions().some((option) => option.id === state.portfolio.earlyMoverLens)) state.portfolio.earlyMoverLens = "boost";
}

function getMaxPremiumLoss() {
  const value = Number(state.portfolio.maxTotalLoss);
  return Number.isFinite(value) ? clamp(value, 0, 100) : 100;
}

function applyRiskProfile(profileId) {
  const profile = (state.data.riskProfiles || []).find((item) => item.id === profileId) || getRiskProfile();
  state.portfolio.riskProfile = profile.id;
  state.portfolio.targetReturn = profile.target.includes("100x") ? "100x-1000x" :
    profile.target.includes("10x") ? "10x-50x" :
    profile.id === "survival" ? "Do-not-zero" : "3x-10x";
  state.portfolio.equityCap = profile.defaultEquity;
  state.portfolio.optionsCap = profile.defaultOptions;
  state.portfolio.cashMin = 0;
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
        ["capital", "equityCap", "optionsCap", "cashMin", "maxTotalLoss", "maxSingleEquity", "maxSingleOption", "timelineMonths", "eventTapeIntensity"].forEach((key) => {
          if (Number.isFinite(Number(parsed.portfolio[key]))) state.portfolio[key] = Number(parsed.portfolio[key]);
        });
        if (parsed.portfolio.riskProfile) state.portfolio.riskProfile = String(parsed.portfolio.riskProfile);
        if (parsed.portfolio.targetReturn) state.portfolio.targetReturn = String(parsed.portfolio.targetReturn);
        if (parsed.portfolio.capAppetite) state.portfolio.capAppetite = String(parsed.portfolio.capAppetite);
        if (parsed.portfolio.earlyMoverLens) state.portfolio.earlyMoverLens = String(parsed.portfolio.earlyMoverLens);
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

function timelineBoost(item) {
  const months = Number(state.portfolio.timelineMonths) || 0;
  const tapeNames = new Set(["NVDA", "TSM", "AVGO", "ASML", "AMAT", "QQQ", "SPY", "SMH"]);
  if (months <= 0.1) {
    return (item.optionsLiquidity * 0.18 + item.liquidity * 0.13 + item.volatility * 0.14 + (tapeNames.has(item.symbol) ? 14 : 0)) - item.valuationRisk * 0.04;
  }
  if (months <= 1) {
    return item.optionsLiquidity * 0.13 + item.volatility * 0.12 + item.liquidity * 0.08 + shortCatalystScore(item);
  }
  if (months <= 3) {
    return item.convexity * 0.12 + shortCatalystScore(item) + (item.optionsLiquidity > 60 ? 5 : 0);
  }
  if (months <= 12) {
    return item.conviction * 0.1 + item.convexity * 0.08 + (item.pdfBasket ? 5 : 0);
  }
  if (months <= 36) {
    return item.conviction * 0.12 + item.convexity * 0.1 + Math.max(0, item.moic.bull - item.moic.base) * 5;
  }
  return longDurationScore(item);
}

function timelineIdeaScore(item) {
  return clamp(45 + timelineBoost(item) + capAppetiteBoost(item) * 0.7 + eventTapeBoost(item) * 0.4, 0, 100);
}

function timelineReason(item) {
  const months = Number(state.portfolio.timelineMonths) || 0;
  if (months <= 0.1) return `${item.symbol} fits the tape lane because liquidity, options depth, and event sensitivity matter more than long-cycle upside over same-day windows.`;
  if (months <= 1) return `${item.symbol} fits a 1-4 week catalyst window when earnings, policy, social tape, or abnormal options activity can reprice expectations quickly.`;
  if (months <= 3) return `${item.symbol} fits a 1-3 month rerating if architecture evidence, customer data, or capex commentary moves before full-year estimates adjust.`;
  if (months <= 12) return `${item.symbol} fits a 6-12 month build where backlog, design wins, and supply-chain bottlenecks can show through multiple quarters.`;
  if (months <= 36) return `${item.symbol} fits the core AI bottleneck window where thesis validation and multiple expansion can compound over 18-36 months.`;
  return `${item.symbol} fits a structural 3-5 year lens when power, grid, reshoring, or deep supply-chain adoption matters more than a single quarter.`;
}

function shortCatalystScore(item) {
  const words = `${item.catalysts.join(" ")} ${item.thesis}`.toLowerCase();
  let score = 0;
  if (words.includes("earnings") || words.includes("revenue")) score += 5;
  if (words.includes("capex") || words.includes("customer") || words.includes("design")) score += 6;
  if (words.includes("export") || words.includes("china") || words.includes("policy")) score += 4;
  if (["CRDO", "ALAB", "NVDA", "TSM", "AVGO", "ASML", "VRT"].includes(item.symbol)) score += 5;
  return score;
}

function longDurationScore(item) {
  const structuralBuckets = new Set(["Electrical", "Grid", "Power generation", "Uranium", "Outsourced assembly/test", "Test"]);
  const layerText = `${item.bucket} ${item.layer}`.toLowerCase();
  let score = item.conviction * 0.12 + item.liquidity * 0.05;
  if (structuralBuckets.has(item.bucket)) score += 10;
  if (layerText.includes("power") || layerText.includes("grid") || layerText.includes("assembly") || layerText.includes("test")) score += 6;
  return score;
}

function eventTapeBoost(item) {
  const intensity = clamp(Number(state.portfolio.eventTapeIntensity) || 0, 0, 100) / 100;
  if (!intensity) return 0;
  const tapeSymbols = new Set(["NVDA", "TSM", "AVGO", "ASML", "AMAT", "CRDO", "ALAB", "VRT", "MRVL", "ANET"]);
  const raw = item.optionsLiquidity * 0.13 + item.liquidity * 0.08 + item.volatility * 0.12 + (tapeSymbols.has(item.symbol) ? 12 : 0) - Math.max(0, 45 - item.liquidity) * 0.25;
  return raw * intensity;
}

function earlyMoverBoost(item) {
  const lens = state.portfolio.earlyMoverLens || "boost";
  if (lens === "off") return 0;
  const summary = earlyMoverSummary(item.symbol);
  if (!summary) {
    if (lens === "require") return -22;
    if (lens === "unusual") return -34;
    return 0;
  }
  const base = clamp(summary.weightedScore / 18 + summary.unusuallyBullishManagers * 5 + summary.ownershipEvents * 6 + summary.highConfidenceSignals * 2, 0, 34);
  if (lens === "unusual") return summary.unusuallyBullishManagers > 0 || summary.ownershipEvents > 0 ? base + 8 : -20;
  if (lens === "require") return base;
  return base * 0.75;
}

function earlyMoverSummaries() {
  const rows = state.earlyMovers?.summaryBySymbol || [];
  const lens = state.portfolio.earlyMoverLens || "boost";
  return rows
    .filter((row) => lens !== "unusual" || row.unusuallyBullishManagers > 0 || row.ownershipEvents > 0)
    .sort((a, b) => b.weightedScore - a.weightedScore);
}

function earlyMoverSignals() {
  const lens = state.portfolio.earlyMoverLens || "boost";
  return (state.earlyMovers?.signals || [])
    .filter((signal) => lens !== "unusual" || signal.unusuallyBullish || signal.sourceType === "13D/G")
    .sort((a, b) => {
      if (a.sourceType !== b.sourceType) return a.sourceType === "13D/G" ? -1 : 1;
      return b.signalScore - a.signalScore;
    })
    .slice(0, 36);
}

function earlyMoverSummary(symbol) {
  return (state.earlyMovers?.summaryBySymbol || []).find((row) => row.symbol === symbol);
}

function capAppetiteBoost(item) {
  const appetite = state.portfolio.capAppetite || "all";
  const tier = capTier(item);
  if (appetite === "jumbo") return tier === "jumbo" ? 14 : tier === "large" ? 7 : tier === "mid" ? -2 : -10;
  if (appetite === "largeMid") return tier === "large" || tier === "mid" ? 10 : tier === "jumbo" ? 4 : 3;
  if (appetite === "smallMicro") return tier === "micro" ? 16 : tier === "small" ? 13 : tier === "mid" ? 7 : -8;
  return 0;
}

function activeTimelineHorizon() {
  const months = Number(state.portfolio.timelineMonths) || 0;
  const horizons = state.data.timelineHorizons || [];
  if (months <= 0) return horizons.find((item) => item.id === "zero-two-day") || horizons[0];
  if (months <= 1) return horizons.find((item) => item.id === "one-four-week") || horizons[0];
  if (months <= 3) return horizons.find((item) => item.id === "one-three-month") || horizons[0];
  if (months <= 12) return horizons.find((item) => item.id === "six-twelve-month") || horizons[0];
  if (months <= 36) return horizons.find((item) => item.id === "eighteen-thirtysix-month") || horizons[0];
  return horizons.find((item) => item.id === "three-five-year") || horizons[horizons.length - 1];
}

function capTier(item) {
  const map = {
    NVDA: "jumbo", AVGO: "jumbo", TSM: "jumbo", ASML: "jumbo",
    AMAT: "large", ANET: "large", ETN: "large", CEG: "large", VRT: "large", MRVL: "large", VST: "large",
    PWR: "mid", TER: "mid", COHR: "mid", CLS: "mid", RMBS: "mid", ONTO: "mid", FORM: "mid", ALAB: "mid", CRDO: "mid", MOD: "mid", AMKR: "mid", CCJ: "mid", CAMT: "mid", BESIY: "mid",
    POET: "micro", ATOM: "micro", LWLG: "micro"
  };
  return map[item.symbol] || "small";
}

function capTierLabel(item) {
  const labels = { jumbo: "Jumbo", large: "Large", mid: "Mid", small: "Small", micro: "Micro" };
  return labels[capTier(item)] || "Small";
}

function capAppetiteOptions() {
  return [
    { id: "all", label: "Jumbo to micro" },
    { id: "jumbo", label: "Jumbo/liquid only" },
    { id: "largeMid", label: "Large + mid cap" },
    { id: "smallMicro", label: "Small/micro scout" }
  ];
}

function earlyMoverOptions() {
  return [
    { id: "off", label: "Ignore EDGAR", help: "Do not change the ranker from SEC manager signals." },
    { id: "boost", label: "Boost confirmed", help: "Add a modest score boost when tracked managers are present." },
    { id: "require", label: "Prefer tracked", help: "Penalize names with no tracked early-mover signal." },
    { id: "unusual", label: "Unusual only", help: "Focus on high-score, high-confidence, or 13D/G event signals." }
  ];
}

function earlyMoverLabel(value) {
  return earlyMoverOptions().find((option) => option.id === value)?.label || "Boost confirmed";
}

function capAppetiteLabel(value) {
  return capAppetiteOptions().find((option) => option.id === value)?.label || "Jumbo to micro";
}

function sourceLinks(ids = []) {
  return ids
    .map((id) => state.data.sources.find((source) => source.id === id))
    .filter(Boolean)
    .map((source) => source.url ? `<a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>` : escapeHtml(source.title))
    .join(" · ");
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

function roundPercent(value) {
  return Math.round(value * 10) / 10;
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

function formatTimelineMonths(value) {
  const months = Number(value) || 0;
  if (months <= 0.1) return "0DTE";
  if (months < 1) return "1-4 wk";
  if (months === 1) return "1 mo";
  if (months < 12) return `${Math.round(months)} mo`;
  if (months === 12) return "12 mo";
  return `${Math.round(months / 12 * 10) / 10} yr`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unsaved";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unavailable";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
