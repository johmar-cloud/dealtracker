// api/ipo.js
// Finnhub IPO Calendar (primary) + SEC EDGAR S-1 filings (secondary)
// Accepts: ?period=1w|1m|3m|6m
// Enriches sector via Finnhub stock/profile2 and EDGAR SIC codes
// Cache: 1hr Vercel CDN

function periodToDays(period) {
  return { '1w': 7, '1m': 30, '3m': 90, '6m': 180 }[period] ?? 30
}

function isoDate(date) { return date.toISOString().split('T')[0] }

function shiftDate(base, days, forward = false) {
  const d = new Date(base)
  d.setDate(d.getDate() + (forward ? days : -days))
  return isoDate(d)
}

// Enrich Finnhub IPO list with sector from profile2 (parallel, failures tolerated)
async function enrichSector(ipos, apiKey) {
  const withSymbol = ipos.filter(i => i.symbol)
  const map = {}

  await Promise.allSettled(
    withSymbol.map(async ipo => {
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/stock/profile2?symbol=${ipo.symbol}&token=${apiKey}`,
          { signal: AbortSignal.timeout(4000) }
        )
        if (!r.ok) return
        const d = await r.json()
        map[ipo.symbol] = {
          sector: d.finnhubIndustry || null,
          country: d.country || null,
          webUrl: d.weburl || null,
        }
      } catch { /* tolerate */ }
    })
  )

  return ipos.map(ipo => ({
    ...ipo,
    sector: map[ipo.symbol]?.sector ?? '—',
    country: map[ipo.symbol]?.country ?? null,
    webUrl: map[ipo.symbol]?.webUrl ?? null,
  }))
}

async function fetchFinnhubIPOs(apiKey, days) {
  const today = new Date()
  const from  = shiftDate(today, 30)           // include recently priced
  const to    = shiftDate(today, days, true)   // look forward by selected period

  const r = await fetch(
    `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${apiKey}`
  )
  if (!r.ok) throw new Error(`Finnhub ${r.status}`)
  const data = await r.json()

  const raw = (data.ipoCalendar || []).map(i => ({
    name:             i.name,
    symbol:           i.symbol || null,
    exchange:         i.exchange || '—',
    date:             i.date,
    priceRange:       i.price || 'TBD',
    totalSharesValue: i.totalSharesValue || 0,
    status:           i.status || 'expected',
    sector:           null,
    source:           'Finnhub',
  }))

  return enrichSector(raw, apiKey)
}

async function fetchEdgarS1s(days) {
  const today = new Date()
  const from  = shiftDate(today, days)

  const r = await fetch(
    `https://efts.sec.gov/LATEST/search-index?forms=S-1,S-1%2FA` +
    `&dateRange=custom&startdt=${from}&enddt=${isoDate(today)}`,
    { headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' } }
  )
  if (!r.ok) return []
  const data = await r.json()
  const hits = (data.hits?.hits || []).slice(0, 20)

  return Promise.all(hits.map(async hit => {
    const src = hit._source || {}
    const accId = hit._id || ''
    const cikPadded = accId.split('-')[0] || ''
    const cik = cikPadded.replace(/^0+/, '')
    let sector = '—'

    if (cik) {
      try {
        const sr = await fetch(
          `https://data.sec.gov/submissions/CIK${cikPadded}.json`,
          {
            headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' },
            signal: AbortSignal.timeout(3000)
          }
        )
        if (sr.ok) {
          const sub = await sr.json()
          sector = sub.sicDescription || '—'
        }
      } catch { /* tolerate */ }
    }

    return {
      name:             src.entity_name || src.display_names?.[0] || 'Unknown',
      symbol:           null,
      exchange:         '—',
      date:             src.file_date,
      priceRange:       'TBD',
      totalSharesValue: 0,
      status:           'filed',
      sector,
      source:           'SEC EDGAR',
    }
  }))
}

export default async function handler(req, res) {
  const { period = '1m' } = req.query
  const days = periodToDays(period)

  try {
    const KEY = process.env.FINNHUB_API_KEY

    const [fhRes, edRes] = await Promise.allSettled([
      KEY ? fetchFinnhubIPOs(KEY, days) : Promise.resolve([]),
      fetchEdgarS1s(days),
    ])

    const primary   = fhRes.status === 'fulfilled' ? fhRes.value : []
    const secondary = edRes.status === 'fulfilled' ? edRes.value : []

    const seen  = new Set(primary.map(d => d.name?.toLowerCase().trim()))
    const extra = secondary.filter(d => !seen.has(d.name?.toLowerCase().trim()))

    const deals = [...primary, ...extra].sort((a, b) => {
      if (!a.date) return 1
      if (!b.date) return -1
      return new Date(a.date) - new Date(b.date)
    })

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200')
    res.status(200).json({ deals, count: deals.length })
  } catch (err) {
    console.error('[api/ipo]', err)
    res.status(500).json({ error: err.message, deals: [] })
  }
}
