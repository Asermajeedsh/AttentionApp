import { createBrowserClient } from '@supabase/ssr'

function isValidUrl(value: string | undefined) {
  if (!value) {
    return false
  }

  try {
    const raw = value.trim()
    const unwrapped =
      (raw.startsWith('`') && raw.endsWith('`')) ||
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    const normalized = unwrapped.includes('://') ? unwrapped : `https://${unwrapped}`
    const url = new URL(normalized)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function getSupabaseUrl() {
  const direct = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (isValidUrl(direct)) {
    return direct!.trim()
  }

  const ref = (process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF || '').trim()
  if (ref) {
    return `https://${ref}.supabase.co`
  }

  return ''
}

export function hasSupabaseBrowserEnv() {
  return isValidUrl(getSupabaseUrl()) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function createClient() {
  return createBrowserClient(
    getSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export function createOptionalClient() {
  if (!hasSupabaseBrowserEnv()) {
    return null
  }

  return createClient()
}

export async function autoLinkPartner() {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data, error } = await supabase.rpc('auto_link_partner')
  if (error) {
    throw error
  }

  return data as string | null
}

export async function sendBeep(message: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  console.log('[beep] starting sendBeep')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    console.error('[beep] auth.getUser failed', userError)
    throw new Error('User not authenticated')
  }

  const senderId = userData.user.id
  console.log('[beep] senderId', senderId)

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('partner_id')
    .eq('id', senderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (profileError) {
    console.error('[beep] failed to fetch partner_id', profileError)
    throw profileError
  }

  const receiverId = profile?.partner_id as string | null | undefined
  if (!receiverId) {
    console.warn('[beep] no partner connected')
    throw new Error('No partner connected')
  }
  console.log('[beep] receiverId', receiverId)

  const { data, error } = await supabase
    .from('beeps')
    .insert([{ sender_id: senderId, receiver_id: receiverId, message }])
    .select()
    .single()

  if (error) {
    console.error('[beep] insert failed', error)
    const msg = typeof error.message === 'string' ? error.message : ''
    if (msg.toLowerCase().includes('column') && msg.toLowerCase().includes('message')) {
      throw new Error('Database schema is outdated. Run the latest SQL in supabase/schema.sql (beeps.message is missing).')
    }
    if (msg.toLowerCase().includes('relation') && msg.toLowerCase().includes('beeps')) {
      throw new Error('Database schema is missing tables. Run the latest SQL in supabase/schema.sql.')
    }
    throw error
  }

  console.log('[beep] success', data?.id)

  fetch('/api/send-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'beep', content: message, dedupeKey: data?.id || undefined, url: '/app' }),
  }).catch((e) => console.error('[beep] send notification failed', e))

  return data
}

export async function joinWaitlist(input: { email?: string }) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user

  const isLoggedIn = Boolean(user)
  const email = (input.email || user?.email || '').trim().toLowerCase()

  if (!isLoggedIn && !email) {
    throw new Error('Email is required')
  }

  const payload = isLoggedIn
    ? [{ user_id: user!.id, email: user?.email ?? null }]
    : [{ user_id: null, email }]

  const { error } = await supabase.from('waitlist').insert(payload)

  if (error) {
    const msg = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    if (msg.includes('waitlist')) {
      throw new Error('Database schema is missing tables. Run the latest SQL in supabase/schema.sql.')
    }
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return { ok: true, already: true as const }
    }
    throw error
  }

  return { ok: true, already: false as const }
}

export async function fetchBeeps() {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data, error } = await supabase
    .from('beeps')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data
}

export async function fetchProfile(userId: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}

export async function ensureProfile(authUser: {
  id: string
  email?: string | null
  user_metadata?: any
}) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const existing = await fetchProfile(authUser.id)
  if (existing) {
    const email = authUser.email?.toLowerCase() ?? null
    if (email && existing.email !== email) {
      await supabase
        .from('users')
        .update({ email, updated_at: new Date().toISOString() })
        .eq('id', authUser.id)
    }

    if (email) {
      try {
        await supabase
          .from('partner_requests')
          .update({ recipient_user_id: authUser.id })
          .eq('recipient_email', email)
          .is('recipient_user_id', null)
          .eq('status', 'pending')
          .select('id')
          .limit(1)
          .maybeSingle()
      } catch {}
    }

    const refreshed = await fetchProfile(authUser.id)
    if (refreshed) return refreshed
    return existing
  }

  const email = authUser.email?.toLowerCase() ?? null
  const role = email === 'zohrababarr@gmail.com' ? 'me' : 'partner'
  const fallbackName = role === 'me' ? 'Me' : 'Partner'
  const name =
    authUser.user_metadata?.full_name ||
    authUser.user_metadata?.name ||
    fallbackName

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert([{ id: authUser.id, email, role, name }])
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (insertError) {
    const msg = typeof insertError.message === 'string' ? insertError.message.toLowerCase() : ''
    if (msg.includes('duplicate') || msg.includes('unique')) {
      const after = await fetchProfile(authUser.id)
      if (after) {
        return after
      }
    }
    throw insertError
  }

  if (!created) {
    throw new Error('Failed to create profile')
  }

  if (email) {
    try {
      await supabase
        .from('partner_requests')
        .update({ recipient_user_id: authUser.id })
        .eq('recipient_email', email)
        .is('recipient_user_id', null)
        .eq('status', 'pending')
        .select('id')
        .limit(1)
        .maybeSingle()
    } catch {}
  }

  return created
}

export async function generateInviteCode() {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { data, error } = await supabase.rpc('generate_invite_code')
  if (error) throw error
  return data as string
}

export async function redeemInviteCode(code: string) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { data, error } = await supabase.rpc('redeem_invite_code', { input_code: code })
  if (error) throw error
  return data as string
}

export async function createPartnerRequest(recipientEmail: string) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { data, error } = await supabase.rpc('create_partner_request', { input_email: recipientEmail })
  if (error) throw error
  return data as string
}

export async function fetchPartnerRequests() {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { data, error } = await supabase
    .from('partner_requests')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as any[]
}

export async function acceptPartnerRequest(requestId: string) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { data, error } = await supabase.rpc('accept_partner_request', { request_id: requestId })
  if (error) throw error
  return data as string
}

export async function declinePartnerRequest(requestId: string) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { error } = await supabase.rpc('decline_partner_request', { request_id: requestId })
  if (error) throw error
}

export async function cancelPartnerRequest(requestId: string) {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { error } = await supabase.rpc('cancel_partner_request', { request_id: requestId })
  if (error) throw error
}

export async function unlinkPartner() {
  const supabase = createOptionalClient()
  if (!supabase) throw new Error('Supabase client not available')
  const { error } = await supabase.rpc('unlink_partner')
  if (error) throw error
}

export type MoodValue =
  | 'happy'
  | 'good'
  | 'overstimulated'
  | 'stressed'
  | 'sad'
  | 'angry'
  | 'tired'
  | 'great'
  | 'okay'

export type MoodEntry = {
  id: string
  user_id: string
  mood: MoodValue
  note: string | null
  mood_date: string
  created_at: string
  updated_at: string
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10)
}

export async function upsertMoodEntry(mood: MoodValue, note: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('User not authenticated')
  }

  const userId = userData.user.id
  const moodDate = todayUtcDate()

  const { data, error } = await supabase
    .from('mood_entries')
    .upsert(
      [{ user_id: userId, mood, note, mood_date: moodDate, updated_at: new Date().toISOString() }],
      { onConflict: 'user_id,mood_date' }
    )
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    const msg = typeof error.message === 'string' ? error.message : ''
    if (msg.toLowerCase().includes('mood_entries')) {
      throw new Error('Database schema is missing tables. Run the latest SQL in supabase/schema.sql.')
    }
    throw error
  }

  if (!data) {
    throw new Error('Failed to save mood')
  }

  return data as MoodEntry
}

export async function fetchLatestMoodForUser(userId: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data, error } = await supabase
    .from('mood_entries')
    .select('*')
    .eq('user_id', userId)
    .order('mood_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as MoodEntry | null) ?? null
}

export type PartnerRating = {
  id: string
  rater_id: string
  rated_id: string
  love: number
  attention: number
  neglect: number
  disrespect: number
  compliments: number
  comments: string | null
  created_at: string
}

export async function submitPartnerRating(input: {
  ratedId: string
  love: number
  attention: number
  neglect: number
  disrespect: number
  compliments: number
  comments: string
}) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('User not authenticated')
  }

  const raterId = userData.user.id

  const { data, error } = await supabase
    .from('partner_ratings')
    .insert([
      {
        rater_id: raterId,
        rated_id: input.ratedId,
        love: input.love,
        attention: input.attention,
        neglect: input.neglect,
        disrespect: input.disrespect,
        compliments: input.compliments,
        comments: input.comments || null,
      },
    ])
    .select('*')
    .single()

  if (error) {
    const msg = typeof error.message === 'string' ? error.message : ''
    if (msg.toLowerCase().includes('partner_ratings')) {
      throw new Error('Database schema is missing tables. Run the latest SQL in supabase/schema.sql.')
    }
    throw error
  }

  return data as PartnerRating
}

export async function fetchLatestRatingForUser(ratedUserId: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data, error } = await supabase
    .from('partner_ratings')
    .select('*')
    .eq('rated_id', ratedUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (data as PartnerRating | null) ?? null
}

export type GameTurn = 'players' | 'ai'

export type GameState = {
  trackSize: number
  players: {
    p1: number
    p2: number
  }
  ai: {
    b1: number
    b2: number
  }
  lastRoll: number | null
  pendingRoll: number | null
  winner: 'players' | 'ai' | null
}

export type GameSession = {
  id: string
  player1_id: string
  player2_id: string
  game_state: GameState
  current_turn: GameTurn
  created_at: string
}

export function createInitialGameState(trackSize = 24): GameState {
  return {
    trackSize,
    players: { p1: 0, p2: 0 },
    ai: { b1: 0, b2: 0 },
    lastRoll: null,
    pendingRoll: null,
    winner: null,
  }
}

export async function getOrCreateGameSession(partnerId: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('User not authenticated')
  }

  const me = userData.user.id
  const player1 = me < partnerId ? me : partnerId
  const player2 = me < partnerId ? partnerId : me

  const { data: existing, error: selectError } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('player1_id', player1)
    .eq('player2_id', player2)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (selectError) {
    throw selectError
  }

  if (existing) {
    return existing as GameSession
  }

  const initialState = createInitialGameState()
  const { data: created, error: insertError } = await supabase
    .from('game_sessions')
    .insert([
      {
        player1_id: player1,
        player2_id: player2,
        game_state: initialState,
        current_turn: 'players',
      },
    ])
    .select('*')
    .single()

  if (insertError) {
    throw insertError
  }

  return created as GameSession
}

export async function fetchGameSessionById(sessionId: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data, error } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error) {
    throw error
  }

  return data as GameSession
}

export async function saveGameSession(sessionId: string, gameState: GameState, currentTurn: GameTurn) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { data, error } = await supabase
    .from('game_sessions')
    .update({ game_state: gameState, current_turn: currentTurn })
    .eq('id', sessionId)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data as GameSession
}

export async function updatePushToken(userId: string, token: string) {
  const supabase = createOptionalClient()
  if (!supabase) {
    throw new Error('Supabase client not available')
  }

  const { error } = await supabase
    .from('users')
    .update({ push_token: token, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    throw error
  }
}
