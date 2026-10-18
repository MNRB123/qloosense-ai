
import { useState } from 'react'
import './App.css'

function App() {
  const [city, setCity] = useState('Surat')
  const [interests, setInterests] = useState('restaurants, local experiences')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  async function findRecommendations(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setSearched(false)
    setResults([])

    try {
      const response = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: city.trim(),
          interests: interests.trim(),
          limit: 5,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || 'Could not load recommendations.')
      }

      const items = Array.isArray(data.recommendations?.results?.entities)
        ? data.recommendations.results.entities
        : Array.isArray(data.results?.entities)
          ? data.results.entities
          : Array.isArray(data.results)
            ? data.results
            : []


      setResults(items)
      setSearched(true)

      if (items.length === 0) {
        setError(data.message || 'No recommendations found. Try different interests.')
      }
    } catch (err) {
      setError(
        err.message || 'Could not connect to the backend. Check that it is running.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <nav className="navbar">
        <a className="brand" href="/">
          <span className="brand-mark">Q</span>
          <span>QlooSense<span className="brand-ai"> AI</span></span>
        </a>
        <span className="nav-label">PERSONALIZED DISCOVERY</span>
      </nav>

      <section className="hero">
        <div className="eyebrow">
          <span className="status-dot" />
          POWERED BY QLOO TASTE INTELLIGENCE
        </div>

        <h1>Find your next<br /><span>favorite experience.</span></h1>
        <p className="hero-copy">
          Discover places and experiences tailored to your interests.
          Tell us where you are going and what you love.
        </p>

        <form className="search-panel" onSubmit={findRecommendations}>
          <label htmlFor="city">YOUR CITY</label>
          <input
            id="city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="e.g. Surat"
            required
          />

          <label htmlFor="interests">WHAT ARE YOU INTERESTED IN?</label>
          <textarea
            id="interests"
            value={interests}
            onChange={(event) => setInterests(event.target.value)}
            placeholder="e.g. cafes, art, music, restaurants"
            rows={3}
            required
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Finding experiences…' : 'Discover experiences'}
            {!loading && <span aria-hidden="true"> →</span>}
          </button>
          <p className="privacy-note">Your search is sent to the QlooSense AI backend.</p>
        </form>
      </section>

      {error && (
        <div className="message error-message" role="alert">
          {error}
        </div>
      )}

      {loading && (
        <div className="message" role="status">Finding recommendations for you…</div>
      )}

      {searched && results.length > 0 && (
        <section className="results-section">
          <div className="results-heading">
            <div>
              <p className="section-kicker">YOUR DISCOVERY LIST</p>
              <h2>Explore {city}</h2>
            </div>
            <span className="result-count">{results.length} results</span>
          </div>

          <div className="results-grid">
            {results.map((item, index) => {
              const name = item.name || item.title || `Experience ${index + 1}`
              const properties = item.properties || {}
              const address = properties.address || item.address || ''
              const genre =
                properties.primary_genre?.name ||
                item.category ||
                item.genre ||
                'Recommended experience'

              return (
                <article className="result-card" key={item.entity_id || item.id || `${name}-${index}`}>
                  <div className="card-number">{String(index + 1).padStart(2, '0')}</div>
                  <div className="card-category">{genre}</div>
                  <h3>{name}</h3>
                  {address && <p className="card-address">{address}</p>}
                  <div className="card-footer">Qloo discovery <span>↗</span></div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <footer className="footer">
        <span>QlooSense AI</span>
        <span>Built for the Qloo Agentic Hackathon 2026</span>
      </footer>
    </main>
  )
}

export default App
