import webpush from 'web-push'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }
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

type PrefsRow = {
  mute_all: boolean
  quiet_hours_enabled: boolean
  quiet_start_minutes: number
  quiet_end_minutes: number
  timezone: string
  notify_call: boolean
  calls_bypass_quiet_hours: boolean
}

function getTzMinutes(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
    return hh * 60 + mm
  } catch {
    return null
  }
}

function isQuietNow(prefs: Pick<PrefsRow, 'quiet_hours_enabled' | 'quiet_start_minutes' | 'quiet_end_minutes' | 'timezone'>, date: Date) {
  if (!prefs.quiet_hours_enabled) return false
  const now = getTzMinutes(date, prefs.timezone) ?? getTzMinutes(date, 'UTC')
  if (now === null) return false
  const start = Math.max(0, Math.min(1439, Math.floor(prefs.quiet_start_minutes)))
  const end = Math.max(0, Math.min(1439, Math.floor(prefs.quiet_end_minutes)))
  if (start === end) return true
  if (start < end) return now >= start && now < end
  return now >= start || now < end
}

function defaultPrefs(): PrefsRow {
  return {
    mute_all: false,
    quiet_hours_enabled: false,
    quiet_start_minutes: 1320,
    quiet_end_minutes: 480,
    timezone: 'UTC',
    notify_call: true,
    calls_bypass_quiet_hours: true,
  }
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

    const body = await req.json().catch(() => ({}))
    const callId = typeof body?.callId === 'string' ? body.callId : ''
    const receiverId = typeof body?.receiverId === 'string' ? body.receiverId : (typeof body?.calleeId === 'string' ? body.calleeId : '')
    const callType = body?.callType === 'video' ? 'video' : 'audio'

    if (!callId || !receiverId) {
      return NextResponse.json({ ok: false, error: 'Missing callId/receiverId' }, { status: 400 })
    }

    const senderId = userData.user.id

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const admin = serviceRoleKey
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
      : null

    const { data: senderProfile } = await supabase
      .from('users')
      .select('name')
      .eq('id', senderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const subsClient = admin ?? supabase
    const { data: subs, error: subError } = await subsClient
      .from('push_subscriptions')
      .select('id, subscription')
      .eq('user_id', receiverId)
      .order('last_seen_at', { ascending: false })

    if (subError || !subs || subs.length === 0) {
      return NextResponse.json({ ok: false, error: 'No push subscription for receiver' }, { status: 200 })
    }

    let prefs = defaultPrefs()
    if (admin) {
      const { data: prefRow } = await admin
        .from('notification_preferences')
        .select('mute_all,quiet_hours_enabled,quiet_start_minutes,quiet_end_minutes,timezone,notify_call,calls_bypass_quiet_hours')
        .eq('user_id', receiverId)
        .limit(1)
        .maybeSingle()
      if (prefRow) prefs = { ...prefs, ...(prefRow as any) }
    }

    if (prefs.mute_all || !prefs.notify_call) {
      return NextResponse.json({ ok: true, sent: 0, removed: 0, suppressed: 'disabled' })
    }
    if (isQuietNow(prefs, new Date()) && !prefs.calls_bypass_quiet_hours) {
      return NextResponse.json({ ok: true, sent: 0, removed: 0, suppressed: 'quiet_hours' })
    }

    const publicKey = getEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
    const privateKey = getEnv('VAPID_PRIVATE_KEY')
    const subject = process.env.VAPID_SUBJECT || 'mailto:founder@valiorstudios.com'

    webpush.setVapidDetails(subject, publicKey, privateKey)

    const callerName = senderProfile?.name || 'Your partner'
    const id = `call:${callId}`
    const tag = `call:${callId}`
    const payload = JSON.stringify({
      title: callType === 'video' ? 'Incoming video call' : 'Incoming audio call',
      body: `${callerName} is calling you`,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      type: 'call',
      id,
      tag,
      data: { url: `/calls?call=${encodeURIComponent(callId)}`, type: 'call', id, tag, badgeIncrement: 1, callId },
    })

    let sent = 0
    let removed = 0
    for (const row of subs) {
      const result = await sendWithRetry(row.subscription as any, payload)
      if (result.ok) {
        sent += 1
        if (admin) {
          await admin
            .from('push_subscriptions')
            .update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', row.id)
        }
        continue
      }
      const err: any = result.err
      const statusCode = err?.statusCode ?? null
      if (statusCode === 404 || statusCode === 410) {
        const c = admin ?? supabase
        await c.from('push_subscriptions').delete().eq('id', row.id)
        removed += 1
      }
    }

    return NextResponse.json({ ok: true, sent, removed })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
