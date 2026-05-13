'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Gem, Loader2, Sparkles } from 'lucide-react'
import { createOptionalClient, joinWaitlist } from '../../utils/supabase/client'

export default function PremiumPage() {
  const router = useRouter()
  const supabase = useMemo(() => createOptionalClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      if (!supabase) {
        setError('Supabase is not configured.')
        setIsLoading(false)
        return
      }

      const { data } = await supabase.auth.getUser()
      const user = data.user
      setIsLoggedIn(Boolean(user))
      setEmail(user?.email || '')
      setIsLoading(false)
    }

    init().catch((e) => {
      console.error('[premium] init error', e)
      setError('Failed to load.')
      setIsLoading(false)
    })
  }, [supabase])

  async function submit() {
    if (status === 'submitting') return
    setError(null)
    setStatus('submitting')

    try {
      await joinWaitlist({ email: isLoggedIn ? undefined : email })
      setStatus('success')
    } catch (e: any) {
      setError(e?.message || 'Failed to join waitlist.')
      setStatus('idle')
    }
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
          <h1 className="text-xl font-bold tracking-tight text-gradient">Premium</h1>
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Coming soon</p>
        </div>
        <div className="w-11" />
      </header>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
        </div>
      ) : (
        <main className="flex-1 flex flex-col px-8 pb-28 z-10 space-y-6 overflow-y-auto no-scrollbar">
          <div className="glass-card p-10 space-y-4 animate-in zoom-in-95 duration-700">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-[18px] gradient-rose text-white shadow-xl shadow-rose-200">
                <Gem size={22} />
              </div>
              <div>
                <h2 className="text-[20px] font-bold text-stone-800">Premium Coming Soon 💎</h2>
                <p className="text-[13px] text-stone-500 font-medium">
                  We&apos;re working on Premium features to enhance your experience.
                </p>
              </div>
            </div>

            <div className="pt-2 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-rose-400" />
                <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Upcoming features</p>
              </div>
              <ul className="space-y-2 text-[14px] text-stone-700 font-medium">
                <li>• No ads</li>
                <li>• Unlimited beeps</li>
                <li>• Unlock mini games</li>
                <li>• Priority notifications</li>
              </ul>
            </div>
          </div>

          <div className="glass-card p-8 space-y-4 animate-in slide-in-from-bottom-6 duration-700">
            <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Waitlist</p>

            {status === 'success' ? (
              <div className="bg-white/40 border border-white/60 rounded-[22px] p-5 text-center">
                <p className="text-[14px] text-stone-800 font-semibold">You&apos;ll be notified when Premium is ready!</p>
              </div>
            ) : (
              <>
                {!isLoggedIn && (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-4 bg-white/50 border border-white/60 rounded-[20px] focus:ring-2 focus:ring-rose-400 outline-none transition-all placeholder:text-stone-300 text-stone-700"
                    placeholder="your@email.com"
                  />
                )}

                <button
                  onClick={submit}
                  disabled={status === 'submitting' || (!isLoggedIn && !email.trim())}
                  className="w-full py-4 gradient-rose text-white font-bold rounded-[20px] transition-all shadow-xl shadow-rose-200 active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {status === 'submitting' ? <Loader2 className="animate-spin" size={18} /> : 'Notify me when Premium launches'}
                </button>
              </>
            )}

            {error && (
              <p className="text-rose-500 text-[13px] text-center font-medium">{error}</p>
            )}
          </div>
        </main>
      )}
    </div>
  )
}
