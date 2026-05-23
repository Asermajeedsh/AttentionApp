import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
    })

    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
    const subscription = body?.subscription ?? null
    if (!endpoint || !subscription) {
      return NextResponse.json({ ok: false, error: 'Missing subscription' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const userAgent = req.headers.get('user-agent') || null

    const { error } = await supabase.from('push_subscriptions').upsert(
      [
        {
          user_id: auth.user.id,
          endpoint,
          subscription,
          user_agent: userAgent,
          updated_at: now,
          last_seen_at: now,
        },
      ],
      { onConflict: 'user_id,endpoint' }
    )

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

