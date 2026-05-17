import { readFileSync, writeFileSync } from "node:fs";

const dataPath = "data/research_snapshot.json";
const userAgent = "ai-boom-investment-lab mattmiller@example.com";
const timeZone = "America/Chicago";
const today = localIsoDate(timeZone);

const snapshot = JSON.parse(readFileSync(dataPath, "utf8"));
const quoteRows = [];

for (const item of snapshot.universe) {
  const quote = await fetchStooqQuote(item.symbol);
  if (quote) {
    const priorPrice = item.price;
    item.price = round(quote.close, 2);
    item.priceAsOf = `${quote.date} Stooq delayed close`;
    item.priceQuality = "stooq_delayed_close";
    item.marketData = {
      source: "Stooq delayed daily quote",
      sourceUrl: quote.url,
      date: quote.date,
      time: quote.time,
      open: round(quote.open, 2),
      high: round(quote.high, 2),
      low: round(quote.low, 2),
      close: round(quote.close, 2),
      volume: quote.volume,
      priorSnapshotPrice: priorPrice,
      refreshDate: today
    };
    quoteRows.push({ symbol: item.symbol, ...quote });
  } else {
    item.priceQuality = `${item.priceQuality || "unknown"}; quote_refresh_unavailable`;
  }
  await delay(180);
}

snapshot.metadata.dataCutoff = today;
snapshot.metadata.marketDataAsOf = latestQuoteDate(quoteRows);
snapshot.metadata.lastRegeneratedAt = new Date().toISOString();
snapshot.metadata.marketDataSource = "Stooq delayed daily quotes";
snapshot.metadata.researchCaveat = "Universe prices were refreshed from delayed Stooq daily close data. These are still not executable broker quotes, and option chains, bid/ask, IV, open interest, borrow, and tax treatment must be refreshed before any trade.";

upsertSources(snapshot, [
  {
    id: "stooq-market-quotes",
    kind: "market_data",
    title: "Delayed daily equity quotes",
    publisher: "Stooq",
    date: today,
    url: "https://stooq.com/q/l/",
    quality: 3,
    notes: "Used only for delayed close/proxy price refresh across the app universe; not executable broker quotes."
  },
  {
    id: "iea-grids-2026",
    kind: "policy_primary",
    title: "Electricity 2026: Grids",
    publisher: "International Energy Agency",
    date: "2026",
    url: "https://www.iea.org/reports/electricity-2026/grids",
    quality: 5,
    notes: "Primary reference for grid capacity as a critical bottleneck, with grid infrastructure timelines longer than data-center build timelines."
  },
  {
    id: "tomshardware-lake-tahoe-grid",
    kind: "market_news",
    title: "Lake Tahoe residents could be left powerless as AI data centers inhale electricity supply",
    publisher: "Tom's Hardware",
    date: "2026-05-14",
    url: "https://www.tomshardware.com/tech-industry/artificial-intelligence/49-000-lake-tahoe-residents-could-be-left-powerless-as-ai-data-centers-inhale-electricity-supply-power-company-looking-to-redirect-power-to-12-data-centers-high-demand-plus-a-regulatory-limbo-equals-a-dim-situation",
    quality: 3,
    notes: "Recent public-market color on local grid stress from data-center load."
  },
  {
    id: "pcgamer-h200-china-cleared",
    kind: "market_news",
    title: "US approved Nvidia H200 sales to 10 Chinese firms, but deliveries remained pending",
    publisher: "PC Gamer / Reuters-reported",
    date: "2026-05-14",
    url: "https://www.pcgamer.com/hardware/the-us-has-approved-the-sale-of-nvidia-h200-chips-to-10-chinese-firms-but-sources-say-theyre-still-waiting-for-the-go-ahead-from-china-itself/",
    quality: 3,
    notes: "Late-breaking export-control tape: U.S. clearance is not equivalent to shipped China revenue."
  },
  {
    id: "tomshardware-trump-h200-blocked",
    kind: "market_news",
    title: "Trump says China is blocking Nvidia H200 purchases despite US approval",
    publisher: "Tom's Hardware",
    date: "2026-05-15",
    url: "https://www.tomshardware.com/tech-industry/trump-says-china-is-blocking-h200-purchases",
    quality: 3,
    notes: "Policy and geopolitical tape item for NVDA, China-sensitive semis, and export-control scenario sliders."
  }
]);

updateEventRadar(snapshot);
updateEventTape(snapshot);
updateClaims(snapshot);

writeFileSync(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`);

console.log(`refreshed ${quoteRows.length}/${snapshot.universe.length} quotes`);
console.log(`dataCutoff=${snapshot.metadata.dataCutoff}`);
console.log(`marketDataAsOf=${snapshot.metadata.marketDataAsOf}`);

async function fetchStooqQuote(symbol) {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  const rows = (await response.text()).trim().split(/\r?\n/);
  if (rows.length < 2) return null;
  const [ticker, date, time, open, high, low, close, volume] = rows[1].split(",");
  if (!ticker || date === "N/D" || close === "N/D") return null;
  return {
    ticker,
    date,
    time,
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    url
  };
}

function upsertSources(data, sources) {
  sources.forEach((source) => {
    const index = data.sources.findIndex((item) => item.id === source.id);
    if (index >= 0) data.sources[index] = source;
    else data.sources.push(source);
  });
}

function updateEventRadar(data) {
  const grid = data.eventRadar.find((event) => event.id === "grid-power-gating");
  if (grid) {
    grid.urgency = "high";
    grid.headline = "Grid and power scarcity is becoming the gating constraint for AI deployment";
    grid.whyItMatters = "Fresh public reports of local power redirection and stalled data-center projects reinforce that announced AI capex can be bottlenecked by interconnection, permitting, power availability, and cooling capacity.";
    grid.tilt = "Raise the grid bottleneck slider; favor VRT, MOD, ETN, PWR, CEG, and VST when the tape is about infrastructure scarcity. Hedge semis when the same news implies delayed GPU deployment rather than incremental power-equipment spend.";
    grid.sources = unique([...(grid.sources || []), "iea-grids-2026", "tomshardware-lake-tahoe-grid"]);
  }

  const exportTape = data.eventRadar.find((event) => event.id === "export-control-tape");
  if (exportTape) {
    exportTape.headline = "H200 China clearance is still a policy-tape trade, not a solved demand unlock";
    exportTape.whyItMatters = "The market can reprice NVDA and China-sensitive semis on U.S. approvals, Trump remarks, and Beijing response, but the latest public tape still separates license approval from actual deliveries.";
    exportTape.tilt = "For short-duration trades, treat H200/China headlines as volatility catalysts. Positive U.S.-approval tape can favor NVDA and semis intraday, while Beijing-blocking or tariff escalation favors lower-China-exposure infrastructure, U.S. power/grid, and cash rotation.";
    exportTape.sources = unique([...(exportTape.sources || []), "pcgamer-h200-china-cleared", "tomshardware-trump-h200-blocked"]);
  }
}

function updateEventTape(data) {
  const indexShock = data.eventTapeCandidates.find((event) => event.id === "index-ai-beta");
  if (indexShock) {
    indexShock.signals = unique([
      "Truth Social / White House tariff or China posts",
      "H200/Blackwell export-license or Beijing customs tape",
      "FOMC or rates shock",
      "NVDA/mega-cap AI headline",
      "SOXX/SMH abnormal volume"
    ]);
    indexShock.sources = unique([...(indexShock.sources || []), "pcgamer-h200-china-cleared", "tomshardware-trump-h200-blocked"]);
  }

  const semiEvent = data.eventTapeCandidates.find((event) => event.id === "single-name-semi-event");
  if (semiEvent) {
    semiEvent.signals = unique([
      "Earnings date proximity",
      "abnormal call/put volume vs open interest",
      "public customer/design-win report",
      "export-control decision window",
      "China import approval or blocking signal"
    ]);
    semiEvent.sources = unique([...(semiEvent.sources || []), "pcgamer-h200-china-cleared", "tomshardware-trump-h200-blocked"]);
  }
}

function updateClaims(data) {
  const power = data.claims.find((claim) => claim.claim === "Power and cooling are first-order AI capex constraints.");
  if (power) {
    power.confidence = 0.9;
    power.evidence = unique([...(power.evidence || []), "iea-grids-2026", "tomshardware-lake-tahoe-grid"]);
    power.notes = "IEA/EIA, company filings, and fresh local-grid reports support the grid, thermal, and electrical-equipment thesis.";
  }

  const priceClaim = data.claims.find((claim) => claim.claim === "The PDF's quoted share prices are executable current prices.");
  if (priceClaim) {
    priceClaim.status = "refreshed_proxy";
    priceClaim.confidence = 0.7;
    priceClaim.evidence = ["stooq-market-quotes"];
    priceClaim.notes = `Universe prices were refreshed from delayed Stooq closes with latest market date ${data.metadata.marketDataAsOf}. They are better than the PDF proxies, but they are still not executable broker quotes.`;
  }
}

function latestQuoteDate(rows) {
  return rows.map((row) => row.date).sort().at(-1) || null;
}

function localIsoDate(tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value, digits) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
