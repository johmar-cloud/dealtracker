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

function fmtVal(n) {
  if (!n || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toLocaleString()}`
}

function statusClass(s) {
  const v = (s || '').toLowerCase()
  if (v === 'priced')    return 'status-priced'
  if (v === 'expected')  return 'status-expected'
  if (v === 'withdrawn') return 'status-withdrawn'
  return 'status-filed'
}

function valBucket(n) {
  if (!n || n <= 0) return 'Unknown'
  if (n < 100e6)   return 'Under $100M'
  if (n < 500e6)   return '$100M–$500M'
  if (n < 1e9)     return '$500M–$1B'
  if (n < 5e9)     return '$1B–$5B'
  return 'Over $5B'
}

const SKELETON_COUNT = 6

export default function IPOTable({ data, loading, error }) {
  const [filters, setFilters] = useState({})

  // Build filter options from live data
  const filterDefs = useMemo(() => [
    {
      key: 'sector',
      label: 'Sector',
      options: [...new Set(data.map(d => d.sector).filter(Boolean).filter(v => v !== '—'))].sort(),
    },
    {
      key: 'exchange',
      label: 'Exchange',
      options: [...new Set(data.map(d => d.exchange).filter(Boolean).filter(v => v !== '—'))].sort(),
    },
    {
      key: 'status',
      label: 'Status',
      options: [...new Set(data.map(d => (d.status || 'filed')))].sort(),
    },
    {
      key: '_valBucket',
      label: 'Valuation',
      options: ['Under $100M', '$100M–$500M', '$500M–$1B', '$1B–$5B', 'Over $5B'],
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
        if (key === '_valBucket') {
          if (valBucket(d.totalSharesValue) !== val) return false
        } else if (key === 'status') {
          if ((d.status || 'filed') !== val) return false
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
              <th>Sector</th>
              <th>Exchange</th>
              <th>IPO Date</th>
              <th>Price Range</th>
              <th>Est. Valuation</th>
              <th>Secondary Mkt</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <tr key={i} className="loading-rows">
                  {[80, 60, 40, 55, 40, 45, 50, 45, 40].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width: `${w}%` }} /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-empty">
                  {data.length === 0
                    ? 'No IPO filings found for this period.'
                    : 'No results match the current filters.'}
                </td>
              </tr>
            ) : (
              filtered.map((ipo, i) => (
                <tr key={i}>
                  <td>
                    <span className="cell-name">{ipo.name}</span>
                    {ipo.symbol && <span className="cell-ticker">{ipo.symbol}</span>}
                  </td>
                  <td className="cell-muted">{ipo.sector || '—'}</td>
                  <td className="cell-muted">{ipo.exchange || '—'}</td>
                  <td className="cell-value">{fmtDate(ipo.date)}</td>
                  <td className="cell-value">{ipo.priceRange || '—'}</td>
                  <td className="cell-value">{fmtVal(ipo.totalSharesValue)}</td>
                  <td className="cell-na">Requires Forge / NPM API</td>
                  <td>
                    <span className={`status ${statusClass(ipo.status)}`}>
                      {(ipo.status || 'filed').charAt(0).toUpperCase() + (ipo.status || 'filed').slice(1)}
                    </span>
                  </td>
                  <td><span className="source-tag">{ipo.source}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
