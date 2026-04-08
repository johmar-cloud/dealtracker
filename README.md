# FlowValue DealsTracker

IPO pipeline and funding rounds tracker (>$100M) for Darrow Capital / Flow Value Investing.

## Data Sources

| Table | Primary | Secondary |
|---|---|---|
| IPO Pipeline | Finnhub IPO Calendar | SEC EDGAR S-1 filings |
| Funding Rounds | SEC EDGAR Form D (XML parsed) | Finnhub market news |

Secondary market valuations (Forge / NASDAQ Private Market) require a paid API key and are noted as unavailable in the UI.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/flowvalue-dealstracker.git
cd flowvalue-dealstracker
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
FINNHUB_API_KEY=your_key_here
```

Get a free Finnhub key at [finnhub.io](https://finnhub.io). The free tier covers IPO calendar and general news.

### 3. Local development

```bash
npm run dev
```

The Vite dev server proxies `/api/*` to `localhost:3001`. To run the API locally:

```bash
npm install -g vercel
vercel dev
```

This starts both the frontend (port 3000) and serverless functions.

### 4. Deploy to Vercel

```bash
vercel
```

Set `FINNHUB_API_KEY` in your Vercel project environment variables (Project Settings > Environment Variables).

## Adding Crunchbase

For richer product descriptions and investor data on funding rounds, add to `.env.local`:

```
CRUNCHBASE_API_KEY=your_key_here
```

Then extend `api/funding.js` to call:
```
https://api.crunchbase.com/api/v4/entities/organizations/{permalink}?field_ids=short_description,categories,funding_rounds
```

The Crunchbase Starter plan ($29/mo) provides deal-level data.

## Architecture

```
Finnhub IPO Calendar ─────────┐
SEC EDGAR S-1 index    ───────┤──► /api/ipo      ──► IPO Table
                               │
SEC EDGAR Form D + XML ────────┤
Finnhub general news   ───────┤──► /api/funding  ──► Funding Table
                               │
Vercel CDN cache (1hr) ────────┘
```

All API calls happen server-side (Vercel serverless functions). The frontend receives clean JSON only. Claude / LLM is not invoked at data-fetch time — add it at drill-down level if needed.
