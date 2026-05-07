import { writeFileSync, readFileSync } from "node:fs";

const userAgent = "ai-boom-investment-lab mattmiller@example.com";
const secBase = "https://www.sec.gov";
const dataBase = "https://data.sec.gov";

const managers = [
  {
    id: "coatue",
    name: "Coatue Management",
    cik: "0001135730",
    type: "technology/growth hedge fund",
    trackRecordScore: 5,
    trackRecordRationale: "Curated prior: long-running technology and internet/growth specialist with public/private crossover history."
  },
  {
    id: "whale-rock",
    name: "Whale Rock Capital Management",
    cik: "0001387322",
    type: "technology hedge fund",
    trackRecordScore: 5,
    trackRecordRationale: "Curated prior: technology-focused manager known for concentrated public-market software, internet, and semiconductor exposure."
  },
  {
    id: "duquesne",
    name: "Duquesne Family Office",
    cik: "0001536411",
    type: "macro/family office",
    trackRecordScore: 5,
    trackRecordRationale: "Curated prior: Stanley Druckenmiller-led family office with widely followed macro/equity allocation history."
  },
  {
    id: "appaloosa",
    name: "Appaloosa LP",
    cik: "0001656456",
    type: "event-driven/value hedge fund",
    trackRecordScore: 4,
    trackRecordRationale: "Curated prior: David Tepper-associated manager with notable distressed, cyclicals, and large-cap technology positioning history."
  },
  {
    id: "tiger-global",
    name: "Tiger Global Management",
    cik: "0001167483",
    type: "global technology/growth investor",
    trackRecordScore: 4,
    trackRecordRationale: "Curated prior: large-scale technology growth investor with public/private crossover history."
  },
  {
    id: "d1",
    name: "D1 Capital Partners",
    cik: "0001747057",
    type: "crossover hedge fund",
    trackRecordScore: 4,
    trackRecordRationale: "Curated prior: crossover manager with large public technology and consumer internet exposure."
  },
  {
    id: "lone-pine",
    name: "Lone Pine Capital",
    cik: "0001061165",
    type: "long/short growth hedge fund",
    trackRecordScore: 4,
    trackRecordRationale: "Curated prior: established long/short growth manager with a history of large public technology positions."
  },
  {
    id: "light-street",
    name: "Light Street Capital",
    cik: "0001569049",
    type: "technology hedge fund",
    trackRecordScore: 4,
    trackRecordRationale: "Curated prior: technology-oriented manager with public market software, internet, and semiconductor focus."
  },
  {
    id: "matrix",
    name: "Matrix Capital Management",
    cik: "0001410830",
    type: "technology/growth hedge fund",
    trackRecordScore: 4,
    trackRecordRationale: "Curated prior: technology/growth specialist with concentrated public-market holdings."
  },
  {
    id: "durable",
    name: "Durable Capital Partners",
    cik: "0001798849",
    type: "long-duration growth investor",
    trackRecordScore: 3,
    trackRecordRationale: "Curated prior: long-duration growth manager; useful as a secondary confirmation signal rather than a pure AI specialist."
  }
];

const securities = [
  { symbol: "NVDA", name: "NVIDIA", cusips: ["67066G104"], aliases: ["NVIDIA CORP"] },
  { symbol: "AVGO", name: "Broadcom", cusips: ["11135F101"], aliases: ["BROADCOM INC"] },
  { symbol: "TSM", name: "Taiwan Semiconductor", cusips: ["874039100"], aliases: ["TAIWAN SEMICONDUCTOR", "TAIWAN SEMICONDUCTOR MFG"] },
  { symbol: "ASML", name: "ASML", cusips: ["N07059210"], aliases: ["ASML HOLDING"] },
  { symbol: "AMAT", name: "Applied Materials", cusips: ["038222105"], aliases: ["APPLIED MATERIALS"] },
  { symbol: "MRVL", name: "Marvell", cusips: ["573874104"], aliases: ["MARVELL TECHNOLOGY"] },
  { symbol: "ANET", name: "Arista Networks", cusips: ["040413106"], aliases: ["ARISTA NETWORKS"] },
  { symbol: "VRT", name: "Vertiv", cusips: ["92537N108"], aliases: ["VERTIV HOLDINGS"] },
  { symbol: "CRDO", name: "Credo Technology", cusips: ["G25457105"], aliases: ["CREDO TECHNOLOGY"] },
  { symbol: "ALAB", name: "Astera Labs", cusips: ["04626A103"], aliases: ["ASTERA LABS"] },
  { symbol: "RMBS", name: "Rambus", cusips: ["750917106"], aliases: ["RAMBUS"] },
  { symbol: "FORM", name: "FormFactor", cusips: ["346375108"], aliases: ["FORMFACTOR"] },
  { symbol: "ONTO", name: "Onto Innovation", cusips: ["683344105"], aliases: ["ONTO INNOVATION"] },
  { symbol: "CAMT", name: "Camtek", cusips: ["M20791105"], aliases: ["CAMTEK"] },
  { symbol: "MOD", name: "Modine", cusips: ["607828100"], aliases: ["MODINE MFG", "MODINE MANUFACTURING"] },
  { symbol: "CLS", name: "Celestica", cusips: ["15101Q108"], aliases: ["CELESTICA"] },
  { symbol: "COHR", name: "Coherent", cusips: ["19247G107"], aliases: ["COHERENT CORP"] },
  { symbol: "ETN", name: "Eaton", cusips: ["G29183103"], aliases: ["EATON CORP"] },
  { symbol: "PWR", name: "Quanta Services", cusips: ["74762E102"], aliases: ["QUANTA SERVICES"] },
  { symbol: "CEG", name: "Constellation Energy", cusips: ["21037T109"], aliases: ["CONSTELLATION ENERGY"] },
  { symbol: "VST", name: "Vistra", cusips: ["92840M102"], aliases: ["VISTRA"] },
  { symbol: "CCJ", name: "Cameco", cusips: ["13321L108"], aliases: ["CAMECO"] },
  { symbol: "TER", name: "Teradyne", cusips: ["880770102"], aliases: ["TERADYNE"] },
  { symbol: "AMKR", name: "Amkor", cusips: ["031652100"], aliases: ["AMKOR TECH"] }
];

const research = JSON.parse(readFileSync("data/research_snapshot.json", "utf8"));
const universeSymbols = new Set(research.universe.map((item) => item.symbol));

const snapshot = {
  metadata: {
    title: "SEC EDGAR Early Mover Snapshot",
    generatedAt: new Date().toISOString(),
    source: "SEC EDGAR submissions JSON, 13F-HR information tables, and Schedule 13D/13G filings",
    caveat: "13F data is delayed, long-only for reportable securities, can omit shorts/swaps/non-13F instruments, and does not reveal current intent. Schedule 13D/G filings are more timely ownership disclosures but still do not prove current trading intent. Treat this as a context signal, not a trade instruction."
  },
  managers: [],
  signals: [],
  summaryBySymbol: [],
  sourceLinks: [
    {
      title: "SEC submissions API base",
      url: "https://data.sec.gov/submissions/"
    },
    { title: "SEC EDGAR company filings browser", url: "https://www.sec.gov/edgar/search/" },
    { title: "SEC Schedule 13D/13G filing search", url: "https://www.sec.gov/edgar/search/#/q=%2522SC%252013D%2522%2520%2522SC%252013G%2522" }
  ]
};

for (const manager of managers) {
  try {
    const recentFilings = await recentFilingsForManager(manager.cik);
    const filings = latest13FFilings(recentFilings);
    const ownershipFilings = latestOwnershipFilings(recentFilings);
    let latest = null;
    let prior = null;
    let totalValue = 0;
    let managerSignals = [];
    if (filings.length) {
      latest = await enrichFiling(manager.cik, filings[0]);
      prior = filings[1] ? await enrichFiling(manager.cik, filings[1]) : null;
      const latestHoldings = parseHoldings(latest.xml);
      const priorHoldings = prior?.xml ? parseHoldings(prior.xml) : [];
      const latestMatches = matchHoldings(latestHoldings);
      const priorMatches = matchHoldings(priorHoldings);
      totalValue = latestHoldings.reduce((sum, row) => sum + row.valueUsd, 0);
      const priorBySymbol = groupMatched(priorMatches);
      const latestBySymbol = groupMatched(latestMatches);
      managerSignals = Object.values(latestBySymbol).map((entry) => {
        const priorEntry = priorBySymbol[entry.symbol];
        return build13FSignal(manager, latest, prior, entry, priorEntry, totalValue);
      });
    }
    const ownershipSignals = await ownershipSignalsForManager(manager, ownershipFilings);
    snapshot.managers.push({
      id: manager.id,
      name: manager.name,
      cik: manager.cik,
      type: manager.type,
      trackRecordScore: manager.trackRecordScore,
      trackRecordRationale: manager.trackRecordRationale,
      latestReportDate: latest?.reportDate || null,
      latestFilingDate: latest?.filingDate || null,
      latestAccession: latest?.accessionNumber || null,
      latestFilingUrl: latest?.indexUrl || null,
      priorReportDate: prior?.reportDate || null,
      aiMatchedValueUsd: managerSignals.reduce((sum, signal) => sum + signal.valueUsd, 0),
      total13fValueUsd: totalValue,
      matchedAiNames: managerSignals.length,
      recentOwnershipFilings: ownershipFilings.length,
      matchedOwnershipSignals: ownershipSignals.length
    });
    snapshot.signals.push(...managerSignals, ...ownershipSignals);
  } catch (error) {
    snapshot.managers.push({
      id: manager.id,
      name: manager.name,
      cik: manager.cik,
      type: manager.type,
      trackRecordScore: manager.trackRecordScore,
      trackRecordRationale: manager.trackRecordRationale,
      error: error.message
    });
  }
  await delay(140);
}

snapshot.signals = snapshot.signals
  .filter((signal) => universeSymbols.has(signal.symbol))
  .sort((a, b) => b.signalScore - a.signalScore)
  .slice(0, 160);
snapshot.summaryBySymbol = summarizeSignals(snapshot.signals);

writeFileSync("data/early_movers_snapshot.json", `${JSON.stringify(snapshot, null, 2)}\n`);

async function recentFilingsForManager(cik) {
  const data = await fetchJson(`${dataBase}/submissions/CIK${cik}.json`);
  const recent = data.filings?.recent;
  if (!recent) throw new Error("No recent filings in SEC submissions JSON");
  return recent.form.map((form, index) => ({
    form,
    accessionNumber: recent.accessionNumber[index],
    filingDate: recent.filingDate[index],
    reportDate: recent.reportDate[index],
    primaryDocument: recent.primaryDocument[index]
  }));
}

function latest13FFilings(rows) {
  const filings = rows
    .filter((row) => row.form === "13F-HR" || row.form === "13F-HR/A")
    .sort((a, b) => String(b.reportDate || b.filingDate).localeCompare(String(a.reportDate || a.filingDate)));
  return filings;
}

function latestOwnershipFilings(rows) {
  const ownershipForms = new Set([
    "SC 13D",
    "SC 13D/A",
    "SC 13G",
    "SC 13G/A",
    "SCHEDULE 13D",
    "SCHEDULE 13D/A",
    "SCHEDULE 13G",
    "SCHEDULE 13G/A"
  ]);
  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 3);
  return rows
    .filter((row) => ownershipForms.has(row.form))
    .filter((row) => !row.filingDate || new Date(row.filingDate) >= minDate)
    .sort((a, b) => String(b.filingDate || b.reportDate).localeCompare(String(a.filingDate || a.reportDate)))
    .slice(0, 18);
}

async function enrichFiling(cik, filing) {
  if (!filing) return null;
  const cikNum = String(Number(cik));
  const accessionCompact = filing.accessionNumber.replaceAll("-", "");
  const archiveBase = `${secBase}/Archives/edgar/data/${cikNum}/${accessionCompact}`;
  const indexUrl = `${archiveBase}/${filing.accessionNumber}-index.html`;
  const indexJson = await fetchJson(`${archiveBase}/index.json`);
  const xmlCandidates = (indexJson.directory?.item || [])
    .map((item) => item.name)
    .filter((name) => name.toLowerCase().endsWith(".xml") && !name.toLowerCase().includes("primary"));
  const preferred = xmlCandidates.find((name) => /info|13f|form/i.test(name)) || xmlCandidates[0];
  if (!preferred) throw new Error(`No information table XML found for ${filing.accessionNumber}`);
  const xmlUrl = `${archiveBase}/${preferred}`;
  return {
    ...filing,
    indexUrl,
    xmlUrl,
    xml: await fetchText(xmlUrl)
  };
}

function parseHoldings(xml) {
  const rows = [];
  const rowPattern = /<(?:[\w-]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?infoTable>/gi;
  let match;
  while ((match = rowPattern.exec(xml))) {
    const body = match[1];
    rows.push({
      issuer: cleanXml(tag(body, "nameOfIssuer")),
      title: cleanXml(tag(body, "titleOfClass")),
      cusip: cleanXml(tag(body, "cusip")).toUpperCase(),
      valueUsd: numberValue(tag(body, "value")),
      shares: numberValue(tag(body, "sshPrnamt")),
      putCall: cleanXml(tag(body, "putCall")).toUpperCase() || null
    });
  }
  return rows;
}

function tag(body, name) {
  const match = body.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "i"));
  return match ? match[1] : "";
}

function cleanXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value) {
  const parsed = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function ownershipSignalsForManager(manager, filings) {
  const signals = [];
  for (const filing of filings) {
    try {
      const enriched = await enrichOwnershipFiling(manager.cik, filing);
      const match = matchOwnershipFiling(enriched.text);
      if (!match) continue;
      signals.push(buildOwnershipSignal(manager, enriched, match));
    } catch (error) {
      signals.push({
        filingType: filing.form,
        sourceType: "13D/G",
        managerId: manager.id,
        managerName: manager.name,
        managerType: manager.type,
        managerTrackRecordScore: manager.trackRecordScore,
        symbol: "UNMATCHED",
        securityName: "Unmatched Schedule 13D/G filing",
        latestReportDate: filing.reportDate || filing.filingDate,
        latestFilingDate: filing.filingDate,
        stance: "unmatched",
        unusuallyBullish: false,
        signalScore: 0,
        confidence: 20,
        rationale: `Could not parse or match ${filing.form} ${filing.accessionNumber}: ${error.message}`,
        sourceUrl: archiveIndexUrl(manager.cik, filing)
      });
    }
    await delay(90);
  }
  return signals.filter((signal) => signal.symbol !== "UNMATCHED");
}

async function enrichOwnershipFiling(cik, filing) {
  const cikNum = String(Number(cik));
  const accessionCompact = filing.accessionNumber.replaceAll("-", "");
  const archiveBase = `${secBase}/Archives/edgar/data/${cikNum}/${accessionCompact}`;
  const indexUrl = `${archiveBase}/${filing.accessionNumber}-index.html`;
  const textUrl = `${archiveBase}/${filing.accessionNumber}.txt`;
  return {
    ...filing,
    indexUrl,
    textUrl,
    text: await fetchText(textUrl)
  };
}

function archiveIndexUrl(cik, filing) {
  const cikNum = String(Number(cik));
  const accessionCompact = filing.accessionNumber.replaceAll("-", "");
  return `${secBase}/Archives/edgar/data/${cikNum}/${accessionCompact}/${filing.accessionNumber}-index.html`;
}

function matchOwnershipFiling(text) {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const upper = text.toUpperCase();
  const subjectName = parseSubjectCompany(text);
  const security = securities.find((item) => {
    const cusipMatch = item.cusips.some((cusip) => compact.includes(cusip.toUpperCase().replace(/[^A-Z0-9]/g, "")));
    const aliasMatch = item.aliases.some((alias) => upper.includes(alias));
    const subjectMatch = subjectName && item.aliases.some((alias) => subjectName.includes(alias));
    return cusipMatch || aliasMatch || subjectMatch;
  });
  if (!security) return null;
  const ownershipPct = parseOwnershipPercent(text);
  const shares = parseBeneficialShares(text);
  const matchedCusip = security.cusips.find((cusip) => compact.includes(cusip.toUpperCase().replace(/[^A-Z0-9]/g, ""))) || null;
  return {
    symbol: security.symbol,
    securityName: security.name,
    subjectName: subjectName || security.name.toUpperCase(),
    ownershipPct,
    shares,
    matchQuality: matchedCusip ? "cusip" : subjectName ? "subject-company" : "issuer-name"
  };
}

function parseSubjectCompany(text) {
  const match = text.match(/SUBJECT COMPANY:[\s\S]{0,1500}?COMPANY CONFORMED NAME:\s*([^\n\r]+)/i);
  return match ? match[1].replace(/\s+/g, " ").trim().toUpperCase() : "";
}

function parseOwnershipPercent(text) {
  const patterns = [
    /<classPercent>\s*(\d{1,2}(?:\.\d+)?)\s*<\/classPercent>/i,
    /PERCENT OF CLASS[^\d%]{0,300}(\d{1,2}(?:\.\d+)?)\s*%/i,
    /percent of the class[^\d%]{0,300}(\d{1,2}(?:\.\d+)?)\s*%/i,
    /(\d{1,2}(?:\.\d+)?)\s*%\s+of\s+(?:the\s+)?(?:class|outstanding|shares)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value <= 100) return value;
  }
  return null;
}

function parseBeneficialShares(text) {
  const patterns = [
    /<reportingPersonBeneficiallyOwnedAggregateNumberOfShares>\s*([\d,.]+)\s*<\/reportingPersonBeneficiallyOwnedAggregateNumberOfShares>/i,
    /AGGREGATE AMOUNT BENEFICIALLY OWNED[^\d]{0,350}([\d,]+)/i,
    /beneficially owned[^\d]{0,200}([\d,]+)\s+(?:shares|ordinary shares|common shares)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = numberValue(match[1]);
    if (value > 0) return value;
  }
  return null;
}

function matchHoldings(holdings) {
  const matches = [];
  holdings.forEach((holding) => {
    const security = securities.find((item) => {
      const cusipMatch = item.cusips.includes(holding.cusip);
      const issuer = holding.issuer.toUpperCase();
      const aliasMatch = item.aliases.some((alias) => issuer.includes(alias));
      return cusipMatch || aliasMatch;
    });
    if (!security) return;
    matches.push({
      ...holding,
      symbol: security.symbol,
      securityName: security.name,
      matchQuality: security.cusips.includes(holding.cusip) ? "cusip" : "issuer-name"
    });
  });
  return matches;
}

function groupMatched(rows) {
  return rows.reduce((memo, row) => {
    if (!memo[row.symbol]) {
      memo[row.symbol] = {
        symbol: row.symbol,
        securityName: row.securityName,
        valueUsd: 0,
        shares: 0,
        holdings: [],
        matchQuality: row.matchQuality
      };
    }
    memo[row.symbol].valueUsd += row.valueUsd;
    memo[row.symbol].shares += row.shares;
    memo[row.symbol].holdings.push(row);
    if (row.matchQuality === "cusip") memo[row.symbol].matchQuality = "cusip";
    return memo;
  }, {});
}

function build13FSignal(manager, latest, prior, entry, priorEntry, totalValue) {
  const priorValue = priorEntry?.valueUsd || 0;
  const deltaValue = entry.valueUsd - priorValue;
  const deltaPct = priorValue > 0 ? deltaValue / priorValue : null;
  const portfolioPct = totalValue > 0 ? entry.valueUsd / totalValue : 0;
  const hasCall = entry.holdings.some((holding) => holding.putCall === "CALL");
  const hasPut = entry.holdings.some((holding) => holding.putCall === "PUT");
  const commonOnly = !hasCall && !hasPut;
  const newPosition = priorValue <= 0 && entry.valueUsd > 0;
  const increased = deltaValue > Math.max(5_000_000, priorValue * 0.2);
  const concentrated = portfolioPct >= 0.04;
  const signalScore = clamp(
    manager.trackRecordScore * 10 +
    (newPosition ? 25 : 0) +
    (increased ? 20 : 0) +
    (deltaPct !== null && deltaPct > 1 ? 12 : deltaPct !== null && deltaPct > 0.4 ? 7 : 0) +
    (concentrated ? 16 : portfolioPct >= 0.02 ? 9 : portfolioPct >= 0.01 ? 5 : 0) +
    (hasCall ? 10 : 0) -
    (hasPut && !hasCall ? 20 : 0),
    0,
    100
  );
  const confidence = clamp(
    42 +
    (entry.matchQuality === "cusip" ? 18 : 8) +
    (prior ? 10 : 0) +
    manager.trackRecordScore * 4 +
    (entry.valueUsd >= 100_000_000 ? 8 : entry.valueUsd >= 25_000_000 ? 5 : 0) -
    (hasPut && !hasCall ? 10 : 0),
    25,
    88
  );
  const stance = hasPut && !hasCall ? "hedge-or-bearish" : signalScore >= 72 ? "unusually bullish" : increased || newPosition ? "constructive" : "watch";
  return {
    filingType: latest.form,
    sourceType: "13F",
    timeSensitivity: "quarterly-lagged",
    managerId: manager.id,
    managerName: manager.name,
    managerType: manager.type,
    managerTrackRecordScore: manager.trackRecordScore,
    trackRecordRationale: manager.trackRecordRationale,
    symbol: entry.symbol,
    securityName: entry.securityName,
    latestReportDate: latest.reportDate,
    latestFilingDate: latest.filingDate,
    priorReportDate: prior?.reportDate || null,
    valueUsd: Math.round(entry.valueUsd),
    priorValueUsd: Math.round(priorValue),
    deltaValueUsd: Math.round(deltaValue),
    deltaPct: deltaPct === null ? null : round(deltaPct, 3),
    portfolioPct: round(portfolioPct, 4),
    shares: Math.round(entry.shares),
    newPosition,
    increased,
    concentrated,
    hasCall,
    hasPut,
    commonOnly,
    stance,
    unusuallyBullish: stance === "unusually bullish",
    signalScore: Math.round(signalScore),
    confidence: Math.round(confidence),
    matchQuality: entry.matchQuality,
    rationale: rationale({ manager, entry, priorValue, deltaValue, deltaPct, portfolioPct, newPosition, increased, concentrated, hasCall, hasPut }),
    sourceUrl: latest.indexUrl,
    informationTableUrl: latest.xmlUrl
  };
}

function buildOwnershipSignal(manager, filing, match) {
  const is13D = filing.form.includes("13D");
  const isAmendment = filing.form.endsWith("/A");
  const filingDate = new Date(filing.filingDate || filing.reportDate || Date.now());
  const ageDays = Math.max(0, Math.round((Date.now() - filingDate.getTime()) / 86400000));
  const freshBoost = ageDays <= 30 ? 18 : ageDays <= 90 ? 12 : ageDays <= 180 ? 7 : 3;
  const ownershipBoost = match.ownershipPct === null ? 3 : match.ownershipPct >= 10 ? 18 : match.ownershipPct >= 7.5 ? 13 : match.ownershipPct >= 5 ? 9 : 4;
  const signalScore = clamp(
    manager.trackRecordScore * 10 +
    (is13D ? 30 : 18) +
    (isAmendment ? 7 : 12) +
    ownershipBoost +
    freshBoost,
    0,
    100
  );
  const confidence = clamp(
    50 +
    (match.matchQuality === "cusip" ? 20 : match.matchQuality === "subject-company" ? 12 : 8) +
    (match.ownershipPct !== null ? 10 : 0) +
    manager.trackRecordScore * 3 +
    (ageDays <= 180 ? 5 : 0),
    35,
    92
  );
  const stance = is13D
    ? "fresh 13D ownership event"
    : signalScore >= 75
      ? "unusually bullish 13G disclosure"
      : "13G ownership disclosure";
  const rationaleParts = [
    `${manager.name} filed ${filing.form}${is13D ? ", which is more event-sensitive than a quarterly 13F." : ", a beneficial ownership disclosure that is generally more timely than a 13F."}`,
    `${match.symbol} matched by ${match.matchQuality}.`,
    match.ownershipPct !== null ? `Parsed ownership is approximately ${match.ownershipPct}%.` : "Ownership percentage was not parsed reliably from the filing text.",
    `${manager.name} has a ${manager.trackRecordScore}/5 curated early-mover prior.`
  ];
  return {
    filingType: filing.form,
    sourceType: "13D/G",
    timeSensitivity: "ownership-event",
    managerId: manager.id,
    managerName: manager.name,
    managerType: manager.type,
    managerTrackRecordScore: manager.trackRecordScore,
    trackRecordRationale: manager.trackRecordRationale,
    symbol: match.symbol,
    securityName: match.securityName,
    subjectName: match.subjectName,
    latestReportDate: filing.reportDate || filing.filingDate,
    latestFilingDate: filing.filingDate,
    priorReportDate: null,
    valueUsd: 0,
    priorValueUsd: 0,
    deltaValueUsd: 0,
    deltaPct: null,
    portfolioPct: 0,
    shares: match.shares,
    ownershipPct: match.ownershipPct,
    newPosition: !isAmendment,
    increased: false,
    concentrated: match.ownershipPct !== null && match.ownershipPct >= 5,
    hasCall: false,
    hasPut: false,
    commonOnly: true,
    stance,
    unusuallyBullish: signalScore >= 75,
    signalScore: Math.round(signalScore),
    confidence: Math.round(confidence),
    matchQuality: match.matchQuality,
    rationale: rationaleParts.join(" "),
    sourceUrl: filing.indexUrl,
    informationTableUrl: filing.textUrl
  };
}

function rationale({ manager, entry, priorValue, deltaValue, deltaPct, portfolioPct, newPosition, increased, concentrated, hasCall, hasPut }) {
  const parts = [`${manager.name} has a ${manager.trackRecordScore}/5 curated early-mover prior.`];
  if (newPosition) parts.push(`Latest 13F shows a new ${entry.symbol} position versus no matched prior-quarter holding.`);
  else if (increased) parts.push(`Position increased by ${formatMoney(deltaValue)}${deltaPct !== null ? ` (${Math.round(deltaPct * 100)}%)` : ""} versus the prior matched 13F.`);
  else parts.push(`Position persisted versus a prior matched value of ${formatMoney(priorValue)}.`);
  if (concentrated) parts.push(`${entry.symbol} is a concentrated matched 13F position at ${Math.round(portfolioPct * 1000) / 10}% of reported 13F value.`);
  if (hasCall) parts.push("Information table includes reported call exposure.");
  if (hasPut && !hasCall) parts.push("Information table includes put exposure, so this is not treated as bullish.");
  return parts.join(" ");
}

function summarizeSignals(signals) {
  const grouped = signals.reduce((memo, signal) => {
    if (!memo[signal.symbol]) {
      memo[signal.symbol] = {
        symbol: signal.symbol,
        securityName: signal.securityName,
        signalCount: 0,
        managerCount: 0,
        unusuallyBullishManagers: 0,
        highConfidenceSignals: 0,
        totalValueUsd: 0,
        totalDeltaUsd: 0,
        maxSignalScore: 0,
        weightedScore: 0,
        thirteenFSignals: 0,
        ownershipEvents: 0,
        latestReportDate: signal.latestReportDate,
        managerNames: []
      };
    }
    const row = memo[signal.symbol];
    row.signalCount += 1;
    row.unusuallyBullishManagers += signal.unusuallyBullish ? 1 : 0;
    row.highConfidenceSignals += signal.confidence >= 75 ? 1 : 0;
    row.totalValueUsd += signal.valueUsd;
    row.totalDeltaUsd += signal.deltaValueUsd;
    row.maxSignalScore = Math.max(row.maxSignalScore, signal.signalScore);
    row.weightedScore += signal.signalScore * (signal.confidence / 100) * (0.75 + signal.managerTrackRecordScore / 8);
    row.thirteenFSignals += signal.sourceType === "13F" ? 1 : 0;
    row.ownershipEvents += signal.sourceType === "13D/G" ? 1 : 0;
    row.latestReportDate = String(signal.latestReportDate).localeCompare(String(row.latestReportDate)) > 0 ? signal.latestReportDate : row.latestReportDate;
    row.managerNames.push(signal.managerName);
    return memo;
  }, {});
  return Object.values(grouped)
    .map((row) => ({
      ...row,
      managerCount: new Set(row.managerNames).size,
      totalValueUsd: Math.round(row.totalValueUsd),
      totalDeltaUsd: Math.round(row.totalDeltaUsd),
      weightedScore: Math.round(row.weightedScore),
      managerNames: [...new Set(row.managerNames)].slice(0, 8),
      rationale: `${row.signalCount} tracked signal(s) across ${new Set(row.managerNames).size} manager(s), ${row.unusuallyBullishManagers} unusually bullish, ${row.highConfidenceSignals} high-confidence. Includes ${row.thirteenFSignals} 13F signal(s) and ${row.ownershipEvents} 13D/G event(s). Aggregate matched 13F value ${formatMoney(row.totalValueUsd)}; reported 13F value change ${formatMoney(row.totalDeltaUsd)}.`
    }))
    .sort((a, b) => b.weightedScore - a.weightedScore);
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent, "Accept-Encoding": "gzip, deflate", Host: new URL(url).host } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatMoney(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
