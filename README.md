# AI Boom Bottleneck Investment Lab

Standalone local prototype for evaluating public-market AI infrastructure bottleneck opportunities. This project is intentionally separate from Headwater OS.

## Run

```bash
cd /Users/mattmiller/Downloads/ai-boom-investment-lab
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173`.

## Share and collaborate

Use **Copy collaboration link** inside the app to share the current scenario, selected ticker, and Idea Board notes. Friends can open the link on desktop or mobile, change assumptions, add their own trade ideas, then send back a new collaboration link or exported JSON.

This is asynchronous collaboration. There is no account system, central database, broker connection, or live multi-user state in this static version.

## Contents

- `index.html` - static app shell
- `assets/app.js` - optimizer, charts, tabs, scenario import/export
- `assets/styles.css` - responsive dashboard styling
- `data/research_snapshot.json` - source-labeled research snapshot
- `sources/ai-investment-landscape-bottleneck-plays.pdf` - source PDF copy
- `reports/ui-concept.png` - generated UI concept reference
- `tests/browser_smoke.mjs` - dependency-free Chrome smoke test via DevTools protocol

## Notes

This is a decision-support prototype only. It uses proxy prices and proxy option economics where live market data is not connected. Refresh quotes, option chains, filings, and source evidence before trading real capital.
