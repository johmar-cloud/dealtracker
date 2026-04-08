const COLS = [
  'Company',
  'Product / Description',
  'Industry',
  'Funding Size',
  'Est. Valuation',
  'Filed / Announced',
  'Source',
]

function SkeletonRows({ cols }) {
  return Array.from({ length: 5 }).map((_, i) => (
    <tr key={i} className="loading-rows">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j}>
          <div className={`skeleton skeleton-${['md','sm','xs','xs','xs','sm','xs'][j] || 'sm'}`} />
        </td>
      ))}
    </tr>
  ))
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    })
  } catch { return dateStr }
}

function fmtAmt(num) {
  if (!num || num <= 0) return '—'
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`
  return `$${num.toLocaleString()}`
}

export default function FundingTable({ data, loading, error }) {
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
              No qualifying rounds found. Check API keys in environment variables.
            </td>
          </tr>
        ) : (
          data.map((deal, i) => (
            <tr key={i}>
              <td>
                <span className="cell-name">{deal.name}</span>
              </td>
              <td className="cell-muted">{deal.description || '—'}</td>
              <td className="cell-muted">{deal.industry || '—'}</td>
              <td className="cell-value" style={{ color: 'var(--accent)' }}>
                {fmtAmt(deal.amount)}
              </td>
              <td className="cell-value">{deal.valuation ? fmtAmt(deal.valuation) : '—'}</td>
              <td className="cell-muted">{fmtDate(deal.date)}</td>
              <td><span className="source-tag">{deal.source}</span></td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}
