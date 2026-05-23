'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Heart, Loader2 } from 'lucide-react'
import { createOptionalClient, hasSupabaseBrowserEnv } from '../../utils/supabase/client'

export default function SignInPage() {
  const router = useRouter()
  const supabase = useMemo(() => createOptionalClient(), [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/app')
    })
  }, [router, supabase])

  async function signIn() {
    if (!supabase) {
      router.push('/app')
      return
    }
    setBusy(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (authError) {
      setError(authError.message)
      return
    }
    router.push('/app')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-pulse px-6 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-80px)] max-w-md flex-col justify-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-[30px] bg-gradient-to-br from-pink-500 to-violet-500 text-white shadow-2xl shadow-pink-200">
            <Heart className="h-9 w-9" fill="currentColor" />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-[#4b3445]">Pulse</h1>
          <p className="mt-2 text-sm font-bold text-[#977a8f]">A heartbeat shared between two people.</p>
        </div>

        <div className="pulse-card space-y-4 p-6">
          {!hasSupabaseBrowserEnv() && (
            <div className="rounded-2xl bg-white/55 px-4 py-3 text-xs font-bold leading-5 text-[#8f6680]">
              Demo mode: configure Supabase env vars to enable real auth.
            </div>
          )}
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="h-14 w-full rounded-2xl border border-white/60 bg-white/55 px-4 text-sm font-bold text-[#57384d] outline-none focus:ring-2 focus:ring-pink-300"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            className="h-14 w-full rounded-2xl border border-white/60 bg-white/55 px-4 text-sm font-bold text-[#57384d] outline-none focus:ring-2 focus:ring-pink-300"
          />
          <button onClick={signIn} disabled={busy} className="pulse-primary-button h-14 w-full justify-center">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
          </button>
          {error && <p className="text-center text-xs font-bold text-pink-600">{error}</p>}
        </div>

        <p className="mt-6 text-center text-sm font-bold text-[#977a8f]">
          New here? <a className="text-pink-500" href="/signup">Create your private space</a>
        </p>
      </div>
    </main>
  )
}
