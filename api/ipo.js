// api/ipo.js
// Finnhub IPO Calendar + SEC EDGAR S-1 filings
// v3: Haiku enrichment for sector/description where profile2 returns nothing
// Accepts: ?period=1w|1m|3m|6m

function periodToDays(p) { return { '1w': 7, '1m': 30, '3m': 90, '6m': 180 }[p] ?? 30 }
function isoDate(d) { return d.toISOString().split('T')[0] }
function shiftDate(base, days, forward = false) {
  const d = new Date(base)
  d.setDate(d.getDate() + (forward ? days : -days))
  return isoDate(d)
}
function timeout(ms) { return AbortSignal.timeout(ms) }

async function enrichSector(ipos, apiKey) {
  const withSymbol = ipos.filter(i => i.symbol)
  const map = {}
  await Promise.allSettled(
    withSymbol.map(async ipo => {
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/stock/profile2?symbol=${ipo.symbol}&token=${apiKey}`,
          { signal: timeout(4000) }
        )
        if (!r.ok) return
        const d = await r.json()
        if (d.finnhubIndustry) {
          map[ipo.symbol] = { sector: d.finnhubIndustry, country: d.country, webUrl: d.weburl }
        }
      } catch { /* tolerate */ }
    })
  )
  return ipos.map(ipo => ({
    ...ipo,
    sector:  map[ipo.symbol]?.sector  ?? ipo.sector ?? null,
    country: map[ipo.symbol]?.country ?? null,
    webUrl:  map[ipo.symbol]?.webUrl  ?? null,
  }))
}

async function enrichWithHaiku(ipos, anthropicKey) {
  // Only enrich those still missing sector
  const missing = ipos.filter(i => !i.sector)
  if (!anthropicKey || missing.length === 0) return ipos

  const names = missing.map(i => i.name).join('\n')
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
        max_tokens: 800,
        messages: [{
          role: 'user',
          content:
            `For each company below return a JSON array (no markdown, no preamble) with ` +
            `{ "name": string, "sector": string, "description": string }.\n` +
            `sector: one of Technology, Healthcare, Fintech, Energy, Real Estate, Consumer, ` +
            `Industrials, Asset Management, Defence, Biotech, Diversified.\n` +
            `description: one sentence, what they do. Use null if unknown.\n\n${names}`,
        }],
      }),
      signal: timeout(10000),
    })
    if (!res.ok) return ipos
    const data = await res.json()
    const raw  = data.content?.[0]?.text || '[]'
    let enriched
    try { enriched = JSON.parse(raw.replace(/```json|```/g, '').trim()) }
    catch { return ipos }

    const map = {}
    for (const e of enriched) {
      if (e?.name) map[e.name.toLowerCase().trim()] = e
    }

    return ipos.map(ipo => {
      const match = map[ipo.name?.toLowerCase().trim()]
      return {
        ...ipo,
        sector:      ipo.sector ?? match?.sector ?? '—',
        description: match?.description ?? null,
      }
    })
  } catch (e) {
    console.warn('[ipo] Haiku enrichment failed:', e.message)
    return ipos
  }
}

async function fetchFinnhubIPOs(apiKey, days) {
  const today = new Date()
  const from  = shiftDate(today, 30)
  const to    = shiftDate(today, days, true)
  const r = await fetch(
    `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${apiKey}`,
    { signal: timeout(8000) }
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
    description:      null,
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
    {
      headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' },
      signal: timeout(8000),
    }
  )
  if (!r.ok) return []
  const data = await r.json()
  const hits = (data.hits?.hits || []).slice(0, 15) // consistent with funding limit

  return Promise.all(hits.map(async hit => {
    const src       = hit._source || {}
    const accId     = hit._id || ''
    const cikPadded = accId.split('-')[0] || ''
    const cik       = cikPadded.replace(/^0+/, '')
    let sector      = null

    if (cik) {
      try {
        const sr = await fetch(
          `https://data.sec.gov/submissions/CIK${cikPadded}.json`,
          {
            headers: { 'User-Agent': 'FlowValueDealsTracker contact@flowvalue.io' },
            signal: timeout(3000),
          }
        )
        if (sr.ok) {
          const sub = await sr.json()
          sector = sub.sicDescription || null
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
      description:      null,
      source:           'SEC EDGAR',
    }
  }))
}

export default async function handler(req, res) {
  const { period = '1m' } = req.query
  const days = periodToDays(period)

  try {
    const KEY           = process.env.FINNHUB_API_KEY
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

    const [fhRes, edRes] = await Promise.allSettled([
      KEY ? fetchFinnhubIPOs(KEY, days) : Promise.resolve([]),
      fetchEdgarS1s(days),
    ])

    let primary   = fhRes.status === 'fulfilled' ? fhRes.value : []
    const secondary = edRes.status === 'fulfilled' ? edRes.value : []

    const seen  = new Set(primary.map(d => d.name?.toLowerCase().trim()))
    const extra = secondary.filter(d => !seen.has(d.name?.toLowerCase().trim()))
    let deals   = [...primary, ...extra]

    // Haiku fill-in for any still missing sector
    deals = await enrichWithHaiku(deals, ANTHROPIC_KEY)

    deals.sort((a, b) => {
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
