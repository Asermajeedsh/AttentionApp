import webpush from 'web-push'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

type PrefsRow = {
  mute_all: boolean
  quiet_hours_enabled: boolean
  quiet_start_minutes: number
  quiet_end_minutes: number
  timezone: string
  notify_dm: boolean
  notify_beep: boolean
  notify_invite: boolean
  notify_game: boolean
  notify_call: boolean
  notify_missed_call: boolean
  notify_mood: boolean
  notify_rating: boolean
  notify_reminder: boolean
  calls_bypass_quiet_hours: boolean
}

function notificationCopy(type: string, content: string, senderName: string, extras: { callId?: string | null }) {
  if (type === 'beep') return { title: 'Beep ❤️', body: content || `${senderName} needs your attention`, url: '/app', badgeIncrement: 1 }
  if (type === 'invite') return { title: 'Partner invite 💞', body: content || `${senderName} invited you`, url: '/settings', badgeIncrement: 1 }
  if (type === 'game') return { title: 'Game invite 🎮', body: content || `${senderName} started a game`, url: '/games', badgeIncrement: 1 }
  if (type === 'call') {
    const callUrl = extras.callId ? `/calls?call=${encodeURIComponent(extras.callId)}` : '/calls'
    return { title: 'Incoming call 📞', body: content || `${senderName} is calling`, url: callUrl, badgeIncrement: 1 }
  }
  if (type === 'missed_call') return { title: 'Missed call 📞', body: content || `You missed a call from ${senderName}`, url: '/calls', badgeIncrement: 1 }
  if (type === 'mood') return { title: 'Mood update 🌙', body: content || `${senderName} shared a mood`, url: '/ratings', badgeIncrement: 1 }
  if (type === 'rating') return { title: 'Relationship rating ❤️', body: content || `${senderName} shared a rating`, url: '/ratings', badgeIncrement: 1 }
  if (type === 'reminder') return { title: 'Reminder ❤️', body: content || `You have a new reminder`, url: '/app', badgeIncrement: 1 }
  return { title: 'New message 💬', body: content || `${senderName} sent you a message`, url: '/dm', badgeIncrement: 1 }
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
    notify_dm: true,
    notify_beep: true,
    notify_invite: true,
    notify_game: true,
    notify_call: true,
    notify_missed_call: true,
    notify_mood: true,
    notify_rating: true,
    notify_reminder: true,
    calls_bypass_quiet_hours: true,
  }
}

function allowType(prefs: PrefsRow, type: string) {
  if (prefs.mute_all) return false
  if (type === 'beep') return prefs.notify_beep
  if (type === 'invite') return prefs.notify_invite
  if (type === 'game') return prefs.notify_game
  if (type === 'call') return prefs.notify_call
  if (type === 'missed_call') return prefs.notify_missed_call
  if (type === 'mood') return prefs.notify_mood
  if (type === 'rating') return prefs.notify_rating
  if (type === 'reminder') return prefs.notify_reminder
  return prefs.notify_dm
}

function shouldBypassQuietHours(prefs: PrefsRow, type: string) {
  if (type === 'call') return prefs.calls_bypass_quiet_hours
  return false
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

    const body = await req.json().catch(() => ({}))
    const type = typeof body?.type === 'string' ? body.type : 'dm'
    const content = typeof body?.content === 'string' ? body.content.slice(0, 500) : ''
    const receiverId = typeof body?.receiverId === 'string' ? body.receiverId : null
    const callId = typeof body?.callId === 'string' ? body.callId : null
    const dedupeKey = typeof body?.dedupeKey === 'string' ? body.dedupeKey : (typeof body?.id === 'string' ? body.id : null)
    const clientUrl = typeof body?.url === 'string' ? body.url : null
    const senderId = userData.user.id

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const admin = serviceRoleKey
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
      : null

    const { data: senderProfile, error: senderError } = await supabase
      .from('users')
      .select('partner_id, name')
      .eq('id', senderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (senderError) return NextResponse.json({ ok: false, error: senderError.message }, { status: 500 })
    const partnerId = senderProfile?.partner_id as string | null | undefined
    let targetUserId: string | null = null

    if (receiverId) {
      if (partnerId && receiverId === partnerId) {
        targetUserId = receiverId
      } else if (type === 'invite') {
        const { data: prRow } = await supabase
          .from('partner_requests')
          .select('id')
          .or(`and(requester_id.eq.${senderId},recipient_user_id.eq.${receiverId}),and(requester_id.eq.${receiverId},recipient_user_id.eq.${senderId})`)
          .in('status', ['pending', 'accepted'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!prRow?.id) {
          return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
        }
        targetUserId = receiverId
      } else {
        return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
      }
    } else {
      if (!partnerId) return NextResponse.json({ ok: false, error: 'No partner connected' }, { status: 400 })
      targetUserId = partnerId
    }

    const { data: subs, error: subError } = admin
      ? await admin
          .from('push_subscriptions')
          .select('id, subscription')
          .eq('user_id', targetUserId)
          .order('last_seen_at', { ascending: false })
      : await supabase.rpc('get_push_subscriptions_for_notification', { target_user_id: targetUserId })

    if (subError || !subs || subs.length === 0) {
      return NextResponse.json({ ok: false, error: 'No push subscription for receiver' }, { status: 200 })
    }

    let prefs = defaultPrefs()
    const { data: prefRow } = admin
      ? await admin
          .from('notification_preferences')
          .select(
            'mute_all,quiet_hours_enabled,quiet_start_minutes,quiet_end_minutes,timezone,notify_dm,notify_beep,notify_invite,notify_game,notify_call,notify_missed_call,notify_mood,notify_rating,notify_reminder,calls_bypass_quiet_hours'
          )
          .eq('user_id', targetUserId)
          .limit(1)
          .maybeSingle()
      : await supabase.rpc('get_notification_preferences_for_notification', { target_user_id: targetUserId })

    if (prefRow) {
      prefs = { ...prefs, ...(prefRow as any) }
    }

    if (!allowType(prefs, type)) {
      return NextResponse.json({ ok: true, sent: 0, removed: 0, suppressed: 'disabled' })
    }
    if (isQuietNow(prefs, new Date()) && !shouldBypassQuietHours(prefs, type)) {
      return NextResponse.json({ ok: true, sent: 0, removed: 0, suppressed: 'quiet_hours' })
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:founder@valiorstudios.com',
      getEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY'),
      getEnv('VAPID_PRIVATE_KEY')
    )

    const copy = notificationCopy(type, content, senderProfile?.name || 'Your partner', { callId })
    const url = clientUrl || copy.url
    const id = dedupeKey || `${type}:${senderId}:${targetUserId}:${Date.now()}`
    const tag = `${type}:${targetUserId}:${senderId}`
    const payload = JSON.stringify({
      title: copy.title,
      body: copy.body,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      type,
      id,
      tag,
      data: { url, type, id, tag, badgeIncrement: copy.badgeIncrement ?? 1, callId: callId ?? undefined },
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
        } else {
          await supabase.rpc('touch_push_subscription_for_notification', {
            target_user_id: targetUserId,
            subscription_id: row.id,
          })
        }
        continue
      }

      const err: any = result.err
      const statusCode = err?.statusCode ?? null
      if (statusCode === 404 || statusCode === 410) {
        if (admin) {
          await admin.from('push_subscriptions').delete().eq('id', row.id)
        } else {
          await supabase.rpc('delete_push_subscription_for_notification', {
            target_user_id: targetUserId,
            subscription_id: row.id,
          })
        }
        removed += 1
      }
    }

    return NextResponse.json({ ok: true, sent, removed })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Notification failed' }, { status: 500 })
  }
}
