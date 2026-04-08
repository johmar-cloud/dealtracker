// api/funding.js
// Blends SEC EDGAR Form D (parsed XML for amounts > $100M)
// with Finnhub news filtered for large funding announcements.
// Cache: 1 hour via Vercel CDN

const MIN_AMOUNT = 100_000_000 // $100M threshold

function subDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

// ─── EDGAR Form D ────────────────────────────────────────────────────────────
// Strategy:
//   1. Fetch recent Form D filing index from EDGAR EFTS
//   2. For each, fetch the primary XML document
//   3. Parse totalOfferingAmount from the XML
//   4. Return those > MIN_AMOUNT

async function fetchEdgarFormD() {
  const today = new Date()
  const from  = subDays(today, 90)

  const searchUrl =
    `https://efts.sec.gov/LATEST/search-index?forms=D&dateRange=custom&startdt=${from}` +
    `&enddt=${today.toISOString().split('T')[0]}&hits.hits._source=entity_name,file_date,accession_no,period_of_report`

  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' }
  })
  if (!searchRes.ok) return []
  const searchData = await searchRes.json()

  const hits = (searchData.hits?.hits || []).slice(0, 60) // limit to avoid excessive fetches

  // Fetch XML for each filing and parse offering amount
  const results = await Promise.allSettled(
    hits.map(async hit => {
      const src       = hit._source
      const accession = src.accession_no?.replace(/-/g, '')
      if (!accession) return null

      // Derive CIK from accession number (first 10 digits)
      const cik = accession.slice(0, 10).replace(/^0+/, '')
      const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/primary_doc.xml`

      const xmlRes = await fetch(xmlUrl, {
        headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' }
      })
      if (!xmlRes.ok) return null
      const xml = await xmlRes.text()

      // Parse totalOfferingAmount
      const amtMatch = xml.match(/<totalOfferingAmount>([\d.]+)<\/totalOfferingAmount>/i)
      if (!amtMatch) return null
      const amount = parseFloat(amtMatch[1])
      if (isNaN(amount) || amount < MIN_AMOUNT) return null

      // Parse issuer name from XML (more reliable than index)
      const nameMatch = xml.match(/<issuerName>(.*?)<\/issuerName>/i)
      const issuerName = nameMatch
        ? nameMatch[1].trim()
        : src.entity_name || 'Unknown'

      // Parse industry description if present
      const industryMatch = xml.match(/<industryGroupType>(.*?)<\/industryGroupType>/i)

      return {
        name:        issuerName,
        amount,
        valuation:   null, // not in Form D
        date:        src.file_date,
        industry:    industryMatch ? industryMatch[1].trim() : '—',
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
// Filters market news for funding announcement keywords and extracts amounts.

const FUNDING_KEYWORDS = [
  'raises', 'raised', 'secures', 'closes', 'funding round',
  'series a', 'series b', 'series c', 'series d', 'series e',
  'venture round', 'growth equity', 'private equity round',
]

const AMOUNT_REGEX = /\$(\d+(?:\.\d+)?)\s*(billion|million|bn|m)\b/gi

function extractAmount(text) {
  let max = 0
  let match
  AMOUNT_REGEX.lastIndex = 0
  while ((match = AMOUNT_REGEX.exec(text)) !== null) {
    const val  = parseFloat(match[1])
    const unit = match[2].toLowerCase()
    const usd  = (unit === 'billion' || unit === 'bn') ? val * 1e9 : val * 1e6
    if (usd > max) max = usd
  }
  return max
}

async function fetchFinnhubFundingNews(apiKey) {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) return []
  const articles = await res.json()

  const deals = []

  for (const article of articles || []) {
    const text = ((article.headline || '') + ' ' + (article.summary || '')).toLowerCase()
    const hasFundingKeyword = FUNDING_KEYWORDS.some(kw => text.includes(kw))
    if (!hasFundingKeyword) continue

    const amount = extractAmount(article.headline + ' ' + (article.summary || ''))
    if (amount < MIN_AMOUNT) continue

    // Best-effort company name: first capitalized noun phrase in headline
    const nameMatch = article.headline?.match(/^([A-Z][A-Za-z0-9&\s,.']+?)\s+(?:raises|raised|secures|closes)/i)

    deals.push({
      name:        nameMatch ? nameMatch[1].trim() : article.related || 'Undisclosed',
      amount,
      valuation:   null,
      date:        article.datetime
        ? new Date(article.datetime * 1000).toISOString().split('T')[0]
        : null,
      industry:    '—',
      description: article.headline?.slice(0, 80) + (article.headline?.length > 80 ? '…' : ''),
      source:      'Finnhub News',
      url:         article.url,
    })
  }

  return deals.sort((a, b) => b.amount - a.amount)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY

    const [edgarResult, finnhubResult] = await Promise.allSettled([
      fetchEdgarFormD(),
      FINNHUB_KEY ? fetchFinnhubFundingNews(FINNHUB_KEY) : Promise.resolve([]),
    ])

    const edgarDeals   = edgarResult.status  === 'fulfilled' ? edgarResult.value   : []
    const finnhubDeals = finnhubResult.status === 'fulfilled' ? finnhubResult.value : []

    // Deduplicate by company name (case-insensitive)
    const seen  = new Set(edgarDeals.map(d => d.name.toLowerCase().trim()))
    const extra = finnhubDeals.filter(d => !seen.has(d.name.toLowerCase().trim()))

    const deals = [...edgarDeals, ...extra].sort((a, b) => b.amount - a.amount)

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200')
    res.status(200).json({
      deals,
      count:   deals.length,
      sources: ['SEC EDGAR Form D', 'Finnhub News'],
    })
  } catch (err) {
    console.error('[api/funding]', err)
    res.status(500).json({ error: err.message, deals: [] })
  }
}
