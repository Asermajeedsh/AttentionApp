import type { PulseData, PulseMessage, PulseMood, PulseStreak, PulseUser } from '../../types/pulse'

const now = Date.now()

export const pulseEmotions = [
  { key: 'thinking', label: 'Thinking of you', emoji: '💗', color: '#f48fb1' },
  { key: 'miss', label: 'I miss you', emoji: '🥺', color: '#c8a2ff' },
  { key: 'proud', label: 'Proud of you', emoji: '✨', color: '#ffb48f' },
  { key: 'hug', label: 'Tiny hug', emoji: '🤍', color: '#f7c8d4' },
]

export const moodOptions = [
  { key: 'soft', label: 'Soft', emoji: '🌷', color: '#f7b4ca' },
  { key: 'happy', label: 'Happy', emoji: '😊', color: '#ffc28a' },
  { key: 'tender', label: 'Tender', emoji: '🥹', color: '#c8a2ff' },
  { key: 'tired', label: 'Tired', emoji: '🌙', color: '#9fb7ff' },
  { key: 'heavy', label: 'Heavy', emoji: '☁️', color: '#b8a7ba' },
]

const me: PulseUser = {
  id: 'demo-me',
  email: 'you@pulse.love',
  display_name: 'You',
  avatar_url: null,
  partner_id: 'demo-partner',
  onboarding_complete: true,
  timezone: 'Asia/Karachi',
}

const partner: PulseUser = {
  id: 'demo-partner',
  email: 'person@pulse.love',
  display_name: 'Your person',
  avatar_url: null,
  partner_id: 'demo-me',
  onboarding_complete: true,
  timezone: 'Asia/Karachi',
}

export const demoMessages: PulseMessage[] = [
  {
    id: 'm1',
    sender_id: 'demo-partner',
    receiver_id: 'demo-me',
    body: 'I felt that little pulse. Needed it.',
    image_url: null,
    reaction: '💗',
    read_at: new Date(now - 1000 * 60 * 15).toISOString(),
    created_at: new Date(now - 1000 * 60 * 18).toISOString(),
  },
  {
    id: 'm2',
    sender_id: 'demo-me',
    receiver_id: 'demo-partner',
    body: 'Tiny reminder: I am on your side.',
    image_url: null,
    reaction: null,
    read_at: new Date(now - 1000 * 60 * 9).toISOString(),
    created_at: new Date(now - 1000 * 60 * 12).toISOString(),
  },
]

const demoMoods: PulseMood[] = [
  {
    id: 'mood-me',
    user_id: 'demo-me',
    mood_key: 'soft',
    emoji: '🌷',
    color: '#f7b4ca',
    note: 'Open to affection today.',
    mood_date: new Date().toISOString().slice(0, 10),
    created_at: new Date(now - 1000 * 60 * 30).toISOString(),
  },
  {
    id: 'mood-partner',
    user_id: 'demo-partner',
    mood_key: 'tired',
    emoji: '🌙',
    color: '#9fb7ff',
    note: 'A little low battery, still here.',
    mood_date: new Date().toISOString().slice(0, 10),
    created_at: new Date(now - 1000 * 60 * 50).toISOString(),
  },
]

const streak: PulseStreak = {
  user_id: 'demo-me',
  partner_id: 'demo-partner',
  connection_streak: 12,
  pulse_streak: 7,
  last_connected_on: new Date().toISOString().slice(0, 10),
}

export const demoPulseData: PulseData = {
  me,
  partner,
  pulses: [
    {
      id: 'p1',
      sender_id: 'demo-partner',
      receiver_id: 'demo-me',
      emotion: 'Thinking of you',
      intensity: 3,
      note: null,
      created_at: new Date(now - 1000 * 60 * 6).toISOString(),
    },
    {
      id: 'p2',
      sender_id: 'demo-me',
      receiver_id: 'demo-partner',
      emotion: 'Tiny hug',
      intensity: 2,
      note: null,
      created_at: new Date(now - 1000 * 60 * 42).toISOString(),
    },
  ],
  messages: demoMessages,
  moods: demoMoods,
  streak,
}
