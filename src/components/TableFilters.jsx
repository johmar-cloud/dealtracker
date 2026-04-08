// TableFilters — shared inline filter row for both tables
// defs: [{ key, label, options: string[] }]
// values: { [key]: string }
// onChange: (newValues) => void

export default function TableFilters({ defs, values, onChange, count, total }) {
  const activeCount = Object.values(values).filter(Boolean).length

  function set(key, val) {
    onChange({ ...values, [key]: val || undefined })
  }

  function clearAll() {
    onChange({})
  }

  return (
    <div className="tfilter-bar">
      <div className="tfilter-controls">
        {defs.map(def => (
          <div key={def.key} className="tfilter-group">
            <select
              className={`tfilter-select ${values[def.key] ? 'tfilter-active' : ''}`}
              value={values[def.key] || ''}
              onChange={e => set(def.key, e.target.value)}
            >
              <option value="">{def.label}</option>
              {def.options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        ))}

        {activeCount > 0 && (
          <button className="tfilter-clear" onClick={clearAll}>
            Clear {activeCount > 1 ? `${activeCount} filters` : 'filter'}
          </button>
        )}
      </div>

      <span className="tfilter-count">
        {count !== total ? `${count} of ${total}` : `${total}`} results
      </span>
    </div>
  )
}
