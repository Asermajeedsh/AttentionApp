'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  Check,
  Copy,
  Flame,
  Heart,
  Image as ImageIcon,
  Link2,
  Loader2,
  MessageCircle,
  Moon,
  Send,
  Settings,
  Smile,
  Sparkles,
  Sun,
  User,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { PulseData, PulseMode, PulseMood } from '../../types/pulse'
import { demoPulseData, moodOptions, pulseEmotions } from '../../lib/pulse/demo-data'
import {
  createOptionalClient,
  fetchPulseData,
  generateInviteCode,
  hasSupabaseBrowserEnv,
  redeemInviteCode,
  sendMessage,
  sendPulse,
  shareMood,
  updatePulseProfile,
} from '../../utils/supabase/client'

const spring = { type: 'spring' as const, stiffness: 260, damping: 24 }

function timeAgo(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`pulse-card ${className}`}>{children}</div>
}

function Avatar({ name }: { name?: string }) {
  const initial = (name || 'P').slice(0, 1).toUpperCase()
  return (
    <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/70 text-sm font-black text-pink-500 shadow-lg shadow-pink-200/30 ring-1 ring-white/70">
      {initial}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[26px] border border-white/65 bg-white/45 p-5 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-2xl bg-pink-100 text-pink-500">
        <Heart className="h-5 w-5" fill="currentColor" />
      </div>
      <p className="text-sm font-black text-[#4b3445]">{title}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-[#977a8f]">{body}</p>
    </div>
  )
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="grid h-11 w-11 place-items-center rounded-2xl border border-white/60 bg-white/55 text-[#7d5870] shadow-lg shadow-pink-100/30 backdrop-blur-xl transition active:scale-95"
      aria-label="Toggle theme"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  )
}

function PulseOrb({
  disabled,
  onPulse,
  active,
  sent,
}: {
  disabled: boolean
  active: boolean
  sent: boolean
  onPulse: () => void
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onPulse}
      whileTap={{ scale: 0.9 }}
      animate={active ? { scale: [1, 1.06, 1], rotate: [0, -1.5, 1.5, 0] } : { scale: 1 }}
      transition={active ? { duration: 0.75 } : spring}
      className="relative mx-auto grid h-48 w-48 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-60"
      aria-label="Send pulse"
    >
      <motion.span
        className="absolute inset-0 rounded-full bg-pink-300/30 blur-2xl"
        animate={{ scale: [0.9, 1.18, 0.9], opacity: [0.45, 0.9, 0.45] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="absolute inset-5 rounded-full border border-white/75 bg-gradient-to-br from-white/80 via-pink-100/80 to-violet-100/80 shadow-[0_28px_80px_rgba(233,111,153,0.38)] backdrop-blur-2xl"
        animate={{ boxShadow: active ? '0 0 0 18px rgba(244,143,177,0)' : '0 28px 80px rgba(233,111,153,0.38)' }}
      />
      <AnimatePresence>
        {active && (
          <motion.span
            key="ripple"
            className="absolute inset-4 rounded-full border border-pink-200/70"
            initial={{ opacity: 0.45, scale: 0.92 }}
            animate={{ opacity: 0, scale: 1.18 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <span className="relative grid h-28 w-28 place-items-center rounded-full bg-gradient-to-br from-[#ff7ca8] via-[#ef6fa5] to-[#b892ff] text-white shadow-2xl shadow-pink-300/50">
        <AnimatePresence mode="wait">
          {sent ? (
            <motion.span key="sent" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.85, opacity: 0 }}>
              <Check className="h-12 w-12" />
            </motion.span>
          ) : (
            <motion.span key="heart" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}>
              <Heart className="h-12 w-12" fill="currentColor" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  )
}

function PartnerLink({
  connected,
  inviteCode,
  onGenerate,
  onRedeem,
  redeemValue,
  setRedeemValue,
  busy,
}: {
  connected: boolean
  inviteCode: string | null
  onGenerate: () => void
  onRedeem: () => void
  redeemValue: string
  setRedeemValue: (value: string) => void
  busy: boolean
}) {
  if (connected) {
    return (
      <GlassCard className="p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-100 text-emerald-600">
            <Check className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black text-[#4b3445]">Private pair connected</p>
            <p className="text-xs font-semibold text-[#977a8f]">Pulse is just for the two of you.</p>
          </div>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-500">
          <Link2 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-black text-[#4b3445]">Link your person</p>
          <p className="text-xs font-semibold text-[#977a8f]">One invite, one partner, one shared heartbeat.</p>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button onClick={onGenerate} disabled={busy} className="pulse-soft-button justify-center">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
          {inviteCode || 'Create invite'}
        </button>
        <button
          onClick={() => inviteCode && navigator.clipboard?.writeText(inviteCode).catch(() => {})}
          className="grid h-12 w-12 place-items-center rounded-2xl bg-white/65 text-pink-500"
          aria-label="Copy invite"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={redeemValue}
          onChange={(event) => setRedeemValue(event.target.value.toUpperCase())}
          placeholder="Their code"
          className="h-12 rounded-2xl border border-white/60 bg-white/55 px-4 text-sm font-bold text-[#57384d] outline-none placeholder:text-[#b797aa] focus:ring-2 focus:ring-pink-300"
        />
        <button onClick={onRedeem} disabled={busy || !redeemValue.trim()} className="pulse-icon-button">
          <Check className="h-4 w-4" />
        </button>
      </div>
    </GlassCard>
  )
}

function StreakCard({ data }: { data: PulseData }) {
  const streak = data.streak
  return (
    <div className="grid grid-cols-2 gap-3">
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 text-[#f06f9e]">
          <Flame className="h-4 w-4" fill="currentColor" />
          <span className="text-xs font-black uppercase tracking-[0.18em]">streak</span>
        </div>
        <p className="mt-3 text-3xl font-black text-[#4b3445]">{streak?.connection_streak ?? 0}</p>
        <p className="text-xs font-semibold text-[#977a8f]">days connected</p>
      </GlassCard>
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 text-violet-500">
          <Zap className="h-4 w-4" fill="currentColor" />
          <span className="text-xs font-black uppercase tracking-[0.18em]">pulse</span>
        </div>
        <p className="mt-3 text-3xl font-black text-[#4b3445]">{streak?.pulse_streak ?? 0}</p>
        <p className="text-xs font-semibold text-[#977a8f]">daily beeps</p>
      </GlassCard>
    </div>
  )
}

function Timeline({ data }: { data: PulseData }) {
  const items = data.pulses.slice(0, 5)
  if (!items.length) return <EmptyState title="No pulses yet" body="Send the first tiny signal and make the day feel a little closer." />
  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-black text-[#4b3445]">Pulse history</p>
        <span className="text-xs font-bold text-[#a98399]">live thread</span>
      </div>
      <div className="space-y-4">
        {items.map((pulse) => {
          const mine = pulse.sender_id === data.me.id
          return (
            <div key={pulse.id} className="flex items-center gap-3">
              <div className={`grid h-9 w-9 place-items-center rounded-2xl ${mine ? 'bg-pink-100 text-pink-500' : 'bg-violet-100 text-violet-500'}`}>
                <Heart className="h-4 w-4" fill="currentColor" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-[#4b3445]">
                  {mine ? 'You sent' : `${data.partner?.display_name || 'Your person'} sent`} {pulse.emotion}
                </p>
                <p className="text-xs font-semibold text-[#a98399]">{timeAgo(pulse.created_at)} ago</p>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: pulse.intensity }).map((_, i) => (
                  <span key={i} className="h-1.5 w-1.5 rounded-full bg-pink-300" />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}

function MessagesPanel({
  data,
  draft,
  setDraft,
  onSend,
}: {
  data: PulseData
  draft: string
  setDraft: (value: string) => void
  onSend: () => void
}) {
  const messages = [...data.messages].reverse()
  return (
    <div className="flex min-h-[calc(100vh-190px)] flex-col gap-4">
      <GlassCard className="flex-1 space-y-3 p-4">
        {messages.length ? (
          messages.map((message) => {
            const mine = message.sender_id === data.me.id
            return (
              <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <motion.div
                  layout
                  className={`max-w-[78%] rounded-[24px] px-4 py-3 text-sm font-semibold leading-5 shadow-sm ${
                    mine
                      ? 'bg-gradient-to-br from-pink-500 to-violet-500 text-white'
                      : 'border border-white/65 bg-white/70 text-[#57384d]'
                  }`}
                >
                  {message.image_url && <div className="mb-2 h-28 rounded-2xl bg-white/35" />}
                  <p>{message.body}</p>
                  <div className={`mt-2 flex items-center justify-end gap-2 text-[10px] ${mine ? 'text-white/75' : 'text-[#a98399]'}`}>
                    {message.reaction && <span>{message.reaction}</span>}
                    {mine && <span>{message.read_at ? 'read' : 'sent'}</span>}
                  </div>
                </motion.div>
              </div>
            )
          })
        ) : (
          <EmptyState title="Start softly" body="A tiny message after a pulse keeps the loop warm." />
        )}
      </GlassCard>
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 rounded-[28px] border border-white/60 bg-white/65 p-2 shadow-2xl shadow-pink-100/40 backdrop-blur-2xl">
        <button className="pulse-icon-button bg-white/70 text-[#8f6680]" aria-label="Add image">
          <ImageIcon className="h-4 w-4" />
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSend()
          }}
          placeholder="Say something tiny..."
          className="h-12 rounded-2xl bg-transparent px-2 text-sm font-bold text-[#57384d] outline-none placeholder:text-[#b797aa]"
        />
        <button onClick={onSend} disabled={!draft.trim()} className="pulse-icon-button">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function MoodPanel({ data, selectedMood, setSelectedMood, note, setNote, onSave }: {
  data: PulseData
  selectedMood: string
  setSelectedMood: (value: string) => void
  note: string
  setNote: (value: string) => void
  onSave: () => void
}) {
  const partnerMood = data.moods.find((mood) => mood.user_id === data.partner?.id)
  const selected = moodOptions.find((mood) => mood.key === selectedMood) || moodOptions[0]
  return (
    <div className="space-y-4">
      <GlassCard className="p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-pink-100 text-pink-500">
            <Smile className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black text-[#4b3445]">Daily emotional check-in</p>
            <p className="text-xs font-semibold text-[#977a8f]">Share the weather inside you.</p>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {moodOptions.map((mood) => (
            <button
              key={mood.key}
              onClick={() => setSelectedMood(mood.key)}
              className={`grid aspect-square place-items-center rounded-[22px] border text-2xl transition active:scale-95 ${
                selectedMood === mood.key ? 'border-white bg-white shadow-xl shadow-pink-100/50' : 'border-white/40 bg-white/35'
              }`}
              style={{ color: mood.color }}
              aria-label={mood.label}
            >
              {mood.emoji}
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note..."
          className="mt-4 min-h-24 w-full resize-none rounded-[24px] border border-white/60 bg-white/50 p-4 text-sm font-semibold text-[#57384d] outline-none placeholder:text-[#b797aa] focus:ring-2 focus:ring-pink-300"
        />
        <button onClick={onSave} className="pulse-primary-button mt-4 w-full justify-center">
          Share {selected.emoji} {selected.label}
        </button>
      </GlassCard>
      <GlassCard className="p-5">
        <p className="mb-3 text-sm font-black text-[#4b3445]">Your person today</p>
        {partnerMood ? (
          <div className="flex items-center gap-3">
            <div className="grid h-14 w-14 place-items-center rounded-[22px] bg-white/65 text-3xl" style={{ color: partnerMood.color }}>
              {partnerMood.emoji}
            </div>
            <div>
              <p className="text-sm font-black text-[#4b3445]">{partnerMood.mood_key}</p>
              <p className="text-xs font-semibold leading-5 text-[#977a8f]">{partnerMood.note || 'No note, just a little signal.'}</p>
            </div>
          </div>
        ) : (
          <EmptyState title="Waiting for their mood" body="When they check in, it will appear here." />
        )}
      </GlassCard>
    </div>
  )
}

function SettingsPanel({
  data,
  name,
  setName,
  onSaveName,
  onEnablePush,
  onTestPush,
  testStatus,
  pushReady,
}: {
  data: PulseData
  name: string
  setName: (value: string) => void
  onSaveName: () => void
  onEnablePush: () => void
  onTestPush: () => void
  testStatus: string | null
  pushReady: boolean
}) {
  return (
    <div className="space-y-4">
      <GlassCard className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <Avatar name={data.me.display_name} />
          <div>
            <p className="text-sm font-black text-[#4b3445]">Profile setup</p>
            <p className="text-xs font-semibold text-[#977a8f]">Make the app feel like yours.</p>
          </div>
        </div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-12 w-full rounded-2xl border border-white/60 bg-white/55 px-4 text-sm font-bold text-[#57384d] outline-none focus:ring-2 focus:ring-pink-300"
        />
        <button onClick={onSaveName} className="pulse-primary-button w-full justify-center">
          Save profile
        </button>
      </GlassCard>
      <GlassCard className="space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-500">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black text-[#4b3445]">Emotional notifications</p>
            <p className="text-xs font-semibold text-[#977a8f]">Let pulses land on the lock screen like tiny love notes.</p>
          </div>
        </div>
        <button onClick={onEnablePush} className="pulse-soft-button w-full justify-center">
          <Bell className="h-4 w-4" />
          {pushReady ? 'Notifications connected' : 'Enable notifications'}
        </button>
        {pushReady && (
          <button onClick={onTestPush} className="pulse-primary-button w-full justify-center">
            <Sparkles className="h-4 w-4" />
            Send a test pulse
          </button>
        )}
        {testStatus && <div className="text-xs font-semibold text-[#977a8f]">{testStatus}</div>}
      </GlassCard>
    </div>
  )
}

export default function PulseExperience({ user, mode }: { user: any; mode: PulseMode }) {
  const router = useRouter()
  const [data, setData] = useState<PulseData>(demoPulseData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [redeemValue, setRedeemValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedEmotion, setSelectedEmotion] = useState(pulseEmotions[0])
  const [pulseActive, setPulseActive] = useState(false)
  const [pulseSent, setPulseSent] = useState(false)
  const [draft, setDraft] = useState('')
  const [selectedMood, setSelectedMood] = useState(moodOptions[0].key)
  const [moodNote, setMoodNote] = useState('')
  const [name, setName] = useState(demoPulseData.me.display_name)
  const [dark, setDark] = useState(false)
  const [pushReady, setPushReady] = useState(false)
  const [testStatus, setTestStatus] = useState<string | null>(null)

  const supabaseReady = hasSupabaseBrowserEnv()
  const connected = Boolean(data.partner)

  const refresh = useCallback(async () => {
    if (!user || !supabaseReady) {
      setLoading(false)
      return
    }
    try {
      setError(null)
      const fresh = await fetchPulseData(user)
      setData(fresh)
      setName(fresh.me.display_name)
    } catch (err: any) {
      setError(err?.message || 'Pulse could not load.')
    } finally {
      setLoading(false)
    }
  }, [supabaseReady, user])

  useEffect(() => {
    if (!user && supabaseReady) {
      router.replace('/signin')
      return
    }
    refresh()
  }, [refresh, router, supabaseReady, user])

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
    return outputArray
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (Notification.permission !== 'granted') return
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager?.getSubscription?.())
      .then((sub) => {
        if (sub) setPushReady(true)
      })
      .catch(() => {})
  }, [supabaseReady])

  useEffect(() => {
    if (!supabaseReady || !user) return
    const supabase = createOptionalClient()
    if (!supabase) return
    const channel = supabase
      .channel(`pulse:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pulses' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'moods' }, refresh)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [refresh, supabaseReady, user])

  const headerTitle = useMemo(() => {
    if (mode === 'messages') return 'Messages'
    if (mode === 'mood') return 'Mood'
    if (mode === 'settings') return 'Settings'
    return 'Pulse'
  }, [mode])

  async function handlePulse() {
    if (!connected || busy) return
    setPulseActive(true)
    setBusy(true)
    try {
      ;(navigator as any)?.vibrate?.(12)
    } catch {}
    const optimistic = {
      id: `local-${Date.now()}`,
      sender_id: data.me.id,
      receiver_id: data.partner!.id,
      emotion: selectedEmotion.label,
      intensity: 3,
      note: null,
      created_at: new Date().toISOString(),
    }
    setData((prev) => ({
      ...prev,
      pulses: [optimistic, ...prev.pulses],
      streak: prev.streak
        ? { ...prev.streak, pulse_streak: prev.streak.pulse_streak + 1, connection_streak: Math.max(prev.streak.connection_streak, 1) }
        : { user_id: prev.me.id, partner_id: prev.partner!.id, pulse_streak: 1, connection_streak: 1, last_connected_on: new Date().toISOString().slice(0, 10) },
    }))
    try {
      if (supabaseReady) await sendPulse({ receiverId: data.partner!.id, emotion: selectedEmotion.label, intensity: 3 })
      setPulseSent(true)
      window.setTimeout(() => setPulseSent(false), 900)
    } catch (err: any) {
      setError(err?.message || 'Could not send pulse.')
    } finally {
      setTimeout(() => setPulseActive(false), 900)
      setBusy(false)
    }
  }

  async function handleSendMessage() {
    if (!draft.trim() || !data.partner) return
    const body = draft.trim()
    setDraft('')
    const optimistic = {
      id: `msg-${Date.now()}`,
      sender_id: data.me.id,
      receiver_id: data.partner.id,
      body,
      image_url: null,
      reaction: null,
      read_at: null,
      created_at: new Date().toISOString(),
    }
    setData((prev) => ({ ...prev, messages: [optimistic, ...prev.messages] }))
    try {
      if (supabaseReady) await sendMessage({ receiverId: data.partner.id, body })
    } catch (err: any) {
      setError(err?.message || 'Could not send message.')
    }
  }

  async function handleShareMood() {
    const mood = moodOptions.find((item) => item.key === selectedMood) || moodOptions[0]
    const optimistic: PulseMood = {
      id: `mood-${Date.now()}`,
      user_id: data.me.id,
      mood_key: mood.key,
      emoji: mood.emoji,
      color: mood.color,
      note: moodNote || null,
      mood_date: new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(),
    }
    setData((prev) => ({ ...prev, moods: [optimistic, ...prev.moods.filter((item) => item.user_id !== prev.me.id)] }))
    try {
      if (supabaseReady) await shareMood({ mood_key: mood.key, emoji: mood.emoji, color: mood.color, note: moodNote })
    } catch (err: any) {
      setError(err?.message || 'Could not share mood.')
    }
  }

  async function handleGenerateInvite() {
    setBusy(true)
    try {
      const code = supabaseReady ? await generateInviteCode() : 'PULSE42'
      setInviteCode(code)
    } catch (err: any) {
      setError(err?.message || 'Could not create invite.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRedeemInvite() {
    setBusy(true)
    try {
      if (supabaseReady) await redeemInviteCode(redeemValue)
      await refresh()
      setRedeemValue('')
    } catch (err: any) {
      setError(err?.message || 'Could not link partner.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveName() {
    const displayName = name.trim() || 'Love'
    setData((prev) => ({ ...prev, me: { ...prev.me, display_name: displayName, onboarding_complete: true } }))
    try {
      if (supabaseReady) await updatePulseProfile({ display_name: displayName, onboarding_complete: true })
    } catch (err: any) {
      setError(err?.message || 'Could not save profile.')
    }
  }

  async function handleEnablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setError('Notifications are not supported on this device.')
      return
    }

    try {
      setError(null)
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushReady(false)
        return
      }

      let registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' })
      }

      const keyRes = await fetch('/api/push/vapid-public-key', { method: 'GET' })
      const keyJson = await keyRes.json().catch(() => null)
      const vapidKey = keyRes.ok && keyJson?.ok && typeof keyJson.key === 'string' ? keyJson.key : ''
      if (!vapidKey) throw new Error('Missing VAPID public key.')

      const ready = await navigator.serviceWorker.ready
      const existing = await ready.pushManager.getSubscription()
      const subscription =
        existing ??
        (await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }))

      const subscriptionJson = typeof (subscription as any)?.toJSON === 'function' ? (subscription as any).toJSON() : subscription
      const endpoint = (subscription as any)?.endpoint as string | undefined
      if (!endpoint) throw new Error('Missing push endpoint.')

      const upsertRes = await fetch('/api/push/upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subscription: subscriptionJson, endpoint }),
      })
      const upsertJson = await upsertRes.json().catch(() => null)
      if (!upsertRes.ok || !upsertJson?.ok) {
        throw new Error(upsertJson?.error || 'Could not save notification subscription.')
      }

      setPushReady(true)
    } catch (err: any) {
      setPushReady(false)
      setError(err?.message || 'Could not enable notifications.')
    }
  }

  async function handleTestPush() {
    setTestStatus(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setTestStatus(json?.error || 'Test notification failed.')
        return
      }
      setTestStatus(`Sent to ${json.sent ?? 0} device(s).`)
    } catch {
      setTestStatus('Test notification failed.')
    }
  }

  return (
    <main className={`${dark ? 'dark' : ''}`}>
      <div className="min-h-screen overflow-hidden bg-pulse pb-28 text-[#4b3445] transition dark:bg-[#17111b] dark:text-white">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(255,160,190,0.38),transparent_30%),radial-gradient(circle_at_82%_0%,rgba(200,162,255,0.34),transparent_28%),radial-gradient(circle_at_50%_88%,rgba(255,194,138,0.26),transparent_32%)]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+22px)]">
          <header className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar name={data.me.display_name} />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-pink-400">{headerTitle}</p>
                <h1 className="text-2xl font-black tracking-tight">{data.partner ? `${data.me.display_name} + ${data.partner.display_name}` : 'A shared heartbeat'}</h1>
              </div>
            </div>
            <ThemeToggle dark={dark} onToggle={() => setDark((value) => !value)} />
          </header>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ y: -12, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -12, opacity: 0 }}
                className="mb-4 rounded-2xl border border-pink-200 bg-white/75 px-4 py-3 text-xs font-bold text-pink-600 shadow-lg shadow-pink-100/40"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <div className="grid flex-1 place-items-center">
              <GlassCard className="flex items-center gap-3 p-5">
                <Loader2 className="h-5 w-5 animate-spin text-pink-500" />
                <span className="text-sm font-black">Warming up Pulse...</span>
              </GlassCard>
            </div>
          ) : (
            <motion.div layout className="space-y-4">
              {mode === 'home' && (
                <>
                  <PartnerLink
                    connected={connected}
                    inviteCode={inviteCode}
                    onGenerate={handleGenerateInvite}
                    onRedeem={handleRedeemInvite}
                    redeemValue={redeemValue}
                    setRedeemValue={setRedeemValue}
                    busy={busy}
                  />
                  <GlassCard className="relative overflow-hidden p-5 text-center">
                    <div className="mb-4 flex justify-center gap-2">
                      {pulseEmotions.map((emotion) => (
                        <button
                          key={emotion.key}
                          onClick={() => setSelectedEmotion(emotion)}
                          className={`rounded-2xl px-3 py-2 text-xs font-black transition active:scale-95 ${
                            selectedEmotion.key === emotion.key ? 'bg-white text-pink-500 shadow-lg shadow-pink-100/50' : 'bg-white/35 text-[#9c7c91]'
                          }`}
                        >
                          {emotion.emoji}
                        </button>
                      ))}
                    </div>
                    <PulseOrb disabled={!connected || busy} active={pulseActive} sent={pulseSent} onPulse={handlePulse} />
                    <p className="mt-4 text-xl font-black">{selectedEmotion.label}</p>
                    <p className="mx-auto mt-1 max-w-xs text-xs font-semibold leading-5 text-[#977a8f]">
                      A one-tap emotional beep that says, quietly, I am with you.
                    </p>
                  </GlassCard>
                  <StreakCard data={data} />
                  <Timeline data={data} />
                </>
              )}

              {mode === 'messages' && <MessagesPanel data={data} draft={draft} setDraft={setDraft} onSend={handleSendMessage} />}
              {mode === 'mood' && (
                <MoodPanel
                  data={data}
                  selectedMood={selectedMood}
                  setSelectedMood={setSelectedMood}
                  note={moodNote}
                  setNote={setMoodNote}
                  onSave={handleShareMood}
                />
              )}
              {mode === 'settings' && (
                <SettingsPanel
                  data={data}
                  name={name}
                  setName={setName}
                  onSaveName={handleSaveName}
                  onEnablePush={handleEnablePush}
                  onTestPush={handleTestPush}
                  testStatus={testStatus}
                  pushReady={pushReady}
                />
              )}
            </motion.div>
          )}

          {!supabaseReady && (
            <div className="mt-5 rounded-2xl bg-white/45 px-4 py-3 text-xs font-bold leading-5 text-[#8f6680]">
              Demo mode is active until Supabase env vars are configured.
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
