import { useState, useMemo } from 'react'
import TableFilters from './TableFilters'

function fmtDate(s) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    })
  } catch { return s }
}

function fmtAmt(n) {
  if (!n || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toLocaleString()}`
}

function sizeBucket(n) {
  if (!n || n <= 0) return 'Unknown'
  if (n < 200e6)  return '$100M–$200M'
  if (n < 500e6)  return '$200M–$500M'
  if (n < 1e9)    return '$500M–$1B'
  return 'Over $1B'
}

const SKELETON_COUNT = 6

export default function FundingTable({ data, loading, error }) {
  const [filters, setFilters] = useState({})

  const filterDefs = useMemo(() => [
    {
      key: 'industry',
      label: 'Industry',
      options: [...new Set(data.map(d => d.industry).filter(Boolean).filter(v => v !== '—'))].sort(),
    },
    {
      key: '_sizeBucket',
      label: 'Round Size',
      options: ['$100M–$200M', '$200M–$500M', '$500M–$1B', 'Over $1B'],
    },
    {
      key: 'source',
      label: 'Source',
      options: [...new Set(data.map(d => d.source).filter(Boolean))],
    },
  ], [data])

  const filtered = useMemo(() => {
    return data.filter(d => {
      for (const [key, val] of Object.entries(filters)) {
        if (!val) continue
        if (key === '_sizeBucket') {
          if (sizeBucket(d.amount) !== val) return false
        } else if (String(d[key]) !== val) {
          return false
        }
      }
      return true
    })
  }, [data, filters])

  if (error) return (
    <div className="table-error">Failed to load: {error}</div>
  )

  return (
    <div className="table-section">
      {!loading && data.length > 0 && (
        <TableFilters
          defs={filterDefs}
          values={filters}
          onChange={setFilters}
          count={filtered.length}
          total={data.length}
        />
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
              <th>Est. Valuation</th>
              <th>Filed / Announced</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <tr key={i} className="loading-rows">
                  {[75, 60, 50, 40, 40, 40, 50, 40].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width: `${w}%` }} /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-empty">
                  {data.length === 0
                    ? 'No qualifying rounds found. Ensure FINNHUB_API_KEY is set in environment variables.'
                    : 'No results match the current filters.'}
                </td>
              </tr>
            ) : (
              filtered.map((deal, i) => (
                <tr key={i}>
                  <td>
                    <span className="cell-name">
                      {deal.url ? (
                        <a href={deal.url} target="_blank" rel="noreferrer" className="cell-link">
                          {deal.name}
                        </a>
                      ) : deal.name}
                    </span>
                  </td>
                  <td className="cell-muted cell-desc">{deal.description || '—'}</td>
                  <td className="cell-muted">{deal.industry || '—'}</td>
                  <td className="cell-value accent">{fmtAmt(deal.amount)}</td>
                  <td className="cell-value">{deal.amountSold && deal.amountSold !== deal.amount ? fmtAmt(deal.amountSold) : '—'}</td>
                  <td className="cell-value">{deal.valuation ? fmtAmt(deal.valuation) : '—'}</td>
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
