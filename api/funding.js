// api/funding.js
// Changes v3:
//  1. EDGAR hit limit reduced to 15 + hard 8s timeout guard per request
//  2. Haiku enrichment for industry + product description
//  3. Secondary market: Yahoo Finance .PVT scrape → Last Round label fallback
//  4. EDGAR XML structure: index-first with multiple fallbacks + better logging

const MIN_AMOUNT = 100_000_000

// ─── Known private companies with Yahoo Finance .PVT tickers ─────────────────
// Matched case-insensitively against company name from Form D / news
const PVT_TICKERS = {
  'openai':       'OPAI.PVT',
  'stripe':       'STRIPE.PVT',
  'spacex':       'SPACEX.PVT',
  'databricks':   'DBRK.PVT',
  'canva':        'CANVA.PVT',
  'klarna':       'KLAR.PVT',
  'chime':        'CHIM.PVT',
  'discord':      'DSCRD.PVT',
  'figma':        'FIGM.PVT',
  'epic games':   'EPIC.PVT',
  'anduril':      'ANDR.PVT',
  'plaid':        'PLAI.PVT',
  'brex':         'BREX.PVT',
  'ripple':       'XRP.PVT',
  'revolut':      'REV.PVT',
  'cerebras':     'CBRS.PVT',
  'anthropic':    'ANTH.PVT',
  'scale ai':     'SCLE.PVT',
  'cohere':       'COHR.PVT',
  'mistral':      'MIST.PVT',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INDUSTRY_MAP = {
  'Agriculture': 'Agriculture', 'Banking': 'Financial Services',
  'Business Services': 'Business Services', 'Coal Mining': 'Energy & Mining',
  'Commercial Banking': 'Financial Services', 'Communications': 'Technology & Telecom',
  'Computers': 'Technology', 'Construction': 'Real Estate & Construction',
  'Electric Utilities': 'Utilities', 'Electronic & Electrical Equipment': 'Technology',
  'Finance': 'Financial Services', 'Health Care': 'Healthcare',
  'Health Insurance': 'Healthcare', 'Hotels and Motels': 'Consumer & Hospitality',
  'Insurance': 'Financial Services', 'Investment Funds': 'Asset Management',
  'Investments': 'Asset Management', 'Manufacturing': 'Industrials',
  'Oil and Gas': 'Energy', 'Pharmaceuticals': 'Healthcare & Pharma',
  'Real Estate': 'Real Estate', 'Restaurants': 'Consumer & Hospitality',
  'Retail': 'Consumer Retail', 'Software': 'Technology', 'Technology': 'Technology',
  'Transportation': 'Transportation', 'Other': 'Diversified',
  'Pooled Investment Fund': 'Asset Management',
}

function isoDate(d) { return d.toISOString().split('T')[0] }
function shiftDate(base, days) {
  const d = new Date(base); d.setDate(d.getDate() - days); return isoDate(d)
}
function periodToDays(p) { return { '1w': 7, '1m': 30, '3m': 90, '6m': 180 }[p] ?? 30 }

function timeout(ms) { return AbortSignal.timeout(ms) }

// ─── 1. EDGAR Form D ──────────────────────────────────────────────────────────

async function parseFormDXml(cik, accWithDashes) {
  const accNoDashes = accWithDashes.replace(/-/g, '')
  const headers     = { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' }

  // Step 1: fetch filing index JSON to get actual XML filename
  let xmlFilename = null
  try {
    const idxUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/${accWithDashes}-index.json`
    const idxRes = await fetch(idxUrl, { headers, signal: timeout(5000) })
    if (idxRes.ok) {
      const idx = await idxRes.json()
      // Find the primary Form D XML document
      const xmlDoc = (idx.documents || []).find(d =>
        d.type === 'D' || d.type === 'D/A' ||
        (d.documentUrl || '').toLowerCase().endsWith('.xml')
      )
      if (xmlDoc?.documentUrl) {
        const parts = xmlDoc.documentUrl.split('/')
        xmlFilename = parts[parts.length - 1]
      }
    }
  } catch (e) {
    console.warn(`[funding] index fetch failed for ${cik}/${accWithDashes}: ${e.message}`)
  }

  // Step 2: try filenames in order of likelihood
  const candidates = [
    xmlFilename,
    'primary_doc.xml',
    `${accNoDashes}.xml`,
  ].filter(Boolean)

  let xml = null
  for (const fname of candidates) {
    try {
      const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/${fname}`
      const xmlRes = await fetch(xmlUrl, { headers, signal: timeout(6000) })
      if (xmlRes.ok) {
        xml = await xmlRes.text()
        break
      }
    } catch { /* try next */ }
  }

  if (!xml) {
    console.warn(`[funding] no XML found for CIK ${cik} / ${accWithDashes}`)
    return null
  }

  // Step 3: parse offering amount
  const amtMatch = xml.match(/<totalOfferingAmount>([\d.]+)<\/totalOfferingAmount>/i)
  if (!amtMatch) {
    // Some Form D filings declare "Indefinite"
    console.warn(`[funding] no totalOfferingAmount in XML for ${accWithDashes}`)
    return null
  }
  const amount = parseFloat(amtMatch[1])
  if (isNaN(amount) || amount < MIN_AMOUNT) return null

  const soldMatch  = xml.match(/<totalAmountSold>([\d.]+)<\/totalAmountSold>/i)
  const nameMatch  = xml.match(/<issuerName>(.*?)<\/issuerName>/i)
  const indMatch   = xml.match(/<industryGroupType>(.*?)<\/industryGroupType>/i)
  const stateMatch = xml.match(/<issuerStateOrCountry>(.*?)<\/issuerStateOrCountry>/i)

  return {
    amount,
    amountSold:  soldMatch ? parseFloat(soldMatch[1]) : null,
    issuerName:  nameMatch  ? nameMatch[1].trim()  : null,
    industry:    INDUSTRY_MAP[indMatch?.[1]?.trim()] ?? (indMatch?.[1]?.trim() || '—'),
    country:     stateMatch ? stateMatch[1].trim() : null,
  }
}

async function fetchEdgarFormD(days) {
  const today = new Date()
  const from  = shiftDate(today, days)

  const searchRes = await fetch(
    `https://efts.sec.gov/LATEST/search-index?forms=D` +
    `&dateRange=custom&startdt=${from}&enddt=${isoDate(today)}`,
    {
      headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' },
      signal: timeout(8000), // hard 8s guard on the search itself
    }
  )
  if (!searchRes.ok) {
    console.error(`[funding] EDGAR search failed: ${searchRes.status}`)
    return []
  }

  const searchData = await searchRes.json()
  // ← CHANGE 1: reduced from 80 to 15, sorted by most recent
  const hits = (searchData.hits?.hits || []).slice(0, 15)
  console.log(`[funding] EDGAR returned ${searchData.hits?.total?.value} total, processing ${hits.length}`)

  const results = await Promise.allSettled(
    hits.map(async hit => {
      const src           = hit._source || {}
      const accWithDashes = hit._id || ''
      const cikPadded     = accWithDashes.split('-')[0] || ''
      const cik           = cikPadded.replace(/^0+/, '')

      if (!cik || !accWithDashes) return null

      const parsed = await parseFormDXml(cik, accWithDashes)
      if (!parsed) return null

      return {
        name:        parsed.issuerName || src.entity_name || 'Unknown',
        amount:      parsed.amount,
        amountSold:  parsed.amountSold,
        valuation:   null,
        secondaryVal: null,
        secondaryLabel: null,
        date:        src.file_date,
        industry:    parsed.industry,
        description: null, // filled by Haiku enrichment
        source:      'SEC Form D',
        country:     parsed.country,
      }
    })
  )

  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .sort((a, b) => b.amount - a.amount)
}

// ─── 2. Finnhub news ──────────────────────────────────────────────────────────

const FUNDING_KW = [
  'raises', 'raised', 'secures', 'series a', 'series b', 'series c',
  'series d', 'series e', 'funding round', 'growth equity', 'venture round',
]
const AMT_RE = /\$(\d+(?:\.\d+)?)\s*(billion|million|bn|m)\b/gi

function extractAmount(text) {
  let max = 0, m
  AMT_RE.lastIndex = 0
  while ((m = AMT_RE.exec(text)) !== null) {
    const v = parseFloat(m[1])
    const u = m[2].toLowerCase()
    const usd = (u === 'billion' || u === 'bn') ? v * 1e9 : v * 1e6
    if (usd > max) max = usd
  }
  return max
}

async function fetchFinnhubDeals(apiKey) {
  const r = await fetch(
    `https://finnhub.io/api/v1/news?category=general&token=${apiKey}`,
    { signal: timeout(6000) }
  )
  if (!r.ok) return []
  const articles = await r.json()
  const deals = []
  for (const a of articles || []) {
    const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase()
    if (!FUNDING_KW.some(kw => text.includes(kw))) continue
    const amount = extractAmount((a.headline || '') + ' ' + (a.summary || ''))
    if (amount < MIN_AMOUNT) continue
    const nameMatch = (a.headline || '').match(
      /^([A-Z][A-Za-z0-9&\s,.']+?)\s+(?:raises|raised|secures|closes)/i
    )
    deals.push({
      name:          nameMatch ? nameMatch[1].trim() : (a.related || 'Undisclosed'),
      amount,
      amountSold:    null,
      valuation:     null,
      secondaryVal:  null,
      secondaryLabel: null,
      date:          a.datetime ? new Date(a.datetime * 1000).toISOString().split('T')[0] : null,
      industry:      '—',
      description:   null,
      source:        'Finnhub News',
      url:           a.url,
    })
  }
  return deals.sort((a, b) => b.amount - a.amount)
}

// ─── 3. Haiku enrichment ──────────────────────────────────────────────────────

async function enrichWithHaiku(deals, anthropicKey) {
  if (!anthropicKey || deals.length === 0) return deals

  const names = deals.map(d => d.name).join('\n')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content:
            `For each company below, return a JSON array (no markdown, no preamble) ` +
            `with objects: { "name": string, "industry": string, "description": string }.\n` +
            `description: one sentence max, what the company does.\n` +
            `industry: one of: Technology, Healthcare, Fintech, Energy, Real Estate, ` +
            `Consumer, Industrials, Asset Management, Defence, Biotech, Diversified.\n` +
            `If unknown use null for both fields.\n\n${names}`,
        }],
      }),
      signal: timeout(10000),
    })

    if (!res.ok) return deals
    const data = await res.json()
    const raw  = data.content?.[0]?.text || '[]'

    let enriched
    try {
      enriched = JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch { return deals }

    const map = {}
    for (const e of enriched) {
      if (e?.name) map[e.name.toLowerCase().trim()] = e
    }

    return deals.map(d => {
      const match = map[d.name.toLowerCase().trim()]
      return {
        ...d,
        industry:    (match?.industry && d.industry === '—') ? match.industry : d.industry,
        description: match?.description || d.description,
      }
    })
  } catch (e) {
    console.warn('[funding] Haiku enrichment failed:', e.message)
    return deals
  }
}

// ─── 4. Secondary market valuation ───────────────────────────────────────────

// Resolve a Yahoo Finance .PVT ticker for a company name (if known)
function resolvePvtTicker(name) {
  const lower = name.toLowerCase()
  for (const [key, ticker] of Object.entries(PVT_TICKERS)) {
    if (lower.includes(key)) return ticker
  }
  return null
}

// Batch fetch Yahoo Finance quotes for .PVT tickers
async function fetchYahooPvtQuotes(tickers) {
  if (tickers.length === 0) return {}
  const symbols = tickers.join(',')
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,marketCap`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: timeout(6000),
      }
    )
    if (!r.ok) return {}
    const data = await r.json()
    const result = {}
    for (const q of data?.quoteResponse?.result || []) {
      result[q.symbol] = {
        price:     q.regularMarketPrice,
        marketCap: q.marketCap,
      }
    }
    return result
  } catch (e) {
    console.warn('[funding] Yahoo .PVT fetch failed:', e.message)
    return {}
  }
}

async function addSecondaryValuations(deals) {
  // Resolve tickers for known companies
  const tickerMap = {} // name → ticker
  for (const d of deals) {
    const ticker = resolvePvtTicker(d.name)
    if (ticker) tickerMap[d.name] = ticker
  }

  const uniqueTickers = [...new Set(Object.values(tickerMap))]
  const quotes = await fetchYahooPvtQuotes(uniqueTickers)

  return deals.map(d => {
    const ticker = tickerMap[d.name]

    // Tier 1: Yahoo .PVT quote available
    if (ticker && quotes[ticker]?.marketCap) {
      return {
        ...d,
        secondaryVal:   quotes[ticker].marketCap,
        secondaryLabel: 'Yahoo (Secondary)',
      }
    }

    // Tier 2: last primary round valuation from Form D amount (rough proxy)
    if (d.amount && d.amount >= MIN_AMOUNT) {
      return {
        ...d,
        secondaryVal:   null,
        secondaryLabel: 'Last Round',
        valuation:      d.amount, // use offering amount as last known round size
      }
    }

    return { ...d, secondaryLabel: '—' }
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { period = '1m' } = req.query
  const days = periodToDays(period)

  try {
    const FINNHUB_KEY   = process.env.FINNHUB_API_KEY
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

    const [edgarRes, finnRes] = await Promise.allSettled([
      fetchEdgarFormD(days),
      FINNHUB_KEY ? fetchFinnhubDeals(FINNHUB_KEY) : Promise.resolve([]),
    ])

    const edgarDeals = edgarRes.status === 'fulfilled' ? edgarRes.value : []
    const finnDeals  = finnRes.status  === 'fulfilled' ? finnRes.value  : []

    // Deduplicate by name
    const seen  = new Set(edgarDeals.map(d => d.name.toLowerCase().trim()))
    const extra = finnDeals.filter(d => !seen.has(d.name.toLowerCase().trim()))
    let deals   = [...edgarDeals, ...extra].sort((a, b) => b.amount - a.amount)

    // Haiku enrichment (industry + description)
    deals = await enrichWithHaiku(deals, ANTHROPIC_KEY)

    // Secondary market valuations
    deals = await addSecondaryValuations(deals)

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200')
    res.status(200).json({ deals, count: deals.length })
  } catch (err) {
    console.error('[api/funding]', err)
    res.status(500).json({ error: err.message, deals: [] })
  }
}
