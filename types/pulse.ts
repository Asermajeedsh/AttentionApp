export type PulseMode = 'home' | 'messages' | 'mood' | 'settings'

export type PulseUser = {
  id: string
  email: string | null
  display_name: string
  avatar_url: string | null
  partner_id: string | null
  onboarding_complete: boolean
  timezone: string
}

export type PulseItem = {
  id: string
  sender_id: string
  receiver_id: string
  emotion: string
  intensity: number
  note: string | null
  created_at: string
}

export type PulseMessage = {
  id: string
  sender_id: string
  receiver_id: string
  body: string | null
  image_url: string | null
  reaction: string | null
  read_at: string | null
  created_at: string
}

export type PulseMood = {
  id: string
  user_id: string
  mood_key: string
  emoji: string
  color: string
  note: string | null
  mood_date: string
  created_at: string
}

export type PulseStreak = {
  user_id: string
  partner_id: string
  connection_streak: number
  pulse_streak: number
  last_connected_on: string | null
}

export type PulseData = {
  me: PulseUser
  partner: PulseUser | null
  pulses: PulseItem[]
  messages: PulseMessage[]
  moods: PulseMood[]
  streak: PulseStreak | null
}
