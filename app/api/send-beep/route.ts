import webpush from 'web-push'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

function getEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }
  return value
}

export async function POST() {
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

    const senderId = userData.user.id
    console.log('[push] send-beep start', { senderId })
    const { data: senderProfile, error: senderProfileError } = await supabase
      .from('users')
      .select('partner_id, name')
      .eq('id', senderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (senderProfileError) {
      console.error('[push] senderProfile error', senderProfileError)
      return NextResponse.json({ ok: false, error: senderProfileError.message }, { status: 500 })
    }

    const partnerId = senderProfile?.partner_id as string | null | undefined
    if (!partnerId) {
      console.warn('[push] no partnerId for sender', { senderId })
      return NextResponse.json({ ok: false, error: 'No partner connected' }, { status: 400 })
    }
    console.log('[push] partnerId', { partnerId })

    const { data: partnerProfile } = await supabase
      .from('users')
      .select('name')
      .eq('id', partnerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: subs, error: subError } = await supabase
      .from('push_subscriptions')
      .select('id, subscription')
      .eq('user_id', partnerId)
      .order('last_seen_at', { ascending: false })

    if (subError || !subs || subs.length === 0) {
      console.warn('[push] no subscription', { partnerId, hasRow: Boolean(subs?.length), subError })
      return NextResponse.json({ ok: false, error: 'No push subscription for partner' }, { status: 200 })
    }

    const publicKey = getEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
    const privateKey = getEnv('VAPID_PRIVATE_KEY')
    const subject = process.env.VAPID_SUBJECT || 'mailto:founder@valiorstudios.com'

    webpush.setVapidDetails(subject, publicKey, privateKey)

    const senderName = senderProfile?.name || 'Your partner'
    const payload = JSON.stringify({
      title: 'Beep ❤️',
      body: `${senderName} needs your attention right now`,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      data: { url: '/app' },
    })

    let sent = 0
    let removed = 0

    for (const row of subs) {
      const endpoint = (row.subscription as any)?.endpoint
      console.log('[push] sending', { endpointHost: typeof endpoint === 'string' ? new URL(endpoint).host : null })
      try {
        await webpush.sendNotification(row.subscription as any, payload)
        sent += 1
      } catch (err: any) {
        const statusCode = err?.statusCode ?? null
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', row.id)
          removed += 1
        } else {
          const body = typeof err?.body === 'string' ? err.body : null
          const message = err?.message ?? 'Push send failed'
          console.error('[push] sendNotification failed', { statusCode, message, body })
        }
      }
    }

    return NextResponse.json({ ok: true, sent, removed })
  } catch (e: any) {
    console.error('[push] send-beep unexpected error', e)
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
