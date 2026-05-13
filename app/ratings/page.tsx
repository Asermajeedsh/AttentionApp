'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react'
import HeartIcon from '../HeartIcon'
import {
  createOptionalClient,
  ensureProfile,
  fetchProfile,
  fetchLatestMoodForUser,
  upsertMoodEntry,
  type MoodValue,
  fetchLatestRatingForUser,
  submitPartnerRating,
  type PartnerRating,
} from '../../utils/supabase/client'

const MOODS: { key: MoodValue; label: string }[] = [
  { key: 'happy', label: 'Happy' },
  { key: 'good', label: 'Good' },
  { key: 'overstimulated', label: 'Overstimulated' },
  { key: 'stressed', label: 'Stressed' },
  { key: 'sad', label: 'Sad' },
  { key: 'angry', label: 'Angry' },
  { key: 'tired', label: 'Tired' },
]

const CATEGORIES = [
  { key: 'love', label: 'Love' },
  { key: 'attention', label: 'Attention' },
  { key: 'compliments', label: 'Compliments' },
  { key: 'disrespect', label: 'Respect' },
  { key: 'neglect', label: 'Effort' },
] as const

type CategoryKey = typeof CATEGORIES[number]['key']

function clampScore(v: number) {
  return Math.max(1, Math.min(5, v))
}

function computePerformance(r: PartnerRating) {
  const love = clampScore(r.love)
  const attention = clampScore(r.attention)
  const compliments = clampScore(r.compliments)
  const neglect = clampScore(r.neglect)
  const disrespect = clampScore(r.disrespect)

  const adjusted = (love + attention + compliments + (6 - neglect) + (6 - disrespect)) / 5

  const grade =
    adjusted >= 4.6
      ? 'Outstanding'
      : adjusted >= 4.1
        ? 'Great'
        : adjusted >= 3.4
          ? 'Good'
          : adjusted >= 2.6
            ? 'Needs Work'
            : 'Emergency'

  return { score: adjusted, grade }
}

function Hearts({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1
        const active = n <= value
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`p-1 rounded-full transition-all active:scale-95 ${active ? 'text-rose-500' : 'text-stone-300'}`}
            aria-label={`${n} hearts`}
          >
            <HeartIcon className="w-6 h-6" fill={active ? 'currentColor' : 'none'} />
          </button>
        )
      })}
    </div>
  )
}

export default function RatingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createOptionalClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [me, setMe] = useState<any>(null)
  const [partner, setPartner] = useState<any>(null)

  const [tab, setTab] = useState<'mood' | 'ratings'>('mood')

  const [myMood, setMyMood] = useState<MoodValue>('good')
  const [myNote, setMyNote] = useState('')
  const [myMoodSavedAt, setMyMoodSavedAt] = useState<string | null>(null)
  const [partnerMood, setPartnerMood] = useState<any>(null)

  const [scores, setScores] = useState<Record<CategoryKey, number>>({
    love: 4,
    attention: 4,
    neglect: 1,
    disrespect: 1,
    compliments: 4,
  })
  const [specialComments, setSpecialComments] = useState('')
  const [isSubmittingRating, setIsSubmittingRating] = useState(false)
  const [ratingSavedAt, setRatingSavedAt] = useState<string | null>(null)
  const [latestRatingOfMe, setLatestRatingOfMe] = useState<PartnerRating | null>(null)

  useEffect(() => {
    async function init() {
      if (!supabase) {
        setError('Supabase is not configured.')
        setIsLoading(false)
        return
      }

      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        setIsLoading(false)
        router.push('/signin')
        return
      }

      try {
        const myProfile = await ensureProfile(data.user)
        setMe(myProfile)

        const partnerId = myProfile?.partner_id ?? null
        if (partnerId) {
          const partnerProfile = await fetchProfile(partnerId)
          setPartner(partnerProfile)
        } else {
          setPartner(null)
        }

        const myLatestMood = await fetchLatestMoodForUser(myProfile.id)
        if (myLatestMood) {
          setMyMood(myLatestMood.mood)
          setMyNote(myLatestMood.note || '')
          setMyMoodSavedAt(myLatestMood.updated_at || myLatestMood.created_at)
        }

        if (partnerId) {
          const partnerLatestMood = await fetchLatestMoodForUser(partnerId)
          setPartnerMood(partnerLatestMood)
        } else {
          setPartnerMood(null)
        }

        const latest = await fetchLatestRatingForUser(myProfile.id)
        setLatestRatingOfMe(latest)
      } catch (e: any) {
        setError(e?.message || 'Failed to load')
      } finally {
        setIsLoading(false)
      }
    }

    init()
  }, [router, supabase])

  async function saveMood() {
    setError(null)
    try {
      const saved = await upsertMoodEntry(myMood, myNote)
      setMyMoodSavedAt(saved.updated_at || saved.created_at)
      if (partner?.id) {
        const partnerLatestMood = await fetchLatestMoodForUser(partner.id)
        setPartnerMood(partnerLatestMood)
      }
      fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'mood', content: `Mood: ${myMood}` }),
      }).catch(() => {})
    } catch (e: any) {
      setError(e?.message || 'Failed to save mood')
    }
  }

  async function submitRating() {
    if (!partner?.id) return
    setIsSubmittingRating(true)
    setError(null)
    try {
      await submitPartnerRating({
        ratedId: partner.id,
        love: scores.love,
        attention: scores.attention,
        neglect: scores.neglect,
        disrespect: scores.disrespect,
        compliments: scores.compliments,
        comments: specialComments,
      })
      setRatingSavedAt(new Date().toISOString())
      if (me?.id) {
        const latest = await fetchLatestRatingForUser(me.id)
        setLatestRatingOfMe(latest)
      }
      fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rating', content: 'A new relationship rating was shared.' }),
      }).catch(() => {})
    } catch (e: any) {
      setError(e?.message || 'Failed to submit rating')
    } finally {
      setIsSubmittingRating(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
          <p className="text-rose-300 font-medium animate-pulse">Loading ratings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-mesh flex flex-col max-w-md mx-auto relative overflow-hidden">
      <header className="px-8 pt-10 pb-6 flex justify-between items-center z-10">
        <button
          onClick={() => router.push('/app')}
          className="p-3 glass-button text-rose-400 hover:text-rose-600 shadow-rose-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-gradient">Ratings</h1>
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">
            {partner?.name ? `With ${partner.name}` : 'Not linked yet'}
          </p>
        </div>
        <div className="w-11" />
      </header>

      <main className="flex-1 flex flex-col px-8 pb-28 z-10 space-y-6 overflow-y-auto no-scrollbar">
        <div className="glass-card p-2 flex gap-2">
          <button
            onClick={() => setTab('mood')}
            className={`flex-1 py-3 rounded-[18px] text-[12px] font-bold uppercase tracking-widest transition-all ${
              tab === 'mood' ? 'gradient-rose text-white shadow-md' : 'text-stone-500'
            }`}
          >
            Mood
          </button>
          <button
            onClick={() => setTab('ratings')}
            className={`flex-1 py-3 rounded-[18px] text-[12px] font-bold uppercase tracking-widest transition-all ${
              tab === 'ratings' ? 'gradient-rose text-white shadow-md' : 'text-stone-500'
            }`}
          >
            Hearts
          </button>
        </div>

        {tab === 'mood' && (
          <div className="space-y-6">
            <div className="glass-card p-8 space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-rose-400" />
                <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">How was your day?</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'History', value: myMoodSavedAt ? 'Today' : 'Empty' },
                  { label: 'Partner', value: partnerMood ? 'Shared' : 'Waiting' },
                  { label: 'Streak', value: myMoodSavedAt ? '1 day' : 'Start' },
                ].map((item) => (
                  <div key={item.label} className="rounded-[18px] bg-white/55 border border-white/70 px-3 py-3 text-center">
                    <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{item.label}</p>
                    <p className="mt-1 text-[12px] font-bold text-stone-700">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {MOODS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMyMood(m.key)}
                    className={`px-4 py-3 rounded-[20px] text-[13px] font-medium transition-all ${
                      myMood === m.key
                        ? 'gradient-rose text-white shadow-md'
                        : 'bg-white/50 text-stone-600 border border-white/60 hover:bg-white/80'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <textarea
                value={myNote}
                onChange={(e) => setMyNote(e.target.value)}
                rows={4}
                className="w-full p-4 bg-white/50 border border-white/60 rounded-[20px] focus:ring-2 focus:ring-rose-400 outline-none transition-all placeholder:text-stone-300 text-stone-700"
                placeholder="Talk about your day..."
              />

              <button
                onClick={saveMood}
                className="w-full py-4 gradient-rose text-white font-bold rounded-[20px] transition-all shadow-xl shadow-rose-200 active:scale-95"
              >
                Save
              </button>

              {myMoodSavedAt && (
                <p className="text-[11px] text-stone-400 font-medium text-center">
                  Saved {new Date(myMoodSavedAt).toLocaleString()}
                </p>
              )}
            </div>

            <div className="glass-card p-8 space-y-3">
              <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Partner mood</p>
              {partnerMood ? (
                <div className="space-y-2">
                  <p className="text-[14px] font-semibold text-stone-800">
                    {MOODS.find((m) => m.key === partnerMood.mood)?.label || partnerMood.mood}
                  </p>
                  {partnerMood.note && (
                    <p className="text-[13px] text-stone-600 font-medium leading-relaxed">{partnerMood.note}</p>
                  )}
                  <p className="text-[11px] text-stone-400 font-medium">
                    {new Date(partnerMood.mood_date).toLocaleDateString()}
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-stone-500 font-medium">No mood shared yet.</p>
              )}
            </div>
          </div>
        )}

        {tab === 'ratings' && (
          <div className="space-y-6">
            <div className="glass-card p-8 space-y-5">
              <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Rate your partner</p>
              <div className="rounded-[18px] bg-white/55 border border-white/70 px-4 py-3 text-[12px] font-semibold text-stone-600">
                Weekly trend: {latestRatingOfMe ? computePerformance(latestRatingOfMe).grade : 'No ratings yet'}
              </div>
              {!partner?.id ? (
                <p className="text-[13px] text-stone-500 font-medium">Link with your partner to rate.</p>
              ) : (
                <>
                  <div className="space-y-4">
                    {CATEGORIES.map((c) => (
                      <div key={c.key} className="flex items-center justify-between gap-4">
                        <p className="text-[13px] font-semibold text-stone-700">{c.label}</p>
                        <Hearts
                          value={c.key === 'neglect' || c.key === 'disrespect' ? 6 - scores[c.key] : scores[c.key]}
                          onChange={(next) => setScores((prev) => ({ ...prev, [c.key]: c.key === 'neglect' || c.key === 'disrespect' ? 6 - next : next }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Special comments</p>
                    <textarea
                      value={specialComments}
                      onChange={(e) => setSpecialComments(e.target.value)}
                      rows={3}
                      className="w-full p-4 bg-white/50 border border-white/60 rounded-[20px] focus:ring-2 focus:ring-rose-400 outline-none transition-all placeholder:text-stone-300 text-stone-700"
                      placeholder="Anything important..."
                    />
                  </div>

                  <button
                    onClick={submitRating}
                    disabled={isSubmittingRating}
                    className="w-full py-4 gradient-rose text-white font-bold rounded-[20px] transition-all shadow-xl shadow-rose-200 active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {isSubmittingRating ? <Loader2 className="animate-spin" size={18} /> : 'Submit'}
                  </button>

                  {ratingSavedAt && (
                    <p className="text-[11px] text-stone-400 font-medium text-center">
                      Sent {new Date(ratingSavedAt).toLocaleString()}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="glass-card p-8 space-y-4">
              <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Latest rating of you</p>
              {latestRatingOfMe ? (
                (() => {
                  const perf = computePerformance(latestRatingOfMe)
                  return (
                    <div className="space-y-3">
                      <div className="flex items-baseline justify-between">
                        <p className="text-[16px] font-bold text-stone-800">{perf.grade}</p>
                        <p className="text-[12px] font-bold text-rose-400">
                          {perf.score.toFixed(2)} / 5.00
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {CATEGORIES.map((c) => (
                          <div key={c.key} className="bg-white/40 border border-white/60 rounded-[18px] p-4">
                            <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                              {c.label}
                            </p>
                            <div className="flex items-center gap-1 mt-2">
                              {Array.from({ length: 5 }).map((_, i) => {
                                const n = i + 1
                                const raw = (latestRatingOfMe as any)[c.key] as number
                                const v = c.key === 'neglect' || c.key === 'disrespect' ? 6 - raw : raw
                                const active = n <= clampScore(v)
                                return (
                                  <HeartIcon
                                    key={n}
                                    className={`w-4 h-4 ${active ? 'text-rose-500' : 'text-stone-200'}`}
                                    fill={active ? 'currentColor' : 'none'}
                                  />
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      {latestRatingOfMe.comments && (
                        <div className="bg-white/40 border border-white/60 rounded-[18px] p-4">
                          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                            Special comments
                          </p>
                          <p className="text-[13px] text-stone-700 font-medium mt-2 leading-relaxed">
                            {latestRatingOfMe.comments}
                          </p>
                        </div>
                      )}
                      <p className="text-[11px] text-stone-400 font-medium">
                        {new Date(latestRatingOfMe.created_at).toLocaleString()}
                      </p>
                    </div>
                  )
                })()
              ) : (
                <p className="text-[13px] text-stone-500 font-medium">No rating yet.</p>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[80%] z-50 animate-in slide-in-from-bottom-10">
            <div className="bg-rose-950/80 text-white px-6 py-3 rounded-full text-sm font-medium text-center backdrop-blur-md shadow-2xl">
              {error}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
