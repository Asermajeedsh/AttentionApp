'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Gamepad2, Heart, Loader2, Sparkles, Timer, Trophy, Zap } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createOptionalClient, fetchProfile, getOrCreateGameSession, saveGameSession } from '../../utils/supabase/client'

type GameKey = 'know-me' | 'would-you-rather' | 'reaction-tap' | 'truth-or-dare'

type KnowMeRound = {
  stage: 'compose' | 'waiting_guess' | 'guessing' | 'reveal'
  authorId: string | null
  guesserId: string | null
  prompt: string
  options: string[]
  answer: string
  guess: string
  score: { author: number; guesser: number }
}

type WouldYouRatherRound = {
  stage: 'compose' | 'waiting_partner' | 'picking' | 'reveal'
  authorId: string | null
  responderId: string | null
  prompt: string
  options: [string, string]
  firstPick: string
  secondPick: string
  matches: number
  rounds: number
}

type ReactionRound = {
  stage: 'idle' | 'countdown' | 'ready' | 'result'
  goAt: number | null
  falseStart: string | null
  results: Record<string, number | null>
}

type TruthDareRound = {
  mode: 'truth' | 'dare'
  prompt: string
  lastBy: string | null
}

type OnlineGamesState = {
  kind: 'remote-couples-v1'
  activeGame: GameKey
  knowMe: KnowMeRound
  wouldYouRather: WouldYouRatherRound
  reaction: ReactionRound
  truthDare: TruthDareRound
}

const TRUTHS = [
  'What small thing made you feel loved recently?',
  'What is one memory of us you replay in your head?',
  'What do you wish I understood better about you?',
  'What is your favorite way I give you attention?',
]

const DARES = [
  'Send a 10-second voice note saying what you miss.',
  'Text one very specific compliment.',
  'Plan our next virtual date in one sentence.',
  'Send a selfie with your softest smile.',
]

type SessionRow = {
  id: string
  player1_id: string
  player2_id: string
  game_state: any
  current_turn: 'players' | 'ai'
}

const createRemoteGamesState = (): OnlineGamesState => ({
  kind: 'remote-couples-v1',
  activeGame: 'know-me',
  knowMe: {
    stage: 'compose',
    authorId: null,
    guesserId: null,
    prompt: '',
    options: ['', '', ''],
    answer: '',
    guess: '',
    score: { author: 0, guesser: 0 },
  },
  wouldYouRather: {
    stage: 'compose',
    authorId: null,
    responderId: null,
    prompt: '',
    options: ['', ''],
    firstPick: '',
    secondPick: '',
    matches: 0,
    rounds: 0,
  },
  reaction: {
    stage: 'idle',
    goAt: null,
    falseStart: null,
    results: {},
  },
  truthDare: {
    mode: 'truth',
    prompt: 'Tap Truth or Dare to start.',
    lastBy: null,
  },
})

function isRemoteGamesState(value: any): value is OnlineGamesState {
  return Boolean(value && value.kind === 'remote-couples-v1' && value.knowMe && value.wouldYouRather && value.reaction)
}

function normalizeState(value: any): OnlineGamesState {
  const fresh = createRemoteGamesState()
  if (!isRemoteGamesState(value)) return fresh
  return {
    ...fresh,
    ...value,
    knowMe: { ...fresh.knowMe, ...value.knowMe },
    wouldYouRather: { ...fresh.wouldYouRather, ...value.wouldYouRather },
    reaction: { ...fresh.reaction, ...value.reaction },
    truthDare: { ...fresh.truthDare, ...value.truthDare },
  }
}

function ChoiceButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active?: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[72px] rounded-[22px] px-4 py-4 text-sm font-bold transition duration-300 active:scale-[0.98] disabled:opacity-50 ${
        active ? 'bg-stone-900 text-white shadow-lg shadow-rose-200/40' : 'secondary-romance text-stone-700'
      }`}
    >
      {children}
    </button>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-[18px] border border-white/80 bg-white/78 px-4 py-3 text-sm font-semibold text-stone-700 outline-none transition focus:border-rose-200 focus:ring-2 focus:ring-rose-200/60 placeholder:text-stone-400 disabled:opacity-60"
    />
  )
}

export default function GamesHubClient() {
  const router = useRouter()
  const supabase = useMemo(() => createOptionalClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<SessionRow | null>(null)
  const [me, setMe] = useState<any>(null)
  const [partner, setPartner] = useState<any>(null)

  const [knowPromptDraft, setKnowPromptDraft] = useState('')
  const [knowOptionsDraft, setKnowOptionsDraft] = useState(['', '', ''])
  const [knowAnswerDraft, setKnowAnswerDraft] = useState('')
  const [knowGuessDraft, setKnowGuessDraft] = useState('')

  const [wyrPromptDraft, setWyrPromptDraft] = useState('')
  const [wyrOptionsDraft, setWyrOptionsDraft] = useState(['', ''])
  const [wyrFirstPickDraft, setWyrFirstPickDraft] = useState('')
  const [now, setNow] = useState(Date.now())

  const state = normalizeState(session?.game_state)
  const activeGame = state.activeGame
  const myTurn = session && me ? (session.current_turn === 'players' ? session.player1_id === me.id : session.player2_id === me.id) : false
  const meIsPlayer1 = session && me ? session.player1_id === me.id : false
  const partnerLabel = partner?.name || 'Partner'

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    async function init() {
      if (!supabase) {
        setError('Supabase is not configured.')
        setIsLoading(false)
        return
      }

      const { data, error: userError } = await supabase.auth.getUser()
      if (userError || !data.user) {
        setError('Please sign in to play online.')
        setIsLoading(false)
        return
      }

      try {
        const myProfile = await fetchProfile(data.user.id)
        setMe(myProfile)

        if (!myProfile?.partner_id) {
          setError('Link your partner first to use online games.')
          setIsLoading(false)
          return
        }

        const [partnerProfile, gameSession] = await Promise.all([
          fetchProfile(myProfile.partner_id),
          getOrCreateGameSession(myProfile.partner_id),
        ])

        setPartner(partnerProfile)

        const nextState = normalizeState((gameSession as any).game_state)
        const hydratedSession = { ...(gameSession as any), game_state: nextState }
        setSession(hydratedSession)

        if (!isRemoteGamesState((gameSession as any).game_state)) {
          const saved = await saveGameSession((gameSession as any).id, nextState as any, (gameSession as any).current_turn)
          setSession(saved as any)
        }
      } catch (e: any) {
        setError(e?.message || 'Could not load online games.')
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [supabase])

  useEffect(() => {
    if (!supabase || !session?.id) return

    const channel = supabase
      .channel(`game-session-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_sessions', filter: `id=eq.${session.id}` }, (payload) => {
        const next = payload.new as SessionRow | undefined
        if (!next) return
        setSession({ ...next, game_state: normalizeState(next.game_state) })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session?.id, supabase])

  const persist = useCallback(
    async (nextState: OnlineGamesState, nextTurn?: 'players' | 'ai') => {
      if (!session) return
      const saved = await saveGameSession(session.id, nextState as any, nextTurn ?? session.current_turn)
      setSession(saved as any)
    },
    [session]
  )

  const switchGame = async (game: GameKey) => {
    await persist({ ...state, activeGame: game })
  }

  const submitKnowMeQuestion = async () => {
    if (!me || !partner || !session) return
    const cleanedOptions = knowOptionsDraft.map((item) => item.trim()).filter(Boolean)
    if (!knowPromptDraft.trim() || cleanedOptions.length < 2 || !knowAnswerDraft) return

    const nextState: OnlineGamesState = {
      ...state,
      activeGame: 'know-me',
      knowMe: {
        ...state.knowMe,
        stage: 'waiting_guess',
        authorId: me.id,
        guesserId: partner.id,
        prompt: knowPromptDraft.trim(),
        options: cleanedOptions,
        answer: knowAnswerDraft,
        guess: '',
      },
    }

    await persist(nextState, meIsPlayer1 ? 'ai' : 'players')
    fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'game', content: 'New Know Me question waiting for you.' }),
    }).catch(() => {})
    setKnowPromptDraft('')
    setKnowOptionsDraft(['', '', ''])
    setKnowAnswerDraft('')
  }

  const startGuessingKnowMe = async () => {
    if (!myTurn || !me || state.knowMe.guesserId !== me.id) return
    await persist({ ...state, knowMe: { ...state.knowMe, stage: 'guessing' } })
  }

  const submitKnowGuess = async () => {
    if (!me || state.knowMe.guesserId !== me.id || !knowGuessDraft) return
    const matched = knowGuessDraft === state.knowMe.answer
    const nextState: OnlineGamesState = {
      ...state,
      knowMe: {
        ...state.knowMe,
        stage: 'reveal',
        guess: knowGuessDraft,
        score: {
          author: state.knowMe.score.author,
          guesser: state.knowMe.score.guesser + (matched ? 1 : 0),
        },
      },
    }
    await persist(nextState)
    setKnowGuessDraft('')
  }

  const resetKnowRound = async () => {
    await persist({
      ...state,
      knowMe: {
        ...createRemoteGamesState().knowMe,
        score: state.knowMe.score,
      },
    }, meIsPlayer1 ? 'players' : 'ai')
  }

  const submitWyrQuestion = async () => {
    if (!me || !partner) return
    const prompt = wyrPromptDraft.trim()
    const optionA = wyrOptionsDraft[0].trim()
    const optionB = wyrOptionsDraft[1].trim()
    if (!prompt || !optionA || !optionB || !wyrFirstPickDraft) return

    const nextState: OnlineGamesState = {
      ...state,
      activeGame: 'would-you-rather',
      wouldYouRather: {
        ...state.wouldYouRather,
        stage: 'waiting_partner',
        authorId: me.id,
        responderId: partner.id,
        prompt,
        options: [optionA, optionB],
        firstPick: wyrFirstPickDraft,
        secondPick: '',
      },
    }

    await persist(nextState, meIsPlayer1 ? 'ai' : 'players')
    fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'game', content: 'New Would You Rather round waiting for you.' }),
    }).catch(() => {})
    setWyrPromptDraft('')
    setWyrOptionsDraft(['', ''])
    setWyrFirstPickDraft('')
  }

  const startWyrPick = async () => {
    if (!myTurn || !me || state.wouldYouRather.responderId !== me.id) return
    await persist({ ...state, wouldYouRather: { ...state.wouldYouRather, stage: 'picking' } })
  }

  const submitWyrPick = async (pick: string) => {
    if (!me || state.wouldYouRather.responderId !== me.id) return
    const matched = pick === state.wouldYouRather.firstPick
    const nextState: OnlineGamesState = {
      ...state,
      wouldYouRather: {
        ...state.wouldYouRather,
        stage: 'reveal',
        secondPick: pick,
        matches: state.wouldYouRather.matches + (matched ? 1 : 0),
        rounds: state.wouldYouRather.rounds + 1,
      },
    }
    await persist(nextState)
  }

  const resetWyrRound = async () => {
    await persist({
      ...state,
      wouldYouRather: {
        ...createRemoteGamesState().wouldYouRather,
        matches: state.wouldYouRather.matches,
        rounds: state.wouldYouRather.rounds,
      },
    }, meIsPlayer1 ? 'players' : 'ai')
  }

  const startReaction = async () => {
    if (!me) return
    await persist({
      ...state,
      activeGame: 'reaction-tap',
      reaction: {
        stage: 'countdown',
        goAt: Date.now() + 3000,
        falseStart: null,
        results: { [me.id]: null, ...(partner?.id ? { [partner.id]: null } : {}) },
      },
    })
  }

  const tapReaction = async () => {
    if (!me || !state.reaction.goAt || state.reaction.results[me.id] !== null) return
    const early = Date.now() < state.reaction.goAt
    const results = { ...state.reaction.results, [me.id]: early ? null : Math.max(1, Date.now() - state.reaction.goAt) }
    const bothTapped = Object.values(results).filter((value) => value !== null).length >= 2
    await persist({
      ...state,
      reaction: {
        ...state.reaction,
        stage: early || bothTapped ? 'result' : Date.now() >= state.reaction.goAt ? 'ready' : 'countdown',
        falseStart: early ? 'Too early' : null,
        results,
      },
    })
  }

  const resetReaction = async () => {
    await persist({ ...state, reaction: createRemoteGamesState().reaction })
  }

  const rollTruthDare = async (mode: 'truth' | 'dare') => {
    if (!me) return
    const pool = mode === 'truth' ? TRUTHS : DARES
    const prompt = pool[Math.floor(Math.random() * pool.length)]
    await persist({
      ...state,
      activeGame: 'truth-or-dare',
      truthDare: { mode, prompt, lastBy: me.id },
    })
    fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'game', content: `Truth or Dare: ${prompt}` }),
    }).catch(() => {})
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-mesh flex items-center justify-center px-6">
        <div className="glass-card w-full max-w-sm p-8 text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-rose-400" />
          <div className="mt-3 text-lg font-bold text-stone-700">Connecting your game room...</div>
        </div>
      </div>
    )
  }

  if (error || !session || !me) {
    return (
      <div className="min-h-screen bg-mesh flex items-center justify-center px-6">
        <div className="glass-card w-full max-w-sm p-8 text-center">
          <div className="text-lg font-bold text-stone-800">Online Games</div>
          <div className="mt-3 text-sm font-medium text-stone-600">{error || 'Could not open the room.'}</div>
          <button onClick={() => router.push('/app')} className="primary-romance mt-5 w-full rounded-[22px] px-5 py-4 text-sm font-bold">
            Back to app
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell bg-mesh">
      <main className="flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+110px)] pt-[calc(env(safe-area-inset-top)+20px)] no-scrollbar">
        <header className="glass-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <button onClick={() => router.push('/app')} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-rose-500">
                <ArrowLeft size={16} />
                Back
              </button>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-rose-300">Online games</p>
              <h1 className="mt-2 text-[28px] font-extrabold leading-tight text-gradient">Play from anywhere</h1>
              <p className="mt-2 text-sm font-medium text-stone-600">You write in one city, {partnerLabel} answers in another.</p>
            </div>
            <div className="glass-button flex h-14 w-14 items-center justify-center rounded-[22px] text-rose-400">
              <Gamepad2 size={24} />
            </div>
          </div>
        </header>

        <section className="glass-card mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-stone-800">Room status</div>
              <div className="mt-1 text-xs font-medium text-stone-500">{myTurn ? 'Your turn' : `${partnerLabel}'s turn`}</div>
            </div>
            <div className="rounded-full bg-white/75 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-stone-700">
              Live
            </div>
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          {[
            { key: 'know-me' as const, label: 'Know Me', icon: Sparkles },
            { key: 'would-you-rather' as const, label: 'Rather', icon: Heart },
            { key: 'reaction-tap' as const, label: 'Reaction', icon: Zap },
            { key: 'truth-or-dare' as const, label: 'Truth/Dare', icon: Gamepad2 },
          ].map((item) => {
            const Icon = item.icon
            const active = activeGame === item.key
            return (
              <button
                key={item.key}
                onClick={() => switchGame(item.key)}
                className={`rounded-[24px] p-4 text-left transition duration-300 active:scale-[0.98] ${active ? 'bg-stone-900 text-white shadow-lg shadow-rose-200/40' : 'glass-card text-stone-800'}`}
              >
                <Icon size={18} />
                <div className={`mt-3 text-xs font-bold uppercase tracking-[0.2em] ${active ? 'text-white' : 'text-stone-700'}`}>{item.label}</div>
              </button>
            )
          })}
        </section>

        {activeGame === 'know-me' && (
          <section className="mt-4 space-y-4">
            <div className="glass-card p-6">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.24em] text-rose-300">
                <span>How Well Do You Know Me?</span>
                <span>{state.knowMe.score.guesser} points</span>
              </div>

              {state.knowMe.stage === 'compose' && myTurn && (
                <div className="mt-4 space-y-3">
                  <TextInput value={knowPromptDraft} onChange={setKnowPromptDraft} placeholder="Ask your partner something real" />
                  {knowOptionsDraft.map((option, index) => (
                    <TextInput
                      key={index}
                      value={option}
                      onChange={(value) => setKnowOptionsDraft((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)))}
                      placeholder={`Option ${index + 1}`}
                    />
                  ))}
                  <div className="grid gap-3">
                    {knowOptionsDraft.map((option) =>
                      option.trim() ? (
                        <ChoiceButton key={option} active={knowAnswerDraft === option.trim()} onClick={() => setKnowAnswerDraft(option.trim())}>
                          {knowAnswerDraft === option.trim() ? 'Secret answer selected' : option.trim()}
                        </ChoiceButton>
                      ) : null
                    )}
                  </div>
                  <button onClick={submitKnowMeQuestion} disabled={!knowPromptDraft.trim() || !knowAnswerDraft} className="primary-romance w-full rounded-[22px] px-5 py-4 text-sm font-bold disabled:opacity-50">
                    Send round to {partnerLabel}
                  </button>
                </div>
              )}

              {state.knowMe.stage === 'compose' && !myTurn && (
                <div className="mt-4 rounded-[22px] bg-white/75 p-5 text-sm font-medium text-stone-600">
                  Waiting for {partnerLabel} to write the next question.
                </div>
              )}

              {state.knowMe.stage === 'waiting_guess' && state.knowMe.guesserId === me.id && (
                <div className="mt-4 text-center">
                  <div className="rounded-[22px] bg-white/75 p-5">
                    <p className="text-lg font-extrabold text-stone-800">New question is ready</p>
                    <p className="mt-2 text-sm font-medium text-stone-500">Open it when you&apos;re ready to answer.</p>
                  </div>
                  <button onClick={startGuessingKnowMe} disabled={!myTurn} className="primary-romance mt-4 w-full rounded-[22px] px-5 py-4 text-sm font-bold disabled:opacity-50">
                    Open question
                  </button>
                </div>
              )}

              {state.knowMe.stage === 'waiting_guess' && state.knowMe.authorId === me.id && (
                <div className="mt-4 rounded-[22px] bg-white/75 p-5 text-sm font-medium text-stone-600">
                  Waiting for {partnerLabel} to open your question.
                </div>
              )}

              {state.knowMe.stage === 'guessing' && (
                <div className="mt-4 space-y-4">
                  <h3 className="text-2xl font-extrabold text-stone-800">{state.knowMe.prompt}</h3>
                  <div className="grid gap-3">
                    {state.knowMe.options.map((option) => (
                      <ChoiceButton
                        key={option}
                        active={knowGuessDraft === option}
                        onClick={() => setKnowGuessDraft(option)}
                        disabled={state.knowMe.guesserId !== me.id}
                      >
                        {option}
                      </ChoiceButton>
                    ))}
                  </div>
                  {state.knowMe.guesserId === me.id ? (
                    <button onClick={submitKnowGuess} disabled={!knowGuessDraft} className="primary-romance w-full rounded-[22px] px-5 py-4 text-sm font-bold disabled:opacity-50">
                      Submit answer
                    </button>
                  ) : (
                    <div className="rounded-[22px] bg-white/75 p-5 text-sm font-medium text-stone-600">
                      {partnerLabel} is answering now.
                    </div>
                  )}
                </div>
              )}

              {state.knowMe.stage === 'reveal' && (
                <div className="mt-4 text-center">
                  <div className={`rounded-[24px] px-5 py-5 ${state.knowMe.answer === state.knowMe.guess ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500'}`}>
                    <Trophy className="mx-auto mb-3" size={24} />
                    <p className="text-lg font-extrabold">{state.knowMe.answer === state.knowMe.guess ? 'They got it right' : 'They missed this one'}</p>
                    <p className="mt-2 text-sm font-bold">Answer: {state.knowMe.answer}</p>
                    <p className="mt-1 text-sm font-medium">Guess: {state.knowMe.guess}</p>
                  </div>
                  {myTurn && (
                    <button onClick={resetKnowRound} className="secondary-romance mt-4 w-full rounded-[22px] px-5 py-4 text-sm font-bold text-stone-700">
                      Start next online round
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {activeGame === 'would-you-rather' && (
          <section className="mt-4 space-y-4">
            <div className="glass-card p-6">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.24em] text-rose-300">
                <span>Would You Rather</span>
                <span>{state.wouldYouRather.matches}/{state.wouldYouRather.rounds} matches</span>
              </div>

              {state.wouldYouRather.stage === 'compose' && myTurn && (
                <div className="mt-4 space-y-3">
                  <TextInput value={wyrPromptDraft} onChange={setWyrPromptDraft} placeholder="Write your own dilemma" />
                  <TextInput value={wyrOptionsDraft[0]} onChange={(value) => setWyrOptionsDraft([value, wyrOptionsDraft[1]])} placeholder="Option A" />
                  <TextInput value={wyrOptionsDraft[1]} onChange={(value) => setWyrOptionsDraft([wyrOptionsDraft[0], value])} placeholder="Option B" />
                  <div className="grid gap-3">
                    {wyrOptionsDraft.map((option) =>
                      option.trim() ? (
                        <ChoiceButton key={option} active={wyrFirstPickDraft === option.trim()} onClick={() => setWyrFirstPickDraft(option.trim())}>
                          {wyrFirstPickDraft === option.trim() ? 'Your secret pick' : option.trim()}
                        </ChoiceButton>
                      ) : null
                    )}
                  </div>
                  <button onClick={submitWyrQuestion} disabled={!wyrPromptDraft.trim() || !wyrOptionsDraft[0].trim() || !wyrOptionsDraft[1].trim() || !wyrFirstPickDraft} className="primary-romance w-full rounded-[22px] px-5 py-4 text-sm font-bold disabled:opacity-50">
                    Send to {partnerLabel}
                  </button>
                </div>
              )}

              {state.wouldYouRather.stage === 'compose' && !myTurn && (
                <div className="mt-4 rounded-[22px] bg-white/75 p-5 text-sm font-medium text-stone-600">
                  Waiting for {partnerLabel} to create the next dilemma.
                </div>
              )}

              {state.wouldYouRather.stage === 'waiting_partner' && state.wouldYouRather.responderId === me.id && (
                <div className="mt-4 text-center">
                  <div className="rounded-[22px] bg-white/75 p-5">
                    <p className="text-lg font-extrabold text-stone-800">{state.wouldYouRather.prompt}</p>
                    <p className="mt-2 text-sm font-medium text-stone-500">Your partner already chose in secret.</p>
                  </div>
                  <button onClick={startWyrPick} disabled={!myTurn} className="primary-romance mt-4 w-full rounded-[22px] px-5 py-4 text-sm font-bold disabled:opacity-50">
                    Choose your answer
                  </button>
                </div>
              )}

              {state.wouldYouRather.stage === 'waiting_partner' && state.wouldYouRather.authorId === me.id && (
                <div className="mt-4 rounded-[22px] bg-white/75 p-5 text-sm font-medium text-stone-600">
                  Waiting for {partnerLabel} to open and answer your dilemma.
                </div>
              )}

              {state.wouldYouRather.stage === 'picking' && (
                <div className="mt-4 space-y-4">
                  <h3 className="text-2xl font-extrabold text-stone-800">{state.wouldYouRather.prompt}</h3>
                  <div className="grid gap-3">
                    {state.wouldYouRather.options.map((option) => (
                      <ChoiceButton
                        key={option}
                        onClick={() => submitWyrPick(option)}
                        disabled={state.wouldYouRather.responderId !== me.id}
                      >
                        {option}
                      </ChoiceButton>
                    ))}
                  </div>
                  {state.wouldYouRather.responderId !== me.id && (
                    <div className="rounded-[22px] bg-white/75 p-5 text-sm font-medium text-stone-600">
                      {partnerLabel} is picking now.
                    </div>
                  )}
                </div>
              )}

              {state.wouldYouRather.stage === 'reveal' && (
                <div className="mt-4 text-center">
                  <div className={`rounded-[24px] px-5 py-5 ${state.wouldYouRather.firstPick === state.wouldYouRather.secondPick ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500'}`}>
                    <Heart className="mx-auto mb-3" size={24} fill="currentColor" />
                    <p className="text-lg font-extrabold">{state.wouldYouRather.firstPick === state.wouldYouRather.secondPick ? 'You matched' : 'Different choices this round'}</p>
                    <p className="mt-2 text-sm font-bold">First pick: {state.wouldYouRather.firstPick}</p>
                    <p className="mt-1 text-sm font-medium">Second pick: {state.wouldYouRather.secondPick}</p>
                  </div>
                  {myTurn && (
                    <button onClick={resetWyrRound} className="secondary-romance mt-4 w-full rounded-[22px] px-5 py-4 text-sm font-bold text-stone-700">
                      Start next online round
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {activeGame === 'reaction-tap' && (
          <section className="mt-4 space-y-4">
            <div className="glass-card p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-amber-100 text-amber-500">
                <Timer size={24} />
              </div>
              <h3 className="mt-4 text-2xl font-extrabold text-stone-800">Reaction Tap</h3>
              <p className="mt-2 text-sm font-medium text-stone-600">Shared countdown. Fastest online tap wins.</p>
              <div className="mt-4 rounded-[22px] bg-white/75 p-5">
                <p className="text-4xl font-extrabold text-stone-800">
                  {state.reaction.stage === 'countdown' && state.reaction.goAt ? Math.max(1, Math.ceil((state.reaction.goAt - now) / 1000)) : state.reaction.stage === 'ready' ? 'GO' : state.reaction.stage === 'result' ? 'Result' : 'Ready'}
                </p>
                {state.reaction.falseStart && <p className="mt-2 text-sm font-bold text-rose-500">{state.reaction.falseStart}</p>}
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-bold text-stone-700">
                  <div className="rounded-[18px] bg-white/70 p-3">You: {state.reaction.results[me.id] ? `${state.reaction.results[me.id]}ms` : '--'}</div>
                  <div className="rounded-[18px] bg-white/70 p-3">{partnerLabel}: {partner?.id && state.reaction.results[partner.id] ? `${state.reaction.results[partner.id]}ms` : '--'}</div>
                </div>
              </div>
              {state.reaction.stage === 'idle' || state.reaction.stage === 'result' ? (
                <button onClick={state.reaction.stage === 'idle' ? startReaction : resetReaction} className="primary-romance mt-4 w-full rounded-[22px] px-5 py-4 text-sm font-bold">
                  {state.reaction.stage === 'idle' ? 'Start countdown' : 'Reset'}
                </button>
              ) : (
                <button onClick={tapReaction} className="primary-romance mt-4 w-full rounded-[22px] px-5 py-4 text-sm font-bold">
                  Tap
                </button>
              )}
            </div>
          </section>
        )}

        {activeGame === 'truth-or-dare' && (
          <section className="mt-4 space-y-4">
            <div className="glass-card p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-rose-100 text-rose-500">
                <Heart size={24} fill="currentColor" />
              </div>
              <h3 className="mt-4 text-2xl font-extrabold text-stone-800">Truth or Dare</h3>
              <div className="mt-4 rounded-[22px] bg-white/75 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-rose-300">{state.truthDare.mode}</p>
                <p className="mt-3 text-lg font-extrabold text-stone-800">{state.truthDare.prompt}</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button onClick={() => rollTruthDare('truth')} className="secondary-romance rounded-[22px] px-5 py-4 text-sm font-bold text-stone-700">Truth</button>
                <button onClick={() => rollTruthDare('dare')} className="primary-romance rounded-[22px] px-5 py-4 text-sm font-bold">Dare</button>
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+95px)] left-1/2 z-50 w-[88%] max-w-sm -translate-x-1/2">
            <div className="rounded-[24px] bg-stone-900/88 px-5 py-4 text-center text-sm font-semibold text-white shadow-2xl backdrop-blur-xl">
              {error}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
