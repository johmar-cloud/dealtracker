import { useState, useCallback } from 'react'
import FilterBar from './components/FilterBar'
import IPOTable from './components/IPOTable'
import FundingTable from './components/FundingTable'

const PERIOD_LABELS = {
  '1w': '1 Week', '1m': '1 Month', '3m': '3 Months', '6m': '6 Months'
}

export default function App() {
  const [state, setState] = useState({
    status:      'idle',   // idle | loading | done
    ipoData:     [],
    fundingData: [],
    ipoLoading:  false,
    fundingLoading: false,
    ipoError:    null,
    fundingError: null,
    lastRun:     null,
    params:      null,     // { type, period }
  })

  const runSearch = useCallback(async ({ type, period }) => {
    setState(s => ({
      ...s,
      status:        'loading',
      ipoData:       [],
      fundingData:   [],
      ipoLoading:    type !== 'funding',
      fundingLoading: type !== 'ipo',
      ipoError:      null,
      fundingError:  null,
      params:        { type, period },
    }))

    const showIPO     = type === 'ipo'     || type === 'both'
    const showFunding = type === 'funding' || type === 'both'

    const fetches = []

    if (showIPO) {
      fetches.push(
        fetch(`/api/ipo?period=${period}`)
          .then(r => r.json())
          .then(d => setState(s => ({ ...s, ipoData: d.deals || [], ipoLoading: false })))
          .catch(e => setState(s => ({ ...s, ipoError: e.message, ipoLoading: false })))
      )
    }

    if (showFunding) {
      fetches.push(
        fetch(`/api/funding?period=${period}`)
          .then(r => r.json())
          .then(d => setState(s => ({ ...s, fundingData: d.deals || [], fundingLoading: false })))
          .catch(e => setState(s => ({ ...s, fundingError: e.message, fundingLoading: false })))
      )
    }

    await Promise.all(fetches)
    setState(s => ({ ...s, status: 'done', lastRun: new Date() }))
  }, [])

  const { status, ipoData, fundingData, ipoLoading, fundingLoading,
          ipoError, fundingError, lastRun, params } = state

  const showIPO     = params?.type === 'ipo'     || params?.type === 'both'
  const showFunding = params?.type === 'funding' || params?.type === 'both'

  const isLoading = ipoLoading || fundingLoading

  const fmtTime = d => d?.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit'
  }) ?? ''

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-flow">FLOW</span>
            <span className="logo-sep">//</span>
            <span className="logo-value">VALUE</span>
          </div>
          <div className="header-right">
            <span className="product-label">DealsTracker</span>
            {lastRun && (
              <span className="last-updated">
                {params && `${PERIOD_LABELS[params.period]} · `}
                Updated {fmtTime(lastRun)}
              </span>
            )}
            {status === 'done' && (
              <button
                className="btn-refresh"
                onClick={() => runSearch(params)}
                disabled={isLoading}
              >
                {isLoading ? <span className="spin">↻</span> : '↻'} Refresh
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {/* Filter screen — always visible at top */}
        <FilterBar onSearch={runSearch} loading={isLoading} />

        {/* Results — only rendered after first search */}
        {status !== 'idle' && (
          <div className="results">
            {showIPO && (
              <section>
                <div className="section-head">
                  <h2 className="section-title">IPO Pipeline</h2>
                  <span className="section-badge">SEC Registered</span>
                  {!ipoLoading && (
                    <span className="section-count">{ipoData.length} listings</span>
                  )}
                </div>
                <IPOTable data={ipoData} loading={ipoLoading} error={ipoError} />
                <p className="data-note">
                  Source: Finnhub IPO Calendar + SEC EDGAR S-1.
                  Secondary market prices require{' '}
                  <a href="https://forge.com" target="_blank" rel="noreferrer">Forge Global</a> or{' '}
                  <a href="https://www.nasdaq.com/solutions/nasdaq-private-market" target="_blank" rel="noreferrer">NASDAQ PM</a> API.
                </p>
              </section>
            )}

            {showFunding && (
              <section>
                <div className="section-head">
                  <h2 className="section-title">Big Funding Rounds</h2>
                  <span className="section-badge">&gt;$100M</span>
                  {!fundingLoading && (
                    <span className="section-count">{fundingData.length} rounds</span>
                  )}
                </div>
                <FundingTable data={fundingData} loading={fundingLoading} error={fundingError} />
                <p className="data-note">
                  Source: SEC EDGAR Form D (private placements) + Finnhub news.
                  Connect{' '}
                  <a href="https://data.crunchbase.com" target="_blank" rel="noreferrer">Crunchbase API</a>{' '}
                  for investor and product enrichment.
                </p>
              </section>
            )}
          </div>
        )}
      </main>
    </>
  )
}
