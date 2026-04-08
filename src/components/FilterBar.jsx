const TYPES = [
  { id: 'both',    label: 'IPO + Funding' },
  { id: 'ipo',     label: 'IPO Pipeline' },
  { id: 'funding', label: 'Funding Rounds' },
]

const PERIODS = [
  { id: '1w', label: '1 Week' },
  { id: '1m', label: '1 Month' },
  { id: '3m', label: '3 Months' },
  { id: '6m', label: '6 Months' },
]

export default function FilterBar({ onSearch, loading }) {
  return (
    <div className="filter-shell">
      <div className="filter-card">
        <div className="filter-card-header">
          <span className="filter-card-title">DealsTracker</span>
          <span className="filter-card-sub">
            IPO pipeline and large funding rounds, sourced from Finnhub and SEC EDGAR.
          </span>
        </div>

        <form
          className="filter-form"
          onSubmit={e => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            onSearch({
              type:   fd.get('type'),
              period: fd.get('period'),
            })
          }}
        >
          <div className="filter-group">
            <label className="filter-label">Data type</label>
            <div className="filter-pills" role="group">
              {TYPES.map((t, i) => (
                <label key={t.id} className="pill-label">
                  <input
                    type="radio"
                    name="type"
                    value={t.id}
                    defaultChecked={i === 0}
                    className="pill-radio"
                  />
                  <span className="pill">{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label className="filter-label">Announcement period</label>
            <div className="filter-pills" role="group">
              {PERIODS.map((p, i) => (
                <label key={p.id} className="pill-label">
                  <input
                    type="radio"
                    name="period"
                    value={p.id}
                    defaultChecked={i === 1}
                    className="pill-radio"
                  />
                  <span className="pill">{p.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-run" disabled={loading}>
            {loading ? (
              <>
                <span className="spin">↻</span>
                Fetching data…
              </>
            ) : (
              'Run Screen'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
