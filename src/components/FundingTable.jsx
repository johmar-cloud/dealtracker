import { useState, useMemo } from 'react'
import TableFilters from './TableFilters'

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) }
  catch { return s }
}
function fmtAmt(n) {
  if (!n || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toLocaleString()}`
}
function sizeBucket(n) {
  if (!n) return 'Unknown'
  if (n < 200e6)  return '$100M–$200M'
  if (n < 500e6)  return '$200M–$500M'
  if (n < 1e9)    return '$500M–$1B'
  return 'Over $1B'
}

// Colour-coded label for secondary valuation source
function SecondaryCell({ deal }) {
  const { secondaryVal, secondaryLabel, valuation } = deal

  if (secondaryLabel === 'Yahoo (Secondary)' && secondaryVal) {
    return (
      <td>
        <span className="cell-value accent">{fmtAmt(secondaryVal)}</span>
        <span className="val-label val-label-secondary"> Yahoo</span>
      </td>
    )
  }
  if (secondaryLabel === 'Last Round' && valuation) {
    return (
      <td>
        <span className="cell-value">{fmtAmt(valuation)}</span>
        <span className="val-label val-label-round"> Last Round</span>
      </td>
    )
  }
  return <td className="cell-na">—</td>
}

export default function FundingTable({ data, loading, error }) {
  const [filters, setFilters] = useState({})

  const filterDefs = useMemo(() => [
    { key: 'industry', label: 'Industry',
      options: [...new Set(data.map(d => d.industry).filter(v => v && v !== '—'))].sort() },
    { key: '_size',    label: 'Round Size',
      options: ['$100M–$200M','$200M–$500M','$500M–$1B','Over $1B'] },
    { key: 'secondaryLabel', label: 'Valuation Data',
      options: ['Yahoo (Secondary)','Last Round'] },
    { key: 'source',   label: 'Source',
      options: [...new Set(data.map(d => d.source).filter(Boolean))] },
  ], [data])

  const filtered = useMemo(() => data.filter(d => {
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue
      if (k === '_size') { if (sizeBucket(d.amount) !== v) return false }
      else if (String(d[k]) !== v) return false
    }
    return true
  }), [data, filters])

  if (error) return <div className="table-error">Failed to load: {error}</div>

  return (
    <div className="table-section">
      {!loading && data.length > 0 && (
        <TableFilters defs={filterDefs} values={filters} onChange={setFilters}
          count={filtered.length} total={data.length} />
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Description</th>
              <th>Industry</th>
              <th>Round Size</th>
              <th>Amount Sold</th>
              <th>Valuation / Secondary</th>
              <th>Filed / Announced</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="loading-rows">
                  {[70,60,45,35,35,45,45,35].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width:`${w}%` }} /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="table-empty">
                {data.length === 0
                  ? 'No qualifying rounds found. Ensure FINNHUB_API_KEY is set and ANTHROPIC_API_KEY is added in Vercel environment variables.'
                  : 'No results match the current filters.'}
              </td></tr>
            ) : (
              filtered.map((deal, i) => (
                <tr key={i}>
                  <td>
                    <span className="cell-name">
                      {deal.url
                        ? <a href={deal.url} target="_blank" rel="noreferrer" className="cell-link">{deal.name}</a>
                        : deal.name}
                    </span>
                  </td>
                  <td className="cell-muted cell-desc">{deal.description || '—'}</td>
                  <td className="cell-muted">{deal.industry || '—'}</td>
                  <td className="cell-value accent">{fmtAmt(deal.amount)}</td>
                  <td className="cell-value">
                    {deal.amountSold && deal.amountSold !== deal.amount ? fmtAmt(deal.amountSold) : '—'}
                  </td>
                  <SecondaryCell deal={deal} />
                  <td className="cell-muted">{fmtDate(deal.date)}</td>
                  <td><span className="source-tag">{deal.source}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
