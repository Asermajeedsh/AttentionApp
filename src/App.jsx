import { useMemo, useState } from 'react'
import './App.css'

const initialPartner = {
  yourName: 'Avery',
  partnerName: 'Jordan',
  code: 'A9N-21X',
  connected: false,
}

const initialAlerts = [
  {
    id: 1,
    sender: 'Jordan',
    time: '5 min ago',
    message: 'Need a quick check-in when you can.',
  },
]

const initialUpdates = [
  {
    id: 1,
    title: 'Morning reset',
    summary: 'Work felt heavy, but a walk helped.',
    mood: 'Hopeful',
    problems: 'Feeling behind on messages and deadlines.',
    timestamp: 'Today, 8:40 AM',
  },
]

const moods = ['Steady', 'Happy', 'Hopeful', 'Overwhelmed', 'Anxious', 'Low']

function App() {
  const [partner, setPartner] = useState(initialPartner)
  const [updates, setUpdates] = useState(initialUpdates)
  const [partnerForm, setPartnerForm] = useState({
    yourName: initialPartner.yourName,
    partnerName: initialPartner.partnerName,
    code: initialPartner.code,
  })
  const [alerts, setAlerts] = useState(initialAlerts)
  const [attentionSent, setAttentionSent] = useState(false)
  const [draftUpdate, setDraftUpdate] = useState({
    title: '',
    summary: '',
    problems: '',
    mood: moods[0],
  })

  const activeMood = useMemo(() => {
    return draftUpdate.mood || updates[0]?.mood || moods[0]
  }, [draftUpdate.mood, updates])

  const handlePartnerChange = (event) => {
    const { name, value } = event.target
    setPartnerForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handlePartnerLink = (event) => {
    event.preventDefault()
    setPartner({
      yourName: partnerForm.yourName.trim() || 'You',
      partnerName: partnerForm.partnerName.trim() || 'Partner',
      code: partnerForm.code.trim() || 'Pending',
      connected: true,
    })
  }

  const handleAttentionPing = () => {
    const now = new Date()
    const formattedTime = now.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })

    setAlerts((current) => [
      {
        id: current.length + 1,
        sender: partner.yourName,
        time: `Sent at ${formattedTime}`,
        message: `${partner.yourName} sent an attention button alert.`,
      },
      ...current,
    ])
    setAttentionSent(true)
    window.setTimeout(() => setAttentionSent(false), 2200)
  }

  const handleUpdateChange = (event) => {
    const { name, value } = event.target
    setDraftUpdate((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleUpdateSubmit = (event) => {
    event.preventDefault()

    if (!draftUpdate.summary.trim()) {
      return
    }

    const now = new Date()
    const timestamp = now.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

    setAlerts((current) => [
      {
        id: current.length + 1,
        sender: partner.partnerName,
        time: 'Just now',
        message: `${partner.partnerName} can now see your daily update and mood.`,
      },
      ...current,
    ])

    setUpdates((current) => [
      {
        id: current.length + 1,
        title: draftUpdate.title.trim() || 'Daily check-in',
        summary: draftUpdate.summary.trim(),
        problems: draftUpdate.problems.trim() || 'No specific blockers shared.',
        mood: draftUpdate.mood,
        timestamp,
      },
      ...current,
    ])

    setDraftUpdate({
      title: '',
      summary: '',
      problems: '',
      mood: moods[0],
    })
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Mobile-first partner support</p>
          <h1>Attention App</h1>
          <p className="hero-text">
            Stay linked, send instant attention pings, and share how the day is
            really going without waiting for a long conversation.
          </p>
        </div>

        <div className="hero-stats">
          <article className="stat-chip">
            <span>Partner mode</span>
            <strong>{partner.connected ? 'Linked' : 'Ready to link'}</strong>
          </article>
          <article className="stat-chip">
            <span>Attention button</span>
            <strong>Live alert preview</strong>
          </article>
          <article className="stat-chip">
            <span>Daily updates</span>
            <strong>{updates.length} shared notes</strong>
          </article>
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="panel panel-primary">
          <div className="panel-header">
            <div>
              <p className="section-label">Partner mode</p>
              <h2>Link your partner</h2>
            </div>
            <span className={`status-pill ${partner.connected ? 'online' : ''}`}>
              {partner.connected ? 'Connected' : 'Not linked'}
            </span>
          </div>

          <form className="stack-form" onSubmit={handlePartnerLink}>
            <label>
              Your name
              <input
                name="yourName"
                value={partnerForm.yourName}
                onChange={handlePartnerChange}
                placeholder="Your name"
              />
            </label>
            <label>
              Partner name
              <input
                name="partnerName"
                value={partnerForm.partnerName}
                onChange={handlePartnerChange}
                placeholder="Partner name"
              />
            </label>
            <label>
              Link code
              <input
                name="code"
                value={partnerForm.code}
                onChange={handlePartnerChange}
                placeholder="Enter invite code"
              />
            </label>

            <button className="primary-button" type="submit">
              Enable partner mode
            </button>
          </form>

          <div className="pair-card">
            <div>
              <p className="section-label">Linked pair</p>
              <h3>
                {partner.yourName} + {partner.partnerName}
              </h3>
            </div>
            <p>Invite code: {partner.code}</p>
          </div>
        </article>

        <article className="panel attention-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Attention button</p>
              <h2>Send a gentle beep</h2>
            </div>
            <span className="mini-badge">Push-style preview</span>
          </div>

          <p className="supporting-copy">
            Tap once and your partner receives an attention alert card on their
            device view.
          </p>

          <button
            className={`attention-button ${attentionSent ? 'sent' : ''}`}
            type="button"
            onClick={handleAttentionPing}
          >
            {attentionSent ? 'Attention sent' : `Beep ${partner.partnerName}`}
          </button>

          <div className="phone-preview">
            <div className="phone-notch" />
            <div className="notification-card">
              <p className="notification-label">Partner notification</p>
              <h3>{partner.yourName} needs your attention</h3>
              <p>
                Attention button alert received. Open the app to respond right
                away.
              </p>
            </div>
          </div>
        </article>

        <article className="panel update-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Daily update</p>
              <h2>Share your day, problems, and mood</h2>
            </div>
            <span className="mood-pill">{activeMood}</span>
          </div>

          <form className="stack-form" onSubmit={handleUpdateSubmit}>
            <label>
              Update title
              <input
                name="title"
                value={draftUpdate.title}
                onChange={handleUpdateChange}
                placeholder="Late afternoon check-in"
              />
            </label>
            <label>
              How was your day?
              <textarea
                name="summary"
                value={draftUpdate.summary}
                onChange={handleUpdateChange}
                placeholder="Write a quick update about your day..."
                rows="4"
              />
            </label>
            <label>
              Problems or mood swings
              <textarea
                name="problems"
                value={draftUpdate.problems}
                onChange={handleUpdateChange}
                placeholder="Mention stress, triggers, or anything you want your partner to know."
                rows="4"
              />
            </label>
            <label>
              Current mood
              <select
                name="mood"
                value={draftUpdate.mood}
                onChange={handleUpdateChange}
              >
                {moods.map((mood) => (
                  <option key={mood} value={mood}>
                    {mood}
                  </option>
                ))}
              </select>
            </label>

            <button className="primary-button" type="submit">
              Save today&apos;s update
            </button>
          </form>
        </article>

        <article className="panel timeline-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Shared feed</p>
              <h2>Recent updates</h2>
            </div>
          </div>

          <div className="timeline">
            {updates.map((entry) => (
              <article className="timeline-entry" key={entry.id}>
                <div className="timeline-topline">
                  <h3>{entry.title}</h3>
                  <span>{entry.timestamp}</span>
                </div>
                <p>{entry.summary}</p>
                <p className="timeline-problems">{entry.problems}</p>
                <div className="timeline-footer">
                  <span className="mood-pill">{entry.mood}</span>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="panel alerts-panel">
          <div className="panel-header">
            <div>
              <p className="section-label">Alert center</p>
              <h2>Attention activity</h2>
            </div>
          </div>

          <div className="alerts-list">
            {alerts.map((alert) => (
              <article className="alert-item" key={alert.id}>
                <div className="alert-topline">
                  <strong>{alert.sender}</strong>
                  <span>{alert.time}</span>
                </div>
                <p>{alert.message}</p>
              </article>
            ))}
          </div>
        </article>
      </section>
    </main>
  )
}

export default App
