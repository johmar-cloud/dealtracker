// api/funding.js
// SEC EDGAR Form D (XML parsed via filing index) + Finnhub news filtering
// Accepts: ?period=1w|1m|3m|6m
// Filters for rounds >= $100M
// Cache: 1hr Vercel CDN

const MIN_AMOUNT = 100_000_000

// EDGAR Form D industry group codes → readable labels
const INDUSTRY_MAP = {
  'Agriculture': 'Agriculture',
  'Banking': 'Financial Services',
  'Business Services': 'Business Services',
  'Coal Mining': 'Energy & Mining',
  'Commercial Banking': 'Financial Services',
  'Communications': 'Technology & Telecom',
  'Computers': 'Technology',
  'Construction': 'Real Estate & Construction',
  'Electric Utilities': 'Utilities',
  'Electronic & Electrical Equipment': 'Technology',
  'Finance': 'Financial Services',
  'Health Care': 'Healthcare',
  'Health Insurance': 'Healthcare',
  'Hotels and Motels': 'Consumer & Hospitality',
  'Insurance': 'Financial Services',
  'Investment Funds': 'Asset Management',
  'Investments': 'Asset Management',
  'Manufacturing': 'Industrials',
  'Oil and Gas': 'Energy',
  'Pharmaceuticals': 'Healthcare & Pharma',
  'Real Estate': 'Real Estate',
  'Restaurants': 'Consumer & Hospitality',
  'Retail': 'Consumer Retail',
  'Software': 'Technology',
  'Technology': 'Technology',
  'Transportation': 'Transportation',
  'Other': 'Diversified',
  'Pooled Investment Fund': 'Asset Management',
}

function isoDate(d) { return d.toISOString().split('T')[0] }

function shiftDate(base, days) {
  const d = new Date(base)
  d.setDate(d.getDate() - days)
  return isoDate(d)
}

function periodToDays(period) {
  return { '1w': 7, '1m': 30, '3m': 90, '6m': 180 }[period] ?? 30
}

// ─── EDGAR Form D ─────────────────────────────────────────────────────────────

async function parseFormDXml(cik, accWithDashes) {
  // Step 1: fetch the filing index to find the actual XML document name
  const accNoDashes = accWithDashes.replace(/-/g, '')
  const indexUrl =
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/${accWithDashes}-index.json`

  let xmlFilename = 'primary_doc.xml' // fallback

  try {
    const idxRes = await fetch(indexUrl, {
      headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' },
      signal: AbortSignal.timeout(4000)
    })
    if (idxRes.ok) {
      const idx = await idxRes.json()
      const xmlDoc = (idx.documents || []).find(
        d => d.type === 'D' || d.documentUrl?.endsWith('.xml')
      )
      if (xmlDoc?.documentUrl) {
        const parts = xmlDoc.documentUrl.split('/')
        xmlFilename = parts[parts.length - 1]
      }
    }
  } catch { /* use fallback */ }

  // Step 2: fetch and parse the XML
  const xmlUrl =
    `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDashes}/${xmlFilename}`

  const xmlRes = await fetch(xmlUrl, {
    headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' },
    signal: AbortSignal.timeout(5000)
  })
  if (!xmlRes.ok) return null
  const xml = await xmlRes.text()

  // Parse totalOfferingAmount — Form D XML tag
  const amtMatch = xml.match(/<totalOfferingAmount>([\d.]+)<\/totalOfferingAmount>/i)
  if (!amtMatch) return null
  const amount = parseFloat(amtMatch[1])
  if (isNaN(amount) || amount < MIN_AMOUNT) return null

  // Parse industry group type
  const indMatch = xml.match(/<industryGroupType>(.*?)<\/industryGroupType>/i)
  const rawIndustry = indMatch ? indMatch[1].trim() : 'Other'

  // Parse issuer name from XML (more reliable than search index)
  const nameMatch = xml.match(/<issuerName>(.*?)<\/issuerName>/i)
  const issuerName = nameMatch ? nameMatch[1].trim() : null

  // Parse total amount sold (actual raised vs offered)
  const soldMatch = xml.match(/<totalAmountSold>([\d.]+)<\/totalAmountSold>/i)
  const amountSold = soldMatch ? parseFloat(soldMatch[1]) : amount

  return {
    amount,
    amountSold,
    industry: INDUSTRY_MAP[rawIndustry] ?? rawIndustry,
    issuerName,
  }
}

async function fetchEdgarFormD(days) {
  const today = new Date()
  const from  = shiftDate(today, days)

  const searchRes = await fetch(
    `https://efts.sec.gov/LATEST/search-index?forms=D` +
    `&dateRange=custom&startdt=${from}&enddt=${isoDate(today)}`,
    { headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' } }
  )
  if (!searchRes.ok) return []

  const searchData = await searchRes.json()
  const hits = (searchData.hits?.hits || []).slice(0, 80)

  const results = await Promise.allSettled(
    hits.map(async hit => {
      const src          = hit._source || {}
      const accWithDashes = hit._id || ''                       // e.g. "0001234567-24-000001"
      const cikPadded    = accWithDashes.split('-')[0] || ''    // e.g. "0001234567"
      const cik          = cikPadded.replace(/^0+/, '')         // e.g. "1234567"

      if (!cik || !accWithDashes) return null

      const parsed = await parseFormDXml(cik, accWithDashes)
      if (!parsed) return null

      return {
        name:        parsed.issuerName || src.entity_name || 'Unknown',
        amount:      parsed.amount,
        amountSold:  parsed.amountSold,
        valuation:   null,
        date:        src.file_date,
        industry:    parsed.industry,
        description: 'Private Placement (Reg D)',
        source:      'SEC Form D',
      }
    })
  )

  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
    .sort((a, b) => b.amount - a.amount)
}

// ─── Finnhub news ─────────────────────────────────────────────────────────────

const FUNDING_KEYWORDS = [
  'raises', 'raised', 'secures', 'series a', 'series b', 'series c',
  'series d', 'series e', 'funding round', 'growth equity', 'venture round',
]

const AMT_RE = /\$(\d+(?:\.\d+)?)\s*(billion|million|bn|m)\b/gi

function extractAmount(text) {
  let max = 0
  let m
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
    `https://finnhub.io/api/v1/news?category=general&token=${apiKey}`
  )
  if (!r.ok) return []
  const articles = await r.json()

  const deals = []
  for (const a of articles || []) {
    const text = ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase()
    if (!FUNDING_KEYWORDS.some(kw => text.includes(kw))) continue

    const amount = extractAmount((a.headline || '') + ' ' + (a.summary || ''))
    if (amount < MIN_AMOUNT) continue

    const nameMatch = (a.headline || '').match(
      /^([A-Z][A-Za-z0-9&\s,.']+?)\s+(?:raises|raised|secures|closes)/i
    )

    deals.push({
      name:        nameMatch ? nameMatch[1].trim() : (a.related || 'Undisclosed'),
      amount,
      amountSold:  amount,
      valuation:   null,
      date:        a.datetime ? new Date(a.datetime * 1000).toISOString().split('T')[0] : null,
      industry:    '—',
      description: (a.headline || '').slice(0, 90),
      source:      'Finnhub News',
      url:         a.url,
    })
  }

  return deals.sort((a, b) => b.amount - a.amount)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const { period = '1m' } = req.query
  const days = periodToDays(period)

  try {
    const KEY = process.env.FINNHUB_API_KEY

    const [edgarRes, finnRes] = await Promise.allSettled([
      fetchEdgarFormD(days),
      KEY ? fetchFinnhubDeals(KEY) : Promise.resolve([]),
    ])

    const edgarDeals = edgarRes.status === 'fulfilled' ? edgarRes.value : []
    const finnDeals  = finnRes.status  === 'fulfilled' ? finnRes.value  : []

    const seen  = new Set(edgarDeals.map(d => d.name.toLowerCase().trim()))
    const extra = finnDeals.filter(d => !seen.has(d.name.toLowerCase().trim()))

    const deals = [...edgarDeals, ...extra].sort((a, b) => b.amount - a.amount)

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200')
    res.status(200).json({ deals, count: deals.length })
  } catch (err) {
    console.error('[api/funding]', err)
    res.status(500).json({ error: err.message, deals: [] })
  }
}
