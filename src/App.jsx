import { useState, useRef, useCallback } from 'react'
import './index.css'

const VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID
const API_KEY  = import.meta.env.VITE_ELEVENLABS_API_KEY

const SCRIPT = [
  {
    jarvis: "Hey — I'm Jarvis, your athletic trainer's AI assistant. Everything you tell me stays between us and your trainer. How are you feeling today overall?",
    athleteAuto: "Pretty good I guess, ankle's still kind of bothering me though.",
    listenPrompt: "tell me how you're feeling"
  },
  {
    jarvis: "Got it. On a scale of 1 to 10, how would you honestly rate the ankle pain right now — and does it change when you put weight on it?",
    athleteAuto: "Like a 4 I'd say. Yeah it's worse when I'm running cuts.",
    listenPrompt: "rate your pain level"
  },
  {
    jarvis: "A 4 with weight-bearing changes is something we want to track closely. Are you feeling any pressure — from yourself, coaches, anyone — to push through it before it's fully healed?",
    athleteAuto: "I mean, I don't wanna miss games. So yeah, kind of.",
    listenPrompt: "tell me about any pressure you feel"
  },
  {
    jarvis: "That's really honest, and I appreciate you saying that. How's your sleep been the last couple nights?",
    athleteAuto: "Not great, maybe 5 hours last night. Hard to sleep with the ankle.",
    listenPrompt: "describe your sleep"
  },
  {
    jarvis: "Pain disrupting sleep is a recovery blocker — we'll flag that. Last one: how's your head mentally? Stress, anxiety, mood — anything feeling heavy lately?",
    athleteAuto: "Stressed about games but otherwise fine I think.",
    listenPrompt: "describe your mental state"
  },
  {
    jarvis: "Thanks for being real with me — that's exactly what makes this useful. I've put together your report: ankle pain 4/10 with loading, sleep deficit noted, some external pressure around return-to-play. Your trainer will review this today. Take care of yourself.",
    athleteAuto: null,
    listenPrompt: null
  }
]

export default function App() {
  const [screen, setScreen]       = useState('landing')
  const [step, setStep]           = useState(0)
  const [messages, setMessages]   = useState([])
  const [orbState, setOrbState]   = useState('')
  const [orbLabel, setOrbLabel]   = useState('INITIALIZING')
  const [progress, setProgress]   = useState(0)
  const [liveText, setLiveText]   = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking]   = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [voiceHint, setVoiceHint] = useState('tap mic and speak, or press skip')
  const [debugInfo, setDebugInfo] = useState('')

  const recognitionRef    = useRef(null)
  const autoTimerRef      = useRef(null)
  const audioCtxRef       = useRef(null)
  const sourceNodeRef     = useRef(null)
  const stepRef           = useRef(0)
  const isSpeakingRef     = useRef(false)
  const isListeningRef    = useRef(false)

  function addMessage(role, text) {
    setMessages(prev => [...prev, { role, text, id: Date.now() + Math.random() }])
  }

  async function speakText(text, onDone) {
    // Stop any in-progress audio
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
      sourceNodeRef.current = null
    }

    isSpeakingRef.current = true
    setIsSpeaking(true)
    setOrbState('speaking')

    try {
      if (!VOICE_ID || !API_KEY) throw new Error(`Env missing: key=${!!API_KEY} voice=${!!VOICE_ID}`)

      setDebugInfo(`Calling ElevenLabs... key=${API_KEY.slice(0,8)}... voice=${VOICE_ID.slice(0,8)}...`)

      const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        }
      )

      if (!resp.ok) {
        const detail = await resp.text().catch(() => String(resp.status))
        throw new Error(`HTTP ${resp.status}: ${detail}`)
      }

      setDebugInfo('Got audio response, decoding...')
      const arrayBuffer = await resp.arrayBuffer()

      const ctx = audioCtxRef.current
      if (!ctx) throw new Error('AudioContext not created — session not started via button?')
      if (ctx.state === 'suspended') await ctx.resume()

      const decoded = await ctx.decodeAudioData(arrayBuffer)
      const source  = ctx.createBufferSource()
      source.buffer = decoded
      source.connect(ctx.destination)
      sourceNodeRef.current = source

      source.onended = () => {
        sourceNodeRef.current = null
        isSpeakingRef.current = false
        setIsSpeaking(false)
        setOrbState('')
        setOrbLabel('YOUR TURN')
        setDebugInfo('')
        if (onDone) onDone()
      }

      setDebugInfo('Playing...')
      source.start(0)
    } catch (err) {
      console.error('ElevenLabs TTS failed:', err)
      setDebugInfo(`ERROR: ${err.message}`)
      setOrbLabel('VOICE ERROR — tap skip')
      isSpeakingRef.current = false
      setIsSpeaking(false)
      setOrbState('')
      if (onDone) onDone()
    }
  }

  const playStep = useCallback((i) => {
    if (i >= SCRIPT.length) { endSession(); return }
    stepRef.current = i
    setStep(i)
    const pct = Math.round((i / (SCRIPT.length - 1)) * 100)
    setProgress(pct)
    const s = SCRIPT[i]
    setOrbState('speaking')
    setOrbLabel('JARVIS SPEAKING')
    addMessage('jarvis', s.jarvis)

    if (s.listenPrompt === null) {
      speakText(s.jarvis, () => setTimeout(() => endSession(), 1200))
      return
    }

    speakText(s.jarvis, () => {
      setOrbState('')
      setOrbLabel('YOUR TURN')
      setVoiceHint('tap mic and speak, or press skip')
      autoTimerRef.current = setTimeout(() => skipResponse(), 12000)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startSession() {
    // Create AudioContext here — inside a user gesture — so autoplay is unlocked
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    setScreen('session')
    setStep(0)
    stepRef.current = 0
    setMessages([])
    setTimeout(() => playStep(0), 600)
  }

  function endSession() {
    setOrbState('')
    setScreen('complete')
  }

  function submitAthleteResponse(text) {
    clearTimeout(autoTimerRef.current)
    addMessage('athlete', text)
    setLiveText('')
    setIsListening(false)
    isListeningRef.current = false
    setTimeout(() => playStep(stepRef.current + 1), 800)
  }

  function skipResponse() {
    clearTimeout(autoTimerRef.current)
    const s = SCRIPT[stepRef.current]
    if (s && s.athleteAuto) {
      submitAthleteResponse(s.athleteAuto)
    } else {
      playStep(stepRef.current + 1)
    }
  }

  function toggleMic() {
    if (isSpeakingRef.current) return

    if (isListeningRef.current) {
      recognitionRef.current?.stop()
      setIsListening(false)
      isListeningRef.current = false
      setOrbState('')
      setOrbLabel('YOUR TURN')
      return
    }

    clearTimeout(autoTimerRef.current)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setLiveText('Voice not supported — use skip')
      return
    }

    const rec = new SpeechRecognition()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'
    recognitionRef.current = rec

    rec.onstart = () => {
      setIsListening(true)
      isListeningRef.current = true
      setOrbState('listening')
      setOrbLabel('LISTENING...')
    }
    rec.onresult = (e) => {
      let interim = '', final = ''
      for (const r of e.results) {
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }
      setLiveText(interim || final)
      if (final) setTimeout(() => submitAthleteResponse(final), 300)
    }
    rec.onerror = () => {
      setIsListening(false)
      isListeningRef.current = false
      setLiveText('Mic error — use skip')
    }
    rec.onend = () => {
      if (isListeningRef.current) {
        setIsListening(false)
        isListeningRef.current = false
      }
    }
    rec.start()
  }

  return (
    <>
      {/* LANDING */}
      <div id="landing" className={`screen ${screen === 'landing' ? 'active' : ''}`}>
        <div className="landing-bg" />
        <div className="landing-grid" />
        <div className="logo-badge">
          <div className="logo-dot" />
          JARVIS ATHLETIC INTELLIGENCE
        </div>
        <div className="landing-title">Your daily<br /><span>check-in</span> is ready</div>
        <div className="landing-sub">Your athletic trainer has requested your daily wellness report. This takes about 3 minutes and is completely private.</div>
        <div className="athlete-card">
          <div className="athlete-card-label">// ATHLETE SESSION</div>
          <div className="athlete-card-name">Ryker Thompson</div>
          <div className="athlete-card-meta">UVM Lacrosse · #22 · Midfielder</div>
          <div className="athlete-card-injury">⚠ Active: Right ankle sprain — Day 5</div>
        </div>
        <button className="btn-primary" onClick={startSession}>Start Voice Check-In →</button>
        <button className="btn-secondary" onClick={() => setScreen('dashboard')}>View Trainer Dashboard (Demo)</button>
      </div>

      {/* SESSION */}
      <div id="session" className={`screen ${screen === 'session' ? 'active' : ''}`}>
        <div className="session-header">
          <div className="session-logo">JARVIS</div>
          <div className="session-status">
            <div className="status-dot" />
            <span>SESSION ACTIVE</span>
          </div>
        </div>

        <div className="orb-zone">
          <div className="orb-wrap">
            <div className={`orb ${orbState}`} />
            <div className="orb-ring" />
            <div className="orb-ring2" />
          </div>
          <div className="orb-label">{orbLabel}</div>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="transcript-zone" id="transcript">
          {messages.map(m => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="msg-avatar">{m.role === 'jarvis' ? 'J' : 'ME'}</div>
              <div className="msg-bubble">{m.text}</div>
            </div>
          ))}
        </div>

        {debugInfo && (
          <div style={{
            background:'#1a0a0a', border:'1px solid #ff3d3d', color:'#ff8080',
            fontFamily:'monospace', fontSize:'11px', padding:'8px 12px',
            margin:'0 1rem', borderRadius:'8px', wordBreak:'break-all'
          }}>{debugInfo}</div>
        )}

        <div className="session-controls">
          <div className="live-text">{liveText}</div>
          <button
            className={`mic-btn ${isListening ? 'active' : ''}`}
            onClick={toggleMic}
          >
            <span className="mic-icon">🎙</span>
          </button>
          <button className="skip-btn" onClick={skipResponse}>[skip → next]</button>
          <div className="voice-hint">{voiceHint}</div>
        </div>
      </div>

      {/* COMPLETE */}
      <div id="complete" className={`screen ${screen === 'complete' ? 'active' : ''}`}>
        <div className="complete-icon">✓</div>
        <div className="complete-title">Check-in complete</div>
        <div className="complete-sub">Your responses have been analyzed and sent securely to your athletic trainer. You'll hear back if anything needs attention.</div>
        <div className="summary-chips">
          <div className="chip warn">Pain: 4/10 — Ankle</div>
          <div className="chip green">Mental: Stable</div>
          <div className="chip warn">Sleep: Below target</div>
          <div className="chip blue">Practice: Modified OK</div>
        </div>
        <button className="btn-primary" onClick={() => setScreen('dashboard')}>View Trainer Dashboard →</button>
      </div>

      {/* DASHBOARD */}
      <div id="dashboard" className={`screen ${screen === 'dashboard' ? 'active' : ''}`}>
        <div className="dash-header">
          <div>
            <div className="dash-title">Athletic Trainer Dashboard</div>
            <div className="dash-sub">UVM Men's Lacrosse · March 31, 2026</div>
          </div>
          <div className="dash-badge">2 HIGH RISK</div>
        </div>

        <div className="nav-tabs">
          {['overview', 'athletes', 'flags'].map(tab => (
            <button
              key={tab}
              className={`nav-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="dash-body">
          {/* Overview */}
          <div className={`tab-content ${activeTab === 'overview' ? 'active' : ''}`}>
            <div className="dash-section-label">Today's Report</div>
            <div className="dash-stats">
              <div className="stat-card"><div className="stat-val stat-red">2</div><div className="stat-label">HIGH RISK</div></div>
              <div className="stat-card"><div className="stat-val stat-warn">3</div><div className="stat-label">MONITOR</div></div>
              <div className="stat-card"><div className="stat-val stat-green">9</div><div className="stat-label">CLEARED</div></div>
            </div>
            <div className="dash-section-label" style={{ marginTop: '1rem' }}>Priority Alerts</div>
            <div className="athlete-row">
              <div className="athlete-row-top">
                <div><div className="athlete-name">Ryker Thompson</div><div className="athlete-pos">#22 · Midfielder</div></div>
                <div className="risk-badge risk-high">HIGH</div>
              </div>
              <div className="athlete-flags">
                <div className="flag-chip">ankle pain 4/10</div>
                <div className="flag-chip">poor sleep</div>
                <div className="flag-chip">pressure to play</div>
              </div>
              <div className="athlete-insight">Reported increased swelling after morning skate. Expressed hesitation disclosing full pain level in person. Recommend re-evaluation before practice.</div>
            </div>
            <div className="athlete-row">
              <div className="athlete-row-top">
                <div><div className="athlete-name">Cole Brannigan</div><div className="athlete-pos">#8 · Attack</div></div>
                <div className="risk-badge risk-high">HIGH</div>
              </div>
              <div className="athlete-flags">
                <div className="flag-chip">headache persisting</div>
                <div className="flag-chip">light sensitivity</div>
                <div className="flag-chip">concussion protocol</div>
              </div>
              <div className="athlete-insight">Symptom cluster consistent with unresolved concussion. Athlete stated "I feel fine" in person but reported sensitivity and nausea to Jarvis. Do not clear for contact.</div>
            </div>
          </div>

          {/* Athletes */}
          <div className={`tab-content ${activeTab === 'athletes' ? 'active' : ''}`}>
            <div className="dash-section-label">Full Roster — Check-In Status</div>
            {[
              { name: 'Ryker Thompson', pos: '#22 · Midfielder', risk: 'high', flags: ['ankle pain 4/10', 'poor sleep', 'pressure to play'] },
              { name: 'Cole Brannigan', pos: '#8 · Attack', risk: 'high', flags: ['headache', 'light sensitivity'] },
              { name: 'Marcus Webb', pos: '#14 · Defense', risk: 'med', flags: ['knee stiffness', 'fatigue 6/10'] },
              { name: 'Jake Hartley', pos: '#3 · Goalie', risk: 'med', flags: ['shoulder soreness'] },
              { name: 'Derek Foley', pos: '#11 · Midfielder', risk: 'low', flags: ['no concerns'] },
              { name: 'Sam Owusu', pos: '#31 · Defense', risk: 'low', flags: ['no concerns'] },
            ].map(a => (
              <div className="athlete-row" key={a.name}>
                <div className="athlete-row-top">
                  <div><div className="athlete-name">{a.name}</div><div className="athlete-pos">{a.pos}</div></div>
                  <div className={`risk-badge risk-${a.risk}`}>{a.risk === 'high' ? 'HIGH' : a.risk === 'med' ? 'MONITOR' : 'CLEARED'}</div>
                </div>
                <div className="athlete-flags">
                  {a.flags.map(f => <div className="flag-chip" key={f}>{f}</div>)}
                </div>
              </div>
            ))}
          </div>

          {/* Flags */}
          <div className={`tab-content ${activeTab === 'flags' ? 'active' : ''}`}>
            <div className="dash-section-label">AI-Generated Flags</div>
            <div className="athlete-row" style={{ borderLeft: '3px solid var(--danger)' }}>
              <div className="athlete-name" style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--danger)' }}>🚨 Concussion Symptom Cluster</div>
              <div className="athlete-insight" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>Cole Brannigan reported light sensitivity, nausea, and persistent headache. Athlete denied symptoms in-person. Jarvis cross-referenced against concussion symptom profile. Confidence: HIGH. Recommend immediate protocol assessment.</div>
            </div>
            <div className="athlete-row" style={{ borderLeft: '3px solid var(--warn)' }}>
              <div className="athlete-name" style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--warn)' }}>⚠ Return-to-Play Pressure</div>
              <div className="athlete-insight" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>Ryker Thompson verbally indicated feeling pressure to return before feeling ready. This may lead to underreporting. Verify true pain and function levels with objective assessment before return decision.</div>
            </div>
            <div className="athlete-row" style={{ borderLeft: '3px solid var(--warn)' }}>
              <div className="athlete-name" style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--warn)' }}>⚠ Sleep Deficit Pattern</div>
              <div className="athlete-insight" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>3 athletes reported fewer than 6 hours of sleep in the past 48 hours. Correlates with increased injury risk and impaired recovery. Consider team-wide sleep hygiene check-in.</div>
            </div>
            <div className="athlete-row" style={{ borderLeft: '3px solid var(--safe)' }}>
              <div className="athlete-name" style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--safe)' }}>✓ Mental Health Baseline Stable</div>
              <div className="athlete-insight" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>No athletes flagged for acute mental health concerns today. 2 athletes noted moderate pre-game anxiety — within normal range. Continue monitoring.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
