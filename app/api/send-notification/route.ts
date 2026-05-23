import webpush from 'web-push'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

function getEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

function normalizeType(input: unknown) {
  const raw = typeof input === 'string' ? input : ''
  if (raw === 'pulse') return 'beep'
  if (raw === 'message') return 'dm'
  if (raw === 'dm') return 'dm'
  if (raw === 'beep') return 'beep'
  if (raw === 'mood') return 'mood'
  if (raw === 'invite') return 'invite'
  return 'dm'
}

function copyFor(type: string, content: string, senderName: string) {
  if (type === 'beep') {
    return {
      title: 'You just received a Pulse 💗',
      body: content || `${senderName} is thinking about you.`,
      url: '/app',
      badgeIncrement: 1,
    }
  }
  if (type === 'mood') {
    return {
      title: 'A mood check-in 🌙',
      body: content || `${senderName} shared how they’re feeling.`,
      url: '/mood',
      badgeIncrement: 1,
    }
  }
  if (type === 'invite') {
    return {
      title: 'Partner invite 💞',
      body: content || `${senderName} invited you`,
      url: '/settings',
      badgeIncrement: 1,
    }
  }
  return {
    title: 'A soft message 💬',
    body: content || `${senderName} sent you a message.`,
    url: '/chat',
    badgeIncrement: 1,
  }
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
    const type = normalizeType(body?.type)
    const content = typeof body?.content === 'string' ? body.content.slice(0, 500) : ''
    const receiverId = typeof body?.receiverId === 'string' ? body.receiverId : null
    const clientUrl = typeof body?.url === 'string' ? body.url : null
    const dedupeKey = typeof body?.dedupeKey === 'string' ? body.dedupeKey : null

    const senderId = auth.user.id
    const { data: sender, error: senderError } = await supabase
      .from('users')
      .select('partner_id, name')
      .eq('id', senderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (senderError) return NextResponse.json({ ok: false, error: senderError.message }, { status: 500 })
    const partnerId = sender?.partner_id as string | null | undefined

    const targetUserId = receiverId || partnerId
    if (!targetUserId) return NextResponse.json({ ok: false, error: 'No partner connected' }, { status: 400 })
    if (partnerId && targetUserId !== partnerId) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const admin = serviceRoleKey
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
      : null

    const { data: subs, error: subError } = await (admin
      ? admin.from('push_subscriptions').select('id, subscription').eq('user_id', targetUserId).order('last_seen_at', { ascending: false })
      : supabase.from('push_subscriptions').select('id, subscription').eq('user_id', targetUserId).order('last_seen_at', { ascending: false }))

    if (subError || !subs || subs.length === 0) {
      return NextResponse.json({ ok: false, error: 'No push subscription for receiver' }, { status: 200 })
    }

    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:founder@valiorstudios.com', getEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY'), getEnv('VAPID_PRIVATE_KEY'))

    const senderName = sender?.name || 'Your person'
    const chosen = copyFor(type, content, senderName)
    const url = clientUrl || chosen.url
    const id = dedupeKey || `${type}:${senderId}:${targetUserId}:${Date.now()}`
    const tag = `${type}:${targetUserId}:${senderId}`

    const payload = JSON.stringify({
      title: chosen.title,
      body: chosen.body,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      type,
      id,
      tag,
      data: { url, type, id, tag, badgeIncrement: chosen.badgeIncrement ?? 1 },
    })

    let sent = 0
    let removed = 0
    for (const row of subs as any[]) {
      const result = await sendWithRetry(row.subscription as any, payload)
      if (result.ok) {
        sent += 1
        await (admin ?? supabase)
          .from('push_subscriptions')
          .update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', row.id)
        continue
      }
      const err: any = result.err
      const statusCode = err?.statusCode ?? null
      if (statusCode === 404 || statusCode === 410) {
        await (admin ?? supabase).from('push_subscriptions').delete().eq('id', row.id)
        removed += 1
      }
    }

    return NextResponse.json({ ok: true, sent, removed })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Notification failed' }, { status: 500 })
  }
}
