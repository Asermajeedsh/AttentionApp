import { createBrowserClient } from '@supabase/ssr'
import type { PulseData, PulseMood, PulseUser } from '../../types/pulse'
import { moodOptions } from '../../lib/pulse/demo-data'

function cleanUrl(value: string | undefined) {
  if (!value) return ''
  const raw = value.trim().replace(/^['"`]|['"`]$/g, '')
  return raw.includes('://') ? raw : `https://${raw}`
}

function isValidUrl(value: string | undefined) {
  try {
    const url = new URL(cleanUrl(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function getSupabaseUrl() {
  if (isValidUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    return cleanUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  }
  const ref = process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF?.trim()
  return ref ? `https://${ref}.supabase.co` : ''
}

export function hasSupabaseBrowserEnv() {
  return isValidUrl(getSupabaseUrl()) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function createClient() {
  return createBrowserClient(getSupabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
}

export function createOptionalClient() {
  return hasSupabaseBrowserEnv() ? createClient() : null
}

export async function ensurePulseUser(authUser: {
  id: string
  email?: string | null
  user_metadata?: any
}) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) {
    const row = existing as any
    return {
      id: row.id,
      email: row.email ?? null,
      display_name: row.name ?? 'Love',
      avatar_url: row.avatar_url ?? null,
      partner_id: row.partner_id ?? null,
      onboarding_complete: true,
      timezone: 'UTC',
    } as PulseUser
  }

  const name =
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.name ||
    authUser.email?.split('@')[0] ||
    'Love'

  const { data, error } = await supabase
    .from('users')
    .insert({ id: authUser.id, email: authUser.email?.toLowerCase() ?? null, name, role: 'partner' })
    .select('*')
    .single()

  if (error) throw error
  const row = data as any
  return {
    id: row.id,
    email: row.email ?? null,
    display_name: row.name ?? name,
    avatar_url: row.avatar_url ?? null,
    partner_id: row.partner_id ?? null,
    onboarding_complete: true,
    timezone: 'UTC',
  } as PulseUser
}

export async function updatePulseProfile(input: { display_name: string; onboarding_complete?: boolean }) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in.')

  const { data, error } = await supabase
    .from('users')
    .update({
      name: input.display_name.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', auth.user.id)
    .select('*')
    .single()

  if (error) throw error
  const row = data as any
  return {
    id: row.id,
    email: row.email ?? null,
    display_name: row.name ?? input.display_name.trim(),
    avatar_url: row.avatar_url ?? null,
    partner_id: row.partner_id ?? null,
    onboarding_complete: true,
    timezone: 'UTC',
  } as PulseUser
}

export async function fetchPulseData(authUser: any): Promise<PulseData> {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')

  const me = await ensurePulseUser(authUser)
  const partnerId = me.partner_id
  const partnerPromise = me.partner_id
    ? supabase.from('users').select('*').eq('id', me.partner_id).maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const pairFilter = partnerId
    ? `and(sender_id.eq.${me.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${me.id})`
    : `sender_id.eq.${me.id}`

  const messagePairFilter = partnerId
    ? `and(sender_id.eq.${me.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${me.id})`
    : `sender_id.eq.${me.id}`

  const [partnerResult, pulsesResult, messagesResult, moodsResult, meRowResult] = await Promise.all([
    partnerPromise,
    partnerId
      ? supabase.from('beeps').select('*').or(pairFilter).order('created_at', { ascending: false }).limit(20)
      : supabase.from('beeps').select('*').eq('sender_id', me.id).order('created_at', { ascending: false }).limit(20),
    partnerId
      ? supabase.from('messages').select('*').or(messagePairFilter).order('created_at', { ascending: false }).limit(30)
      : supabase.from('messages').select('*').eq('sender_id', me.id).order('created_at', { ascending: false }).limit(30),
    partnerId
      ? supabase.from('mood_entries').select('*').in('user_id', [me.id, partnerId]).order('mood_date', { ascending: false }).limit(10)
      : supabase.from('mood_entries').select('*').eq('user_id', me.id).order('mood_date', { ascending: false }).limit(10),
    supabase.from('users').select('relationship_streak').eq('id', me.id).maybeSingle(),
  ])

  if (partnerResult.error) throw partnerResult.error
  if (pulsesResult.error) throw pulsesResult.error
  if (messagesResult.error) throw messagesResult.error
  if (moodsResult.error) throw moodsResult.error

  const partnerRow = partnerResult.data as any
  const partner: PulseUser | null = partnerRow
    ? {
        id: partnerRow.id,
        email: partnerRow.email ?? null,
        display_name: partnerRow.name ?? 'Love',
        avatar_url: partnerRow.avatar_url ?? null,
        partner_id: partnerRow.partner_id ?? null,
        onboarding_complete: true,
        timezone: 'UTC',
      }
    : null

  const pulses = (pulsesResult.data ?? []).map((row: any) => ({
    id: row.id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    emotion: row.message ?? 'Thinking of you',
    intensity: 3,
    note: null,
    created_at: row.created_at,
  }))

  const messages = (messagesResult.data ?? []).map((row: any) => ({
    id: row.id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    body: row.content ?? null,
    image_url: null,
    reaction: null,
    read_at: row.read_at ?? null,
    created_at: row.created_at,
  }))

  const moods = (moodsResult.data ?? []).map((row: any) => {
    const match = moodOptions.find((m) => m.key === row.mood) || moodOptions[0]
    return {
      id: row.id,
      user_id: row.user_id,
      mood_key: row.mood,
      emoji: match.emoji,
      color: match.color,
      note: row.note ?? null,
      mood_date: row.mood_date,
      created_at: row.created_at,
    } as PulseMood
  })

  const relationshipStreak = (meRowResult.data as any)?.relationship_streak ?? 0

  return {
    me,
    partner,
    pulses,
    messages,
    moods,
    streak: partner
      ? { user_id: me.id, partner_id: partner.id, connection_streak: relationshipStreak, pulse_streak: relationshipStreak, last_connected_on: null }
      : null,
  }
}

export async function generateInviteCode() {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('generate_invite_code')
  if (error) throw error
  return data as string
}

export async function redeemInviteCode(code: string) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('redeem_invite_code', { input_code: code })
  if (error) throw error
  return data as string
}

export async function sendPulse(input: { receiverId: string; emotion: string; intensity: number; note?: string }) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in.')

  const { data, error } = await supabase
    .from('beeps')
    .insert({
      sender_id: auth.user.id,
      receiver_id: input.receiverId,
      message: input.emotion,
    })
    .select('*')
    .single()

  if (error) throw error

  fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'beep',
      receiverId: input.receiverId,
      content: input.emotion,
      url: '/app',
      dedupeKey: data.id,
    }),
  }).catch(() => {})

  return data
}

export async function sendMessage(input: { receiverId: string; body: string; imageUrl?: string | null }) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in.')

  const { data, error } = await supabase
    .from('messages')
    .insert({
      sender_id: auth.user.id,
      receiver_id: input.receiverId,
      content: input.body,
      is_read: false,
    })
    .select('*')
    .single()

  if (error) throw error

  fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'dm', receiverId: input.receiverId, content: input.body, url: '/chat' }),
  }).catch(() => {})

  return data
}

export async function shareMood(input: { mood_key: string; emoji: string; color: string; note?: string }) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Not signed in.')

  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('mood_entries')
    .upsert(
      {
        user_id: auth.user.id,
        mood: input.mood_key,
        note: input.note ?? null,
        mood_date: today,
      },
      { onConflict: 'user_id,mood_date' }
    )
    .select('*')
    .single()

  if (error) throw error
  fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'mood', content: input.mood_key, url: '/mood' }),
  }).catch(() => {})

  const match = moodOptions.find((m) => m.key === input.mood_key) || moodOptions[0]
  return {
    id: (data as any).id,
    user_id: auth.user.id,
    mood_key: input.mood_key,
    emoji: match.emoji,
    color: match.color,
    note: input.note ?? null,
    mood_date: today,
    created_at: (data as any).created_at,
  } as PulseMood
}
