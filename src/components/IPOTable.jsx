const COLS = [
  'Company',
  'Sector / Product',
  'Exchange',
  'IPO Date',
  'Price Range',
  'Est. Valuation',
  'Secondary Mkt',
  'Status',
  'Source',
]

function SkeletonRows({ cols }) {
  return Array.from({ length: 5 }).map((_, i) => (
    <tr key={i} className="loading-rows">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j}>
          <div className={`skeleton skeleton-${['md','sm','xs','sm','xs','xs','xs','xs','xs'][j] || 'sm'}`} />
        </td>
      ))}
    </tr>
  ))
}

function statusClass(status) {
  if (!status) return 'status-filed'
  const s = status.toLowerCase()
  if (s === 'expected') return 'status-expected'
  if (s === 'priced')   return 'status-priced'
  if (s === 'filed')    return 'status-filed'
  if (s === 'withdrawn') return 'status-withdrawn'
  return 'status-filed'
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    })
  } catch { return dateStr }
}

function fmtVal(num) {
  if (!num || num <= 0) return '—'
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`
  return `$${num.toLocaleString()}`
}

export default function IPOTable({ data, loading, error }) {
  if (error) {
    return (
      <table>
        <thead><tr>{COLS.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          <tr><td colSpan={COLS.length} className="table-empty">
            Failed to load: {error}
          </td></tr>
        </tbody>
      </table>
    )
  }

  return (
    <table>
      <thead>
        <tr>{COLS.map(c => <th key={c}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {loading ? (
          <SkeletonRows cols={COLS.length} />
        ) : data.length === 0 ? (
          <tr>
            <td colSpan={COLS.length} className="table-empty">
              No IPO filings found for this period.
            </td>
          </tr>
        ) : (
          data.map((ipo, i) => (
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
              <td className="cell-na">Forge / NPM API reqd.</td>
              <td>
                <span className={`status ${statusClass(ipo.status)}`}>
                  {ipo.status
                    ? ipo.status.charAt(0).toUpperCase() + ipo.status.slice(1)
                    : 'Filed'}
                </span>
              </td>
              <td><span className="source-tag">{ipo.source}</span></td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
