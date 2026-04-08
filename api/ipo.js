// api/ipo.js
// Blends Finnhub IPO Calendar + SEC EDGAR S-1 filings
// Cache: 1 hour via Vercel CDN

const SECTOR_MAP = {
  NASDAQ: 'Technology / Growth',
  NYSE:   'Diversified',
  NYSEAM: 'Small/Mid Cap',
  NGSM:   'Technology / Growth',
  NGS:    'Technology / Growth',
  NGM:    'Technology / Growth',
}

function addMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d.toISOString().split('T')[0]
}

function subMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() - n)
  return d.toISOString().split('T')[0]
}

async function fetchFinnhubIPOs(apiKey) {
  const today = new Date()
  const from  = subMonths(today, 1)
  const to    = addMonths(today, 6)

  const url = `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${apiKey}`
  const res  = await fetch(url)
  if (!res.ok) throw new Error(`Finnhub ${res.status}`)
  const data = await res.json()

  return (data.ipoCalendar || []).map(ipo => ({
    name:            ipo.name,
    symbol:          ipo.symbol,
    exchange:        ipo.exchange,
    date:            ipo.date,
    priceRange:      ipo.price || 'TBD',
    numberOfShares:  ipo.numberOfShares,
    totalSharesValue: ipo.totalSharesValue || 0,
    status:          ipo.status || 'expected',
    sector:          SECTOR_MAP[ipo.exchange] || '—',
    source:          'Finnhub',
  }))
}

async function fetchEdgarS1s() {
  const today = new Date()
  const from  = subMonths(today, 3)
  const url   = `https://efts.sec.gov/LATEST/search-index?forms=S-1,S-1%2FA&dateRange=custom&startdt=${from}&enddt=${today.toISOString().split('T')[0]}&hits.hits.total.value=true`

  const res  = await fetch(url, {
    headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' }
  })
  if (!res.ok) return []
  const data = await res.json()

  return (data.hits?.hits || []).map(hit => ({
    name:            hit._source.entity_name || hit._source.display_names?.[0] || 'Unknown',
    symbol:          null,
    exchange:        '—',
    date:            hit._source.file_date,
    priceRange:      'TBD',
    totalSharesValue: 0,
    status:          'filed',
    sector:          '—',
    source:          'SEC EDGAR',
  }))
}

export default async function handler(req, res) {
  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY

    const [finnhubDeals, edgarDeals] = await Promise.allSettled([
      FINNHUB_KEY ? fetchFinnhubIPOs(FINNHUB_KEY) : Promise.resolve([]),
      fetchEdgarS1s(),
    ])

    // Merge: Finnhub is primary, EDGAR fills in any not already listed by name
    const primary   = finnhubDeals.status === 'fulfilled' ? finnhubDeals.value : []
    const secondary = edgarDeals.status  === 'fulfilled'  ? edgarDeals.value  : []

    const primaryNames = new Set(primary.map(d => d.name?.toLowerCase().trim()))
    const unique = secondary.filter(d => !primaryNames.has(d.name?.toLowerCase().trim()))

    const deals = [...primary, ...unique].sort((a, b) => {
      if (!a.date && !b.date) return 0
      if (!a.date) return 1
      if (!b.date) return -1
      return new Date(a.date) - new Date(b.date)
    })

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200')
    res.status(200).json({ deals, count: deals.length, sources: ['Finnhub', 'SEC EDGAR'] })
  } catch (err) {
    console.error('[api/ipo]', err)
    res.status(500).json({ error: err.message, deals: [] })
  }
}
