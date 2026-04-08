import { useState, useEffect, useCallback } from 'react'
import IPOTable from './components/IPOTable'
import FundingTable from './components/FundingTable'

export default function App() {
  const [ipoData, setIpoData]           = useState([])
  const [fundingData, setFundingData]   = useState([])
  const [ipoLoading, setIpoLoading]     = useState(true)
  const [fundingLoading, setFundingLoading] = useState(true)
  const [ipoError, setIpoError]         = useState(null)
  const [fundingError, setFundingError] = useState(null)
  const [lastUpdated, setLastUpdated]   = useState(null)
  const [refreshing, setRefreshing]     = useState(false)

  const fetchAll = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    setIpoLoading(true)
    setFundingLoading(true)
    setIpoError(null)
    setFundingError(null)

    await Promise.all([
      fetch('/api/ipo')
        .then(r => r.json())
        .then(d => setIpoData(d.deals || []))
        .catch(e => setIpoError(e.message))
        .finally(() => setIpoLoading(false)),

      fetch('/api/funding')
        .then(r => r.json())
        .then(d => setFundingData(d.deals || []))
        .catch(e => setFundingError(e.message))
        .finally(() => setFundingLoading(false)),
    ])

    setLastUpdated(new Date())
    if (isRefresh) setRefreshing(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const fmtTime = d =>
    d?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) ?? ''

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
            {lastUpdated && (
              <span className="last-updated">Updated {fmtTime(lastUpdated)}</span>
            )}
            <button
              className="btn-refresh"
              onClick={() => fetchAll(true)}
              disabled={refreshing || ipoLoading || fundingLoading}
            >
              {(refreshing || (ipoLoading && lastUpdated)) ? (
                <span className="spin">↻</span>
              ) : '↻'}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        <section>
          <div className="section-head">
            <h2 className="section-title">IPO Pipeline</h2>
            <span className="section-badge">SEC Registered</span>
            {!ipoLoading && (
              <span className="section-count">{ipoData.length} listings</span>
            )}
          </div>
          <div className="table-wrap">
            <IPOTable data={ipoData} loading={ipoLoading} error={ipoError} />
          </div>
          <p className="data-note">
            Source: Finnhub IPO Calendar + SEC EDGAR S-1 filings.
            Secondary market valuations require{' '}
            <a href="https://forge.com" target="_blank" rel="noreferrer">Forge Global</a> or{' '}
            <a href="https://www.nasdaq.com/solutions/nasdaq-private-market" target="_blank" rel="noreferrer">
              NASDAQ Private Market
            </a> API access.
          </p>
        </section>

        <section>
          <div className="section-head">
            <h2 className="section-title">Big Funding Rounds</h2>
            <span className="section-badge">&gt; $100M</span>
            {!fundingLoading && (
              <span className="section-count">{fundingData.length} rounds</span>
            )}
          </div>
          <div className="table-wrap">
            <FundingTable data={fundingData} loading={fundingLoading} error={fundingError} />
          </div>
          <p className="data-note">
            Source: SEC EDGAR Form D filings + Finnhub market news. Connect{' '}
            <a href="https://data.crunchbase.com" target="_blank" rel="noreferrer">Crunchbase API</a>{' '}
            for enriched product and investor data.
          </p>
        </section>
      </main>
    </>
  )
}
