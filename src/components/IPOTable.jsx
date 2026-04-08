import { useState, useMemo } from 'react'
import TableFilters from './TableFilters'

const STATUS_DEFINITIONS = [
  { status: 'Expected', color: 'var(--blue)',
    desc: 'S-1 filed, IPO date set, roadshow underway. Price range disclosed. Last stage before pricing.' },
  { status: 'Priced',   color: 'var(--green)',
    desc: 'Final offer price set. Shares allocated to institutional investors. Public trading begins next session.' },
  { status: 'Filed',    color: 'var(--accent)',
    desc: 'S-1 submitted. In SEC review period (typically 4-8 weeks). No IPO date set yet.' },
  { status: 'Withdrawn', color: 'var(--red)',
    desc: 'IPO pulled after filing. Reasons: weak demand, market conditions, or private acquisition. May refile later.' },
]

function fmtDate(s) {
  if (!s) return '—'
  try { return new Date(s).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) }
  catch { return s }
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

function StatusTooltip() {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="th-tooltip-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="th-info">?</span>
      {open && (
        <div className="th-tooltip">
          <div className="th-tooltip-title">Status values</div>
          {STATUS_DEFINITIONS.map(s => (
            <div key={s.status} className="th-tooltip-row">
              <span className="th-tooltip-dot" style={{ background: s.color }} />
              <span className="th-tooltip-status">{s.status}</span>
              <span className="th-tooltip-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

export default function IPOTable({ data, loading, error }) {
  const [filters, setFilters] = useState({})

  const filterDefs = useMemo(() => [
    { key: 'sector',   label: 'Sector',
      options: [...new Set(data.map(d => d.sector).filter(v => v && v !== '—'))].sort() },
    { key: 'exchange', label: 'Exchange',
      options: [...new Set(data.map(d => d.exchange).filter(v => v && v !== '—'))].sort() },
    { key: 'status',   label: 'Status',
      options: [...new Set(data.map(d => d.status || 'filed'))].sort() },
    { key: '_val',     label: 'Valuation',
      options: ['Under $100M','$100M–$500M','$500M–$1B','$1B–$5B','Over $5B'] },
    { key: 'source',   label: 'Source',
      options: [...new Set(data.map(d => d.source).filter(Boolean))] },
  ], [data])

  const filtered = useMemo(() => data.filter(d => {
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue
      if (k === '_val') { if (valBucket(d.totalSharesValue) !== v) return false }
      else if (k === 'status') { if ((d.status || 'filed') !== v) return false }
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
              <th>Sector</th>
              <th>Description</th>
              <th>Exchange</th>
              <th>IPO Date</th>
              <th>Price Range</th>
              <th>Est. Valuation</th>
              <th>Secondary Mkt</th>
              <th>
                <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                  Status <StatusTooltip />
                </span>
              </th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="loading-rows">
                  {[75,50,60,35,45,35,40,45,40,35].map((w, j) => (
                    <td key={j}><div className="skeleton" style={{ width:`${w}%` }} /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="table-empty">
                {data.length === 0 ? 'No IPO filings found for this period.'
                  : 'No results match the current filters.'}
              </td></tr>
            ) : (
              filtered.map((ipo, i) => (
                <tr key={i}>
                  <td>
                    <span className="cell-name">{ipo.name}</span>
                    {ipo.symbol && <span className="cell-ticker">{ipo.symbol}</span>}
                  </td>
                  <td className="cell-muted">{ipo.sector || '—'}</td>
                  <td className="cell-muted cell-desc">{ipo.description || '—'}</td>
                  <td className="cell-muted">{ipo.exchange || '—'}</td>
                  <td className="cell-value">{fmtDate(ipo.date)}</td>
                  <td className="cell-value">{ipo.priceRange || '—'}</td>
                  <td className="cell-value">{fmtVal(ipo.totalSharesValue)}</td>
                  <td className="cell-na">Requires Forge / NPM</td>
                  <td>
                    <span className={`status ${statusClass(ipo.status)}`}>
                      {(ipo.status||'filed').charAt(0).toUpperCase()+(ipo.status||'filed').slice(1)}
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
