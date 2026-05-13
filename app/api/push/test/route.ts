import webpush from 'web-push'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

function getEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function sendWithRetry(subscription: any, payload: string) {
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await webpush.sendNotification(subscription, payload)
      return { ok: true as const }
    } catch (err: any) {
      const statusCode = err?.statusCode ?? null
      const transient = statusCode === 429 || (typeof statusCode === 'number' && statusCode >= 500)
      if (!transient || attempt === maxAttempts - 1) {
        return { ok: false as const, err }
      }
      await sleep(250 * Math.pow(2, attempt))
    }
  }
  return { ok: false as const, err: new Error('Unknown send failure') }
}

export async function POST(req: Request) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
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
      }
    )

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data: subs, error: subError } = await supabase
      .from('push_subscriptions')
      .select('id, subscription')
      .eq('user_id', userData.user.id)
      .order('last_seen_at', { ascending: false })

    if (subError || !subs || subs.length === 0) {
      return NextResponse.json({ ok: false, error: 'No push subscription found' }, { status: 200 })
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:founder@valiorstudios.com',
      getEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY'),
      getEnv('VAPID_PRIVATE_KEY')
    )

    const now = new Date()
    const id = `test:${now.getTime()}`
    const payload = JSON.stringify({
      title: 'Test notification ✅',
      body: `Sent at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      type: 'reminder',
      id,
      tag: id,
      data: { url: '/settings', type: 'reminder', id, tag: id, badgeIncrement: 1 },
    })

    let sent = 0
    let removed = 0
    for (const row of subs) {
      const result = await sendWithRetry(row.subscription as any, payload)
      if (result.ok) {
        sent += 1
        await supabase
          .from('push_subscriptions')
          .update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', row.id)
        continue
      }
      const err: any = result.err
      const statusCode = err?.statusCode ?? null
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', row.id)
        removed += 1
      }
    }

    return NextResponse.json({ ok: true, sent, removed })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

