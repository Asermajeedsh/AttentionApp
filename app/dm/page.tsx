'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Image as ImageIcon, Loader2, MapPin, Mic, Pencil, Phone, Plus, Send, Video, X } from 'lucide-react'
import { autoLinkPartner, createOptionalClient, ensureProfile, fetchProfile } from '../../utils/supabase/client'

type MessageRow = {
  id: string
  sender_id: string
  receiver_id: string
  content: string
  created_at: string
  is_read?: boolean | null
  delivered_at?: string | null
  read_at?: string | null
}

type CallRow = {
  id: string
  caller_id: string
  receiver_id?: string
  callee_id?: string
  call_type: 'audio' | 'video'
  status: 'ringing' | 'active' | 'accepted' | 'declined' | 'ended'
  created_at: string
  updated_at: string
  ended_at?: string | null
}

function getCallReceiverId(c: CallRow) {
  return (c.receiver_id || c.callee_id) as string
}

function getCallStatus(c: CallRow): 'ringing' | 'active' | 'declined' | 'ended' {
  const s = c.status
  if (s === 'accepted') return 'active'
  if (s === 'ringing' || s === 'active' || s === 'declined' || s === 'ended') return s
  return 'ringing'
}

const DM_PREFIX = '__ATTN_DM__'
const DM_MEDIA_BUCKET = 'dm-media'

type DmReply = {
  id: string
  snippet: string
  senderId: string
}

type DmPayload =
  | { v: 1; kind: 'text'; text: string; reply?: DmReply }
  | { v: 1; kind: 'image'; bucket: string; path: string; mime: string; name: string; size: number; reply?: DmReply }
  | { v: 1; kind: 'audio'; bucket: string; path: string; mime: string; name: string; size: number; reply?: DmReply }
  | { v: 1; kind: 'image_inline'; dataUrl: string; mime: string; name: string; size: number; reply?: DmReply }
  | { v: 1; kind: 'audio_inline'; dataUrl: string; mime: string; name: string; size: number; reply?: DmReply }
  | { v: 1; kind: 'location'; lat: number; lng: number; accuracy?: number; url: string; reply?: DmReply }

function formatTime(ts: string) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const MOOD_LABELS: Record<string, string> = {
  happy: 'Happy',
  great: 'Great',
  good: 'Good',
  okay: 'Okay',
  overstimulated: 'Overstimulated',
  stressed: 'Stressed',
  sad: 'Sad',
  angry: 'Angry',
  tired: 'Tired',
}

function moodDotClass(mood: string | null) {
  const m = (mood || '').toLowerCase()
  if (m === 'happy') return 'bg-emerald-500'
  if (m === 'great') return 'bg-emerald-500'
  if (m === 'good') return 'bg-green-500'
  if (m === 'okay') return 'bg-yellow-500'
  if (m === 'overstimulated') return 'bg-fuchsia-500'
  if (m === 'stressed') return 'bg-red-500'
  if (m === 'sad') return 'bg-blue-500'
  if (m === 'angry') return 'bg-rose-600'
  if (m === 'tired') return 'bg-violet-500'
  return 'bg-stone-300'
}

function isSecureFeatureAvailable() {
  if (typeof window === 'undefined') return false
  return Boolean((window as any).isSecureContext)
}

function parsePayload(raw: string): { payload: DmPayload | null; fallbackText: string } {
  if (!raw.startsWith(DM_PREFIX)) {
    return { payload: null, fallbackText: raw }
  }

  const json = raw.slice(DM_PREFIX.length)
  try {
    const parsed = JSON.parse(json)
    if (parsed && parsed.v === 1 && typeof parsed.kind === 'string') {
      return { payload: parsed as DmPayload, fallbackText: '' }
    }
  } catch {}

  return { payload: null, fallbackText: raw }
}

function encodePayload(payload: DmPayload) {
  return `${DM_PREFIX}${JSON.stringify(payload)}`
}

function randomId() {
  try {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

async function compressImageToJpegDataUrl(file: File, maxDim: number, quality: number) {
  const bitmap = await createImageBitmap(file)
  const maxSide = Math.max(bitmap.width, bitmap.height)
  const scale = maxSide > maxDim ? maxDim / maxSide : 1
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, 0, 0, width, height)
  ;(bitmap as any).close?.()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to compress image'))),
      'image/jpeg',
      quality
    )
  })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read compressed image'))
    reader.readAsDataURL(blob)
  })

  return { dataUrl, size: blob.size, mime: 'image/jpeg' as const }
}

async function compressImageToFit(file: File, maxBytes: number) {
  if (typeof (globalThis as any).createImageBitmap !== 'function') {
    if (file.size > maxBytes) {
      throw new Error('Image too large')
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Failed to read image'))
      reader.readAsDataURL(file)
    })
    return { dataUrl, size: file.size, mime: file.type || 'image/*' }
  }

  const attempts: Array<{ maxDim: number; quality: number }> = [
    { maxDim: 1440, quality: 0.82 },
    { maxDim: 1280, quality: 0.78 },
    { maxDim: 1152, quality: 0.72 },
    { maxDim: 1024, quality: 0.68 },
    { maxDim: 896, quality: 0.62 },
    { maxDim: 768, quality: 0.56 },
  ]

  let last: { dataUrl: string; size: number; mime: string } | null = null
  for (const a of attempts) {
    const out = await compressImageToJpegDataUrl(file, a.maxDim, a.quality)
    last = out
    if (out.size <= maxBytes) return out
  }
  if (!last) throw new Error('Failed to compress image')
  if (last.size <= maxBytes) return last
  throw new Error('Image too large')
}

async function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const MessageBubble = memo(function MessageBubble(props: {
  message: MessageRow
  mine: boolean
  mediaUrl?: string
  meId: string
  onLongPress: (t: { id: string; mine: boolean; canEdit: boolean; snippet: string; reply?: DmReply }) => void
}) {
  const { message: m, mine, mediaUrl, onLongPress } = props
  const pressTimerRef = useRef<number | null>(null)

  const parsed = useMemo(() => parsePayload(m.content), [m.content])
  const payload = parsed.payload
  const fallbackText = parsed.fallbackText
  const reply = payload?.reply

  const snippet = useMemo(() => {
    if (payload?.kind === 'text') return payload.text.slice(0, 120)
    if (payload?.kind === 'image' || payload?.kind === 'image_inline') return 'Photo'
    if (payload?.kind === 'audio' || payload?.kind === 'audio_inline') return 'Voice note'
    if (payload?.kind === 'location') return 'Location'
    return (fallbackText || '').slice(0, 120)
  }, [fallbackText, payload])

  const editableText = useMemo(() => {
    if (payload?.kind === 'text') return payload.text
    if (payload) return ''
    return fallbackText || ''
  }, [fallbackText, payload])

  const canEdit = mine && Boolean(editableText)

  const resolveMediaUrl = useMemo(() => {
    if (!payload) return null
    if (payload.kind === 'image_inline' || payload.kind === 'audio_inline') return payload.dataUrl
    if (payload.kind === 'image' || payload.kind === 'audio') return mediaUrl || null
    return null
  }, [mediaUrl, payload])

  const bubbleClass = mine
    ? 'bg-[linear-gradient(135deg,#ef7da3_0%,#d67acb_100%)] text-white shadow-lg shadow-rose-200/40'
    : 'bg-white/78 text-stone-700 border border-white/80 shadow-lg shadow-rose-100/30'
  const metaClass = mine ? 'text-rose-200' : 'text-stone-400'

  return (
    <div
      className={`w-full flex ${mine ? 'justify-end' : 'justify-start'}`}
      onPointerDown={() => {
        if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
        pressTimerRef.current = window.setTimeout(() => {
          onLongPress({ id: m.id, mine, canEdit, snippet, reply: reply ?? undefined })
        }, 420)
      }}
      onPointerUp={() => {
        if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
        pressTimerRef.current = null
      }}
      onPointerCancel={() => {
        if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current)
        pressTimerRef.current = null
      }}
    >
      <div className="max-w-[78%]">
        <div className={`px-4 py-3 rounded-[24px] text-[15px] font-medium leading-relaxed backdrop-blur-xl ${bubbleClass}`}>
          {reply && (
            <div className={`mb-2 px-3 py-2 rounded-[16px] text-[12px] font-semibold ${mine ? 'bg-white/15 text-white/90' : 'bg-white/60 text-stone-600'}`}>
              {reply.snippet}
            </div>
          )}

          {payload?.kind === 'image' || payload?.kind === 'image_inline' ? (
            resolveMediaUrl ? (
              <div className="space-y-2">
                <button type="button" onClick={() => window.open(resolveMediaUrl, '_blank')} className="block w-full overflow-hidden rounded-[18px]">
                  <img src={resolveMediaUrl} alt="Shared photo" className="w-full h-auto" />
                </button>
                <div className={`flex items-center gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  <button
                    type="button"
                    onClick={() => downloadUrl(resolveMediaUrl, payload.name || 'photo')}
                    className={`px-3 py-2 rounded-[16px] text-[11px] font-bold uppercase tracking-widest ${mine ? 'bg-white/15 text-white/90' : 'bg-white/60 text-stone-600'}`}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[13px] font-semibold opacity-80">Photo</div>
            )
          ) : payload?.kind === 'audio' || payload?.kind === 'audio_inline' ? (
            resolveMediaUrl ? (
              <div className="space-y-2">
                <audio controls src={resolveMediaUrl} className="w-full" />
                <div className={`flex items-center gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  <button
                    type="button"
                    onClick={() => downloadUrl(resolveMediaUrl, payload.name || 'voice-note')}
                    className={`px-3 py-2 rounded-[16px] text-[11px] font-bold uppercase tracking-widest ${mine ? 'bg-white/15 text-white/90' : 'bg-white/60 text-stone-600'}`}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[13px] font-semibold opacity-80">Voice note</div>
            )
          ) : payload?.kind === 'location' ? (
            <div className="space-y-2">
              <div className={`flex items-center gap-2 ${mine ? 'text-white/90' : 'text-stone-700'}`}>
                <MapPin size={16} />
                <span className="text-[14px] font-semibold">Shared location</span>
              </div>
              <button
                type="button"
                onClick={() => window.open(payload.url, '_blank')}
                className={`w-full px-4 py-3 rounded-[18px] text-[13px] font-bold ${mine ? 'bg-white/15 text-white' : 'bg-white/70 text-stone-700'}`}
              >
                View on Maps
              </button>
            </div>
          ) : payload?.kind === 'text' ? (
            payload.text
          ) : (
            fallbackText
          )}
        </div>

        <div className={`mt-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${mine ? 'justify-end' : 'justify-start'} ${metaClass}`}>
          <span>{formatTime(m.created_at)}</span>
          {mine && <span>{m.read_at || m.is_read ? 'Read' : m.delivered_at ? 'Delivered' : 'Sent'}</span>}
        </div>
      </div>
    </div>
  )
})

export default function DMPage() {
  const router = useRouter()
  const supabase = useMemo(() => createOptionalClient(), [])
  const tabId = useMemo(() => randomId(), [])

  const [callParam, setCallParam] = useState<string | null>(null)
  const [me, setMe] = useState<any>(null)
  const [partner, setPartner] = useState<any>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [text, setText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [replyingTo, setReplyingTo] = useState<DmReply | null>(null)
  const [editing, setEditing] = useState<{ id: string; initial: string; reply?: DmReply } | null>(null)
  const [actionTarget, setActionTarget] = useState<{ id: string; mine: boolean; canEdit: boolean; snippet: string; reply?: DmReply } | null>(null)
  const [plusOpen, setPlusOpen] = useState(false)
  const [mediaUrlsById, setMediaUrlsById] = useState<Record<string, string>>({})
  const [isRecording, setIsRecording] = useState(false)
  const [hasMediaRecorder, setHasMediaRecorder] = useState(false)
  const [partnerMood, setPartnerMood] = useState<string | null>(null)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [partnerActive, setPartnerActive] = useState(false)
  const [incomingCall, setIncomingCall] = useState<CallRow | null>(null)
  const [outgoingCall, setOutgoingCall] = useState<CallRow | null>(null)
  const [activeCall, setActiveCall] = useState<CallRow | null>(null)
  const [callLocalStream, setCallLocalStream] = useState<MediaStream | null>(null)
  const [callRemoteStream, setCallRemoteStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const params = new URLSearchParams(window.location.search)
      const id = params.get('call')
      setCallParam(id)
    } catch {}
  }, [])

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messagesRef = useRef<MessageRow[]>([])
  const incomingCallRef = useRef<CallRow | null>(null)
  const outgoingCallRef = useRef<CallRow | null>(null)
  const activeCallRef = useRef<CallRow | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const dmChannelRef = useRef<any>(null)
  const typingStopTimerRef = useRef<number | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const pcDisconnectTimerRef = useRef<number | null>(null)
  const callLocalRef = useRef<MediaStream | null>(null)
  const callRemoteRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const mediaUrlsRef = useRef<Record<string, string>>({})
  const callLockRenewRef = useRef<number | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    incomingCallRef.current = incomingCall
  }, [incomingCall])

  useEffect(() => {
    outgoingCallRef.current = outgoingCall
  }, [outgoingCall])

  useEffect(() => {
    activeCallRef.current = activeCall
  }, [activeCall])

  useEffect(() => {
    mediaUrlsRef.current = mediaUrlsById
  }, [mediaUrlsById])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setHasMediaRecorder(typeof (window as any).MediaRecorder === 'function')
  }, [])

  useEffect(() => {
    callLocalRef.current = callLocalStream
    if (localVideoRef.current) {
      ;(localVideoRef.current as any).srcObject = callLocalStream
    }
  }, [callLocalStream])

  useEffect(() => {
    callRemoteRef.current = callRemoteStream
    if (remoteVideoRef.current) {
      ;(remoteVideoRef.current as any).srcObject = callRemoteStream
    }
    if (remoteAudioRef.current) {
      ;(remoteAudioRef.current as any).srcObject = callRemoteStream
    }
  }, [callRemoteStream])

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    bottomRef.current?.scrollIntoView({ behavior, block: 'end' })
  }, [])

  const acquireCallLock = useCallback(
    (callId: string) => {
      if (typeof window === 'undefined') return true
      try {
        const key = `attention_call_lock:${callId}`
        const now = Date.now()
        const ttlMs = 15_000
        const raw = localStorage.getItem(key)
        if (raw) {
          try {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed.expiresAt === 'number' && parsed.expiresAt > now && parsed.tabId !== tabId) {
              return false
            }
          } catch {}
        }
        localStorage.setItem(key, JSON.stringify({ tabId, expiresAt: now + ttlMs }))
        return true
      } catch {
        return true
      }
    },
    [tabId]
  )

  const renewCallLock = useCallback(
    (callId: string) => {
      if (typeof window === 'undefined') return
      try {
        const key = `attention_call_lock:${callId}`
        const now = Date.now()
        const ttlMs = 15_000
        localStorage.setItem(key, JSON.stringify({ tabId, expiresAt: now + ttlMs }))
      } catch {}
    },
    [tabId]
  )

  const releaseCallLock = useCallback(
    (callId: string) => {
      if (typeof window === 'undefined') return
      try {
        localStorage.removeItem(`attention_call_lock:${callId}`)
      } catch {}
    },
    []
  )

  useEffect(() => {
    const currentId = activeCall?.id || outgoingCall?.id || incomingCall?.id || null
    if (!currentId) return

    if (!acquireCallLock(currentId)) return

    renewCallLock(currentId)
    if (callLockRenewRef.current) window.clearInterval(callLockRenewRef.current)
    callLockRenewRef.current = window.setInterval(() => renewCallLock(currentId), 7000)

    return () => {
      if (callLockRenewRef.current) {
        window.clearInterval(callLockRenewRef.current)
        callLockRenewRef.current = null
      }
      releaseCallLock(currentId)
    }
  }, [acquireCallLock, activeCall?.id, incomingCall?.id, outgoingCall?.id, releaseCallLock, renewCallLock])

  const setMyTyping = useCallback((typing: boolean) => {
    const channel = dmChannelRef.current
    if (!channel) return

    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current)
      typingStopTimerRef.current = null
    }

    channel.track({ online: true, typing, chatOpen: document.visibilityState === 'visible' }).catch(() => {})

    if (typing) {
      typingStopTimerRef.current = window.setTimeout(() => {
        channel.track({ online: true, typing: false, chatOpen: document.visibilityState === 'visible' }).catch(() => {})
        typingStopTimerRef.current = null
      }, 900)
    }
  }, [])

  const sendTransparentNotification = useCallback(
    async (input: { type: string; content: string; dedupeKey?: string; url?: string; callId?: string }) => {
      if (!me?.id) return
      const content = (input.content || '').toString()
      fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: input.type === 'message' ? 'dm' : input.type,
          content,
          dedupeKey: input.dedupeKey,
          url: input.url,
          callId: input.callId,
        }),
      }).catch((e) => console.error('[dm] send-notification failed', e))
    },
    [me?.id]
  )

  const cleanupWebRtc = useCallback(() => {
    try {
      if (pcDisconnectTimerRef.current) {
        window.clearTimeout(pcDisconnectTimerRef.current)
        pcDisconnectTimerRef.current = null
      }
    } catch {}

    try {
      pcRef.current?.getSenders().forEach((s) => {
        try {
          s.track?.stop()
        } catch {}
      })
      pcRef.current?.close()
    } catch {}
    pcRef.current = null

    try {
      callLocalRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}
    try {
      callRemoteRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}

    callLocalRef.current = null
    callRemoteRef.current = null
    setCallLocalStream(null)
    setCallRemoteStream(null)
    setIsMuted(false)
    setIsCameraOff(false)
  }, [])

  const waitForIceGatheringComplete = useCallback(async (pc: RTCPeerConnection, timeoutMs = 2500) => {
    if (pc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      let resolved = false
      const done = () => {
        if (resolved) return
        resolved = true
        pc.removeEventListener('icegatheringstatechange', onChange)
        resolve()
      }
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') done()
      }
      const timer = window.setTimeout(done, Math.max(250, timeoutMs))
      pc.addEventListener('icegatheringstatechange', onChange)
      onChange()
      if (resolved) window.clearTimeout(timer)
    })
  }, [])

  const createPeerConnection = useCallback(
    (callType: 'audio' | 'video', localStream: MediaStream) => {
      const defaultIceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
      const env = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS
      const iceServers = (() => {
        if (!env) return defaultIceServers
        try {
          const parsed = JSON.parse(env)
          if (!Array.isArray(parsed)) return defaultIceServers
          const cleaned = parsed
            .map((s) => {
              if (!s || typeof s !== 'object') return null
              const urls = (s as any).urls
              if (!urls) return null
              const entry: any = { urls }
              if (typeof (s as any).username === 'string') entry.username = (s as any).username
              if (typeof (s as any).credential === 'string') entry.credential = (s as any).credential
              return entry
            })
            .filter(Boolean)
          return cleaned.length > 0 ? (cleaned as any) : defaultIceServers
        } catch {
          return defaultIceServers
        }
      })()

      const pc = new RTCPeerConnection({ iceServers })

      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream)
      }

      const remoteStream = new MediaStream()
      pc.addEventListener('track', (e) => {
        for (const t of e.streams?.[0]?.getTracks?.() || []) {
          if (!remoteStream.getTracks().some((x) => x.id === t.id)) remoteStream.addTrack(t)
        }
        if (e.track && !remoteStream.getTracks().some((x) => x.id === e.track.id)) {
          remoteStream.addTrack(e.track)
        }
        setCallRemoteStream(remoteStream)
      })

      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') {
          if (pcDisconnectTimerRef.current) {
            window.clearTimeout(pcDisconnectTimerRef.current)
            pcDisconnectTimerRef.current = null
          }
          return
        }

        if (pc.connectionState === 'disconnected') {
          if (pcDisconnectTimerRef.current) window.clearTimeout(pcDisconnectTimerRef.current)
          pcDisconnectTimerRef.current = window.setTimeout(() => {
            if (pc.connectionState !== 'disconnected') return
            try {
              pc.restartIce?.()
            } catch {}
          }, 2500)
          return
        }

        if (pc.connectionState === 'failed') {
          try {
            pc.restartIce?.()
          } catch {}
          if (pcDisconnectTimerRef.current) window.clearTimeout(pcDisconnectTimerRef.current)
          pcDisconnectTimerRef.current = window.setTimeout(() => {
            if (pc.connectionState === 'connected') return
            cleanupWebRtc()
          }, 4000)
          return
        }

        if (pc.connectionState === 'closed') {
          cleanupWebRtc()
        }
      })

      pcRef.current = pc
      setCallLocalStream(localStream)
      setCallRemoteStream(remoteStream)
      if (callType === 'audio') {
        remoteStream.getAudioTracks().forEach((t) => (t.enabled = true))
      }

      return pc
    },
    [cleanupWebRtc]
  )

  const reconnectToActiveCall = useCallback(
    async (row: any) => {
      if (!supabase || !me?.id) return
      if (pcRef.current) return
      if (!isSecureFeatureAvailable()) return

      const callType = row?.call_type === 'video' ? 'video' : 'audio'
      const offerType = row?.offer_type as RTCSdpType | undefined
      const offerSdp = row?.offer_sdp as string | undefined
      const answerType = row?.answer_type as RTCSdpType | undefined
      const answerSdp = row?.answer_sdp as string | undefined
      if (!offerType || !offerSdp || !answerType || !answerSdp) return

      let localStream: MediaStream
      try {
        const constraints = callType === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true }
        localStream = await navigator.mediaDevices.getUserMedia(constraints as any)
      } catch {
        return
      }

      const pc = createPeerConnection(callType, localStream)

      if (row?.caller_id === me.id) {
        await pc.setLocalDescription({ type: offerType, sdp: offerSdp })
        await pc.setRemoteDescription({ type: answerType, sdp: answerSdp })
      } else {
        await pc.setRemoteDescription({ type: offerType, sdp: offerSdp })
        await pc.setLocalDescription({ type: answerType, sdp: answerSdp })
      }
    },
    [createPeerConnection, me?.id, supabase]
  )

  const hydrateCallById = useCallback(
    async (callId: string) => {
      if (!supabase || !me?.id) return
      const { data, error: loadError } = await supabase.from('calls').select('*').eq('id', callId).limit(1).maybeSingle()
      if (loadError || !data) return

      const receiverId = getCallReceiverId(data as any)
      const isParticipant = data.caller_id === me.id || receiverId === me.id
      if (!isParticipant) return

      const otherId = data.caller_id === me.id ? receiverId : data.caller_id
      if (!partner?.id || partner.id !== otherId) {
        const otherProfile = await fetchProfile(otherId).catch(() => null)
        if (otherProfile) setPartner(otherProfile)
      }

      const status = getCallStatus(data as any)
      if (status === 'ringing') {
        if (receiverId === me.id) {
          if (!acquireCallLock(callId)) return
          setIncomingCall({ ...(data as any), status })
          setOutgoingCall(null)
          setActiveCall(null)
          window.navigator.vibrate?.(50)
          return
        }
        if (data.caller_id === me.id) {
          setOutgoingCall({ ...(data as any), status })
          setIncomingCall(null)
          setActiveCall(null)
          return
        }
      }

      if (status === 'active') {
        if (!acquireCallLock(callId)) return
        setActiveCall({ ...(data as any), status })
        setIncomingCall(null)
        setOutgoingCall(null)
        reconnectToActiveCall(data).catch(() => {})
        return
      }

      setIncomingCall(null)
      setOutgoingCall(null)
      setActiveCall(null)
    },
    [acquireCallLock, me?.id, partner?.id, reconnectToActiveCall, supabase]
  )

  const markIncomingAsRead = useCallback(async (userId: string, partnerId: string) => {
    if (!supabase) return
    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('messages')
      .update({ is_read: true, read_at: now, delivered_at: now })
      .eq('receiver_id', userId)
      .eq('sender_id', partnerId)
      .or('read_at.is.null,is_read.is.null,is_read.eq.false')

    if (updateError) {
      const msg = typeof updateError.message === 'string' ? updateError.message.toLowerCase() : ''
      if (msg.includes('messages')) {
        setError('Database schema is missing the messages table.')
        return
      }
      console.error('[dm] mark read failed', updateError)
      setError('Read receipts are blocked by database permissions.')
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.receiver_id === userId && m.sender_id === partnerId
            ? { ...m, is_read: true, read_at: now, delivered_at: m.delivered_at ?? now }
            : m
        )
      )
    }
  }, [supabase])

  const markIncomingAsDelivered = useCallback(async (userId: string, partnerId: string) => {
    if (!supabase) return
    const now = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('messages')
      .update({ delivered_at: now })
      .eq('receiver_id', userId)
      .eq('sender_id', partnerId)
      .is('delivered_at', null)

    if (!updateError) {
      setMessages((prev) =>
        prev.map((m) =>
          m.receiver_id === userId && m.sender_id === partnerId && !m.delivered_at ? { ...m, delivered_at: now } : m
        )
      )
    }
  }, [supabase])

  const loadMessages = useCallback(async (userId: string, partnerId: string) => {
    if (!supabase) return

    const orFilter = `and(sender_id.eq.${userId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${userId})`
    const { data, error: loadError } = await supabase
      .from('messages')
      .select('*')
      .or(orFilter)
      .order('created_at', { ascending: true })

    if (loadError) {
      const msg = typeof loadError.message === 'string' ? loadError.message.toLowerCase() : ''
      if (msg.includes('messages')) {
        throw new Error('Database schema is missing the messages table.')
      }
      throw loadError
    }

    setMessages((data as MessageRow[]) ?? [])
  }, [supabase])

  useEffect(() => {
    async function init() {
      if (!supabase) {
        setError('Supabase is not configured.')
        setIsLoading(false)
        return
      }

      const { data: authData } = await supabase.auth.getUser()
      const authUser = authData.user
      if (!authUser) {
        setIsLoading(false)
        router.push('/signin')
        return
      }

      const myProfile = await ensureProfile(authUser)
      setMe(myProfile)

      const partnerId = myProfile?.partner_id ?? null
      if (!partnerId) {
        setPartner(null)
        setMessages([])
        setIsLoading(false)
        return
      }

      const partnerProfile = await fetchProfile(partnerId)
      setPartner(partnerProfile)

      const { data: latestMood, error: moodError } = await supabase
        .from('mood_entries')
        .select('mood')
        .eq('user_id', partnerId)
        .order('mood_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!moodError) {
        setPartnerMood((latestMood as any)?.mood ?? null)
      }

      await loadMessages(authUser.id, partnerId)
      await markIncomingAsDelivered(authUser.id, partnerId)
      await markIncomingAsRead(authUser.id, partnerId)

      setIsLoading(false)
      scrollToBottom('auto')
    }

    init().catch((e) => {
      console.error('[dm] init error', e)
      setError(e?.message || 'Failed to load.')
      setIsLoading(false)
    })
  }, [loadMessages, markIncomingAsDelivered, markIncomingAsRead, router, scrollToBottom, supabase])

  useEffect(() => {
    if (!supabase || !me?.id || !callParam) return
    hydrateCallById(callParam).catch(() => {})
  }, [callParam, hydrateCallById, me?.id, supabase])

  useEffect(() => {
    if (!supabase || !me?.id || !partner?.id) return

    const room = [me.id, partner.id].sort().join(':')
    const channel = supabase
      .channel(`dm:${room}`, { config: { presence: { key: me.id } } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as MessageRow
        const between =
          (row.sender_id === me.id && row.receiver_id === partner.id) ||
          (row.sender_id === partner.id && row.receiver_id === me.id)

        if (!between) return

        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev
          if (prev.length === 0) return [row]
          const last = prev[prev.length - 1]
          if (new Date(row.created_at).getTime() >= new Date(last.created_at).getTime()) {
            return [...prev, row]
          }
          const next = prev.slice()
          let i = next.length - 1
          while (i >= 0 && new Date(next[i].created_at).getTime() > new Date(row.created_at).getTime()) i--
          next.splice(i + 1, 0, row)
          return next
        })

        scrollToBottom('smooth')

        if (row.receiver_id === me.id) {
          window.navigator.vibrate?.(50)
          markIncomingAsDelivered(me.id, partner.id).catch(() => {})
          if (document.visibilityState === 'visible') {
            markIncomingAsRead(me.id, partner.id).catch(() => {})
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as MessageRow
        const between =
          (row.sender_id === me.id && row.receiver_id === partner.id) ||
          (row.sender_id === partner.id && row.receiver_id === me.id)
        if (!between) return

        setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)))
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as any
        const partnerState = state?.[partner.id]?.[0] || null
        setPartnerActive(Boolean(partnerState))
        setPartnerTyping(Boolean(partnerState?.typing))
      })
      .on('presence', { event: 'join' }, () => {
        const state = channel.presenceState() as any
        const partnerState = state?.[partner.id]?.[0] || null
        setPartnerActive(Boolean(partnerState))
        setPartnerTyping(Boolean(partnerState?.typing))
      })
      .on('presence', { event: 'leave' }, () => {
        const state = channel.presenceState() as any
        const partnerState = state?.[partner.id]?.[0] || null
        setPartnerActive(Boolean(partnerState))
        setPartnerTyping(Boolean(partnerState?.typing))
      })
      .subscribe()

    dmChannelRef.current = channel

    const track = async (patch: Record<string, any>) => {
      try {
        await channel.track({ online: true, typing: false, chatOpen: document.visibilityState === 'visible', ...patch })
      } catch {}
    }

    track({}).catch(() => {})

    return () => {
      dmChannelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [markIncomingAsDelivered, markIncomingAsRead, me?.id, partner?.id, scrollToBottom, supabase])

  useEffect(() => {
    if (!supabase || !partner?.id) return

    const channel = supabase
      .channel(`mood:${partner.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mood_entries', filter: `user_id=eq.${partner.id}` } as any,
        (payload) => setPartnerMood((payload.new as any)?.mood ?? null)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mood_entries', filter: `user_id=eq.${partner.id}` } as any,
        (payload) => setPartnerMood((payload.new as any)?.mood ?? null)
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [partner?.id, supabase])

  useEffect(() => {
    if (!supabase || !me?.id || !partner?.id) return

    const channel = supabase
      .channel(`calls:${[me.id, partner.id].sort().join(':')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls' }, (payload) => {
        const row = payload.new as CallRow
        const receiverId = getCallReceiverId(row)
        const status = getCallStatus(row)
        const between =
          (row.caller_id === me.id && receiverId === partner.id) ||
          (row.caller_id === partner.id && receiverId === me.id)
        if (!between) return

        if (status === 'ringing' && receiverId === me.id) {
          if (!acquireCallLock(row.id)) return
          setIncomingCall({ ...row, status })
          window.navigator.vibrate?.(50)
        }
        if (status === 'ringing' && row.caller_id === me.id) {
          setOutgoingCall({ ...row, status })
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (payload) => {
        const row = payload.new as CallRow
        const receiverId = getCallReceiverId(row)
        const status = getCallStatus(row)
        const between =
          (row.caller_id === me.id && receiverId === partner.id) ||
          (row.caller_id === partner.id && receiverId === me.id)
        if (!between) return

        if (status === 'active') {
          if (!acquireCallLock(row.id)) return
          setActiveCall({ ...row, status })
          setIncomingCall(null)
          setOutgoingCall(null)
          if (!pcRef.current) {
            reconnectToActiveCall(row as any).catch(() => {})
          }

          if (row.caller_id === me.id) {
            const answerSdp = (row as any).answer_sdp as string | null | undefined
            const answerType = (row as any).answer_type as RTCSdpType | null | undefined
            const pc = pcRef.current
            if (pc && answerSdp && answerType && !pc.currentRemoteDescription) {
              pc.setRemoteDescription({ type: answerType, sdp: answerSdp }).catch((e) => {
                console.error('[call] setRemoteDescription failed', e)
              })
            }
          }
        } else if (status === 'ended' || status === 'declined') {
          cleanupWebRtc()
          releaseCallLock(row.id)
          setActiveCall(null)
          setIncomingCall(null)
          setOutgoingCall(null)
        } else if (status === 'ringing') {
          if (receiverId === me.id) {
            if (!acquireCallLock(row.id)) return
            setIncomingCall({ ...row, status })
          }
          if (row.caller_id === me.id) setOutgoingCall({ ...row, status })
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [acquireCallLock, cleanupWebRtc, me?.id, partner?.id, reconnectToActiveCall, releaseCallLock, supabase])

  useEffect(() => {
    if (!supabase || !me?.id || !partner?.id) return

    const interval = window.setInterval(async () => {
      const snapshot = messagesRef.current
      const hasUnreadOutgoing = snapshot.some((m) => m.sender_id === me.id && m.receiver_id === partner.id && !(m.read_at || m.is_read))
      if (!hasUnreadOutgoing) return

      const { data, error: pollError } = await supabase
        .from('messages')
        .select('id,is_read,read_at,delivered_at')
        .eq('sender_id', me.id)
        .eq('receiver_id', partner.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (pollError) return

      const byId = new Map<string, { is_read?: boolean | null; read_at?: string | null; delivered_at?: string | null }>()
      for (const row of (data as any[]) || []) {
        byId.set(row.id, { is_read: row.is_read, read_at: row.read_at, delivered_at: row.delivered_at })
      }

      setMessages((prev) =>
        prev.map((m) => (byId.has(m.id) ? { ...m, ...(byId.get(m.id) as any) } : m))
      )
    }, 4000)

    return () => window.clearInterval(interval)
  }, [me?.id, partner?.id, supabase])

  useEffect(() => {
    if (messages.length === 0) return
    scrollToBottom('auto')
  }, [messages.length, scrollToBottom])

  const ensureMediaUrl = useCallback(
    async (messageId: string, payload: DmPayload) => {
      if (!supabase) return
      if (payload.kind !== 'image' && payload.kind !== 'audio') return
      if (mediaUrlsRef.current[messageId]) return

      try {
        const { data: signed, error: signedErr } = await supabase.storage
          .from(payload.bucket)
          .createSignedUrl(payload.path, 60 * 60 * 24 * 7)

        if (!signedErr && signed?.signedUrl) {
          setMediaUrlsById((prev) => ({ ...prev, [messageId]: signed.signedUrl }))
          return
        }
      } catch {}

      try {
        const { data } = supabase.storage.from(payload.bucket).getPublicUrl(payload.path)
        if (data?.publicUrl) {
          setMediaUrlsById((prev) => ({ ...prev, [messageId]: data.publicUrl }))
        }
      } catch {}
    },
    [supabase]
  )

  useEffect(() => {
    if (!supabase) return
    const next: Array<{ id: string; payload: DmPayload }> = []
    for (const m of messages) {
      const { payload } = parsePayload(m.content)
      if (payload && (payload.kind === 'image' || payload.kind === 'audio')) {
        next.push({ id: m.id, payload })
      }
    }

    if (next.length === 0) return

    next.forEach(({ id, payload }) => {
      ensureMediaUrl(id, payload).catch(() => {})
    })
  }, [ensureMediaUrl, messages, supabase])

  const sendTextMessage = useCallback(async () => {
    if (!supabase || !me?.id || !partner?.id) return
    if (isSending) return
    const trimmed = text.trim()
    if (!trimmed) return

    setMyTyping(false)
    setIsSending(true)
    setError(null)

    try {
      if (editing) {
        const payload: DmPayload = { v: 1, kind: 'text', text: trimmed, reply: editing.reply ?? undefined }
        const content = encodePayload(payload)

        const { data, error: updateError } = await supabase
          .from('messages')
          .update({ content })
          .eq('id', editing.id)
          .eq('sender_id', me.id)
          .select('*')
          .single()

        if (updateError) {
          throw updateError
        }

        const row = data as MessageRow
        setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)))
        setText('')
        setEditing(null)
        window.navigator.vibrate?.(10)
        scrollToBottom('smooth')
      } else {
        const payload: DmPayload = { v: 1, kind: 'text', text: trimmed, reply: replyingTo ?? undefined }
        const content = encodePayload(payload)
        const { data, error: insertError } = await supabase
          .from('messages')
          .insert([{ sender_id: me.id, receiver_id: partner.id, content }])
          .select('*')
          .single()

        if (insertError) {
          const msg = typeof insertError.message === 'string' ? insertError.message.toLowerCase() : ''
          if (msg.includes('messages')) {
            throw new Error('Database schema is missing the messages table.')
          }
          throw insertError
        }

        const row = data as MessageRow
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
        setText('')
        setReplyingTo(null)
        window.navigator.vibrate?.(10)
        sendTransparentNotification({ type: 'message', content: trimmed, dedupeKey: row.id, url: '/dm' }).catch(() => {})
        scrollToBottom('smooth')
      }
    } catch (e: any) {
      console.error('[dm] send error', e)
      setError(e?.message || 'Failed to send.')
    } finally {
      setIsSending(false)
    }
  }, [editing, isSending, me?.id, partner?.id, replyingTo, scrollToBottom, sendTransparentNotification, setMyTyping, supabase, text])

  const sendQuickText = useCallback(
    async (value: string) => {
      if (!supabase || !me?.id || !partner?.id) return
      if (isSending) return
      const trimmed = value.trim()
      if (!trimmed) return

      setIsSending(true)
      setError(null)

      try {
        const alreadyEncoded = trimmed.startsWith(DM_PREFIX)
        const content = alreadyEncoded ? trimmed : encodePayload({ v: 1, kind: 'text', text: trimmed })
        const parsed = alreadyEncoded ? parsePayload(trimmed) : { payload: null as DmPayload | null, fallbackText: trimmed }
        const notifContent =
          parsed.payload?.kind === 'text'
            ? parsed.payload.text
            : parsed.payload?.kind === 'image' || parsed.payload?.kind === 'image_inline'
              ? '📷 Photo'
              : parsed.payload?.kind === 'audio' || parsed.payload?.kind === 'audio_inline'
                ? '🎤 Voice note'
                : parsed.payload?.kind === 'location'
                  ? '📍 Location'
                  : trimmed
        const { data, error: insertError } = await supabase
          .from('messages')
          .insert([{ sender_id: me.id, receiver_id: partner.id, content }])
          .select('*')
          .single()


        if (insertError) {
          throw insertError
        }

        const row = data as MessageRow
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
        setReplyingTo(null)
        setEditing(null)
        window.navigator.vibrate?.(10)
        sendTransparentNotification({ type: 'message', content: notifContent, dedupeKey: row.id, url: '/dm' }).catch(() => {})
        scrollToBottom('smooth')
      } catch (e: any) {
        console.error('[dm] quick send error', e)
        setError(e?.message || 'Failed to send.')
      } finally {
        setIsSending(false)
      }
    },
    [isSending, me?.id, partner?.id, scrollToBottom, sendTransparentNotification, supabase]
  )

  const startCall = useCallback(
    async (callType: 'audio' | 'video') => {
      if (!supabase || !me?.id || !partner?.id) return
      if (!isSecureFeatureAvailable()) {
        setError('Calling requires HTTPS (secure context).')
        return
      }

      setError(null)

      cleanupWebRtc()

      let localStream: MediaStream
      try {
        const constraints = callType === 'video' ? { audio: true, video: { facingMode: 'user' } } : { audio: true }
        localStream = await navigator.mediaDevices.getUserMedia(constraints as any)
      } catch (e) {
        console.error('[call] permission error', e)
        setError(callType === 'video' ? 'Camera/Microphone permission denied.' : 'Microphone permission denied.')
        return
      }

      const pc = createPeerConnection(callType, localStream)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitForIceGatheringComplete(pc)

      const localDesc = pc.localDescription
      if (!localDesc) {
        setError('Failed to create call offer.')
        cleanupWebRtc()
        return
      }

      const { data, error: insertError } = await supabase
        .from('calls')
        .insert([
          {
            caller_id: me.id,
            receiver_id: partner.id,
            call_type: callType,
            status: 'ringing',
            offer_type: localDesc.type,
            offer_sdp: localDesc.sdp,
          },
        ])
        .select('*')
        .single()

      if (insertError) {
        setError('Calling is not configured in the database yet.')
        cleanupWebRtc()
        return
      }

      const call = data as CallRow
      setOutgoingCall(call)
      setIncomingCall(null)
      setActiveCall(null)

      fetch('/api/send-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: call.id, receiverId: partner.id, callType }),
      }).catch(() => {})
    },
    [cleanupWebRtc, createPeerConnection, me?.id, partner?.id, supabase, waitForIceGatheringComplete]
  )

  const updateCallStatus = useCallback(
    async (callId: string, status: CallRow['status']) => {
      if (!supabase) return
      const patch: any = { status, updated_at: new Date().toISOString() }
      if (status === 'ended') {
        patch.ended_at = new Date().toISOString()
      }

      await supabase.from('calls').update(patch).eq('id', callId)
    },
    [supabase]
  )

  useEffect(() => {
    if (!supabase || !me?.id || !partner?.id) return
    const status = outgoingCall?.status === 'accepted' ? 'active' : outgoingCall?.status
    if (!outgoingCall?.id || status !== 'ringing') return

    const callId = outgoingCall.id
    const createdAtMs = new Date(outgoingCall.created_at).getTime()
    const timeoutMs = 45_000
    const remaining = Math.max(0, timeoutMs - (Date.now() - createdAtMs))

    const timer = window.setTimeout(async () => {
      const snapshot = outgoingCallRef.current
      if (!snapshot || snapshot.id !== callId || getCallStatus(snapshot) !== 'ringing') return
      await updateCallStatus(callId, 'ended')
      releaseCallLock(callId)
      cleanupWebRtc()
      setOutgoingCall(null)
      fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'missed_call',
          receiverId: partner.id,
          content: 'Missed call',
          callId,
          dedupeKey: callId,
          url: `/calls?call=${encodeURIComponent(callId)}`,
        }),
      }).catch(() => {})
    }, remaining)

    return () => window.clearTimeout(timer)
  }, [cleanupWebRtc, me?.id, outgoingCall?.created_at, outgoingCall?.id, outgoingCall?.status, partner?.id, releaseCallLock, supabase, updateCallStatus])

  useEffect(() => {
    if (!supabase || !me?.id) return
    const status = incomingCall?.status === 'accepted' ? 'active' : incomingCall?.status
    if (!incomingCall?.id || status !== 'ringing') return
    if (getCallReceiverId(incomingCall) !== me.id) return

    const callId = incomingCall.id
    const createdAtMs = new Date(incomingCall.created_at).getTime()
    const timeoutMs = 90_000
    const remaining = Math.max(0, timeoutMs - (Date.now() - createdAtMs))

    const timer = window.setTimeout(async () => {
      const snapshot = incomingCallRef.current
      if (!snapshot || snapshot.id !== callId) return
      const snapStatus = snapshot.status === 'accepted' ? 'active' : snapshot.status
      if (snapStatus !== 'ringing') return
      await updateCallStatus(callId, 'ended')
      releaseCallLock(callId)
      setIncomingCall(null)
    }, remaining)

    return () => window.clearTimeout(timer)
  }, [incomingCall, incomingCall?.created_at, incomingCall?.id, incomingCall?.status, me?.id, releaseCallLock, supabase, updateCallStatus])

  useEffect(() => {
    if (!supabase || !me?.id) return

    const handler = () => {
      const active = activeCallRef.current
      const outgoing = outgoingCallRef.current
      const incoming = incomingCallRef.current

      if (active?.id) {
        updateCallStatus(active.id, 'ended').catch(() => {})
        releaseCallLock(active.id)
      }
      if (outgoing?.id && getCallStatus(outgoing) === 'ringing') {
        updateCallStatus(outgoing.id, 'ended').catch(() => {})
        releaseCallLock(outgoing.id)
      }
      if (incoming?.id && getCallStatus(incoming) === 'ringing') {
        updateCallStatus(incoming.id, 'declined').catch(() => {})
        releaseCallLock(incoming.id)
      }
      cleanupWebRtc()
    }

    window.addEventListener('pagehide', handler)
    window.addEventListener('beforeunload', handler)
    return () => {
      window.removeEventListener('pagehide', handler)
      window.removeEventListener('beforeunload', handler)
    }
  }, [cleanupWebRtc, me?.id, releaseCallLock, supabase, updateCallStatus])

  const uploadAndSend = useCallback(
    async (input: { kind: 'image' | 'audio'; file: File }) => {
      if (!supabase || !me?.id || !partner?.id) return
      if (isSending) return

      setMyTyping(false)
      setIsSending(true)
      setError(null)

      try {
        if (input.kind === 'image') {
          const inlineTargetBytes = 1_300_000
          try {
            const compressed = await compressImageToFit(input.file, inlineTargetBytes)
            const inlinePayload: DmPayload = {
              v: 1,
              kind: 'image_inline',
              dataUrl: compressed.dataUrl,
              mime: compressed.mime,
              name: (input.file.name || `photo-${Date.now()}.jpg`).replace(/\.[^.]+$/, '.jpg'),
              size: compressed.size,
              reply: replyingTo ?? undefined,
            }

            const content = encodePayload(inlinePayload)
            const { data, error: insertError } = await supabase
              .from('messages')
              .insert([{ sender_id: me.id, receiver_id: partner.id, content }])
              .select('*')
              .single()

            if (insertError) {
              throw insertError
            }

            const row = data as MessageRow
            setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
            setReplyingTo(null)
            window.navigator.vibrate?.(10)
            sendTransparentNotification({ type: 'message', content: '📷 Photo', dedupeKey: row.id, url: '/dm' }).catch(() => {})
            scrollToBottom('smooth')
            return
          } catch (e) {
            console.error('[dm] inline image failed, falling back to storage', e)
          }
        }

        const ext = (() => {
          const byName = input.file.name.split('.').pop()?.toLowerCase() || ''
          if (byName) return byName
          if (input.file.type === 'image/jpeg') return 'jpg'
          if (input.file.type === 'image/png') return 'png'
          if (input.file.type === 'image/webp') return 'webp'
          if (input.file.type === 'audio/webm') return 'webm'
          if (input.file.type === 'audio/mp4') return 'm4a'
          return 'bin'
        })()

        const path = `dm/${me.id}/${Date.now()}-${randomId()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from(DM_MEDIA_BUCKET)
          .upload(path, input.file, { contentType: input.file.type, upsert: false })

        if (uploadError) {
          const maxInlineBytes = input.kind === 'image' ? 1_500_000 : 700_000

          const readAsDataUrl = (f: Blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result || ''))
              reader.onerror = () => reject(new Error('Failed to read file'))
              reader.readAsDataURL(f)
            })

          if (input.kind === 'image') {
            try {
              const compressed = await compressImageToFit(input.file, maxInlineBytes)
              const inlinePayload: DmPayload = {
                v: 1,
                kind: 'image_inline',
                dataUrl: compressed.dataUrl,
                mime: compressed.mime,
                name: (input.file.name || `photo-${Date.now()}.jpg`).replace(/\.[^.]+$/, '.jpg'),
                size: compressed.size,
                reply: replyingTo ?? undefined,
              }
              const content = encodePayload(inlinePayload)
              const { data, error: insertError } = await supabase
                .from('messages')
                .insert([{ sender_id: me.id, receiver_id: partner.id, content }])
                .select('*')
                .single()

              if (insertError) throw insertError

              const row = data as MessageRow
              setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
              setReplyingTo(null)
              window.navigator.vibrate?.(10)
              sendTransparentNotification({ type: 'message', content: '📷 Photo', dedupeKey: row.id, url: '/dm' }).catch(() => {})
              scrollToBottom('smooth')
              return
            } catch {}
          }

          if (input.file.size <= maxInlineBytes) {
            const dataUrl = await readAsDataUrl(input.file)

            const inlineBase = {
              v: 1 as const,
              dataUrl,
              mime: input.file.type || 'application/octet-stream',
              name: input.file.name || `${input.kind}.${ext}`,
              size: input.file.size,
              reply: replyingTo ?? undefined,
            }

            const inlinePayload: DmPayload =
              input.kind === 'image'
                ? { ...inlineBase, kind: 'image_inline' }
                : { ...inlineBase, kind: 'audio_inline' }

            const content = encodePayload(inlinePayload)
            const { data, error: insertError } = await supabase
              .from('messages')
              .insert([{ sender_id: me.id, receiver_id: partner.id, content }])
              .select('*')
              .single()

            if (insertError) {
              throw insertError
            }

            const row = data as MessageRow
            setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
            setReplyingTo(null)
            window.navigator.vibrate?.(10)
            sendTransparentNotification({
              type: 'message',
              content: input.kind === 'image' ? '📷 Photo' : '🎤 Voice note',
              dedupeKey: row.id,
              url: '/dm',
            }).catch(() => {})
            scrollToBottom('smooth')
            return
          }

          const msg = typeof uploadError.message === 'string' ? uploadError.message.toLowerCase() : ''
          if (msg.includes('bucket') || msg.includes('not found') || msg.includes('permission')) {
            if (input.kind === 'audio') {
              throw new Error(`Voice note upload failed. Create a Storage bucket named "${DM_MEDIA_BUCKET}" to support larger voice notes.`)
            }
            throw new Error(`Media upload failed. Create a Storage bucket named "${DM_MEDIA_BUCKET}" (or send a smaller photo).`)
          }
          throw new Error('Media upload failed.')
        }

        const base = {
          v: 1 as const,
          bucket: DM_MEDIA_BUCKET,
          path,
          mime: input.file.type || 'application/octet-stream',
          name: input.file.name || `${input.kind}.${ext}`,
          size: input.file.size,
          reply: replyingTo ?? undefined,
        }

        const payload: DmPayload =
          input.kind === 'image'
            ? { ...base, kind: 'image' }
            : { ...base, kind: 'audio' }

        const content = encodePayload(payload)
        const { data, error: insertError } = await supabase
          .from('messages')
          .insert([{ sender_id: me.id, receiver_id: partner.id, content }])
          .select('*')
          .single()

        if (insertError) {
          const msg = typeof insertError.message === 'string' ? insertError.message.toLowerCase() : ''
          if (msg.includes('messages')) {
            throw new Error('Database schema is missing the messages table.')
          }
          throw insertError
        }

        const row = data as MessageRow
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
        setReplyingTo(null)
        window.navigator.vibrate?.(10)
        sendTransparentNotification({
          type: 'message',
          content: input.kind === 'image' ? '📷 Photo' : '🎤 Voice note',
          dedupeKey: row.id,
          url: '/dm',
        }).catch(() => {})
        scrollToBottom('smooth')
        ensureMediaUrl(row.id, payload).catch(() => {})
      } catch (e: any) {
        console.error('[dm] upload/send error', e)
        setError(e?.message || 'Failed to send.')
      } finally {
        setIsSending(false)
      }
    },
    [ensureMediaUrl, isSending, me?.id, partner?.id, replyingTo, scrollToBottom, sendTransparentNotification, setMyTyping, supabase]
  )

  const startRecording = useCallback(async () => {
    if (isRecording || isSending) return
    if (typeof window === 'undefined') return
    if (!isSecureFeatureAvailable()) {
      setError('Voice notes require HTTPS (secure context).')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Voice notes are not supported on this device.')
      return
    }

    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      console.error('[dm] mic permission error', e)
      setError('Microphone permission denied.')
      return
    }

    streamRef.current = stream

    try {
      const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
      const isTypeSupported = (window as any).MediaRecorder?.isTypeSupported?.bind((window as any).MediaRecorder)
      const mimeType = isTypeSupported ? candidates.find((t) => isTypeSupported(t)) || '' : ''
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 }
      )
      recorderRef.current = recorder

      const chunks: BlobPart[] = []
      recorder.addEventListener('dataavailable', (e) => {
        if (e.data && (e.data as Blob).size > 0) chunks.push(e.data)
      })
      recorder.addEventListener('stop', async () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' })

        try {
          await uploadAndSend({ kind: 'audio', file })
        } finally {
          stream.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          recorderRef.current = null
          setIsRecording(false)
        }
      })

      recorder.start()
      setIsRecording(true)
    } catch (e) {
      console.error('[dm] MediaRecorder error', e)
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      recorderRef.current = null
      setIsRecording(false)
      setError('Voice notes are not supported on this device.')
    }
  }, [isRecording, isSending, uploadAndSend])

  const stopRecording = useCallback(() => {
    if (!isRecording) return
    try {
      recorderRef.current?.stop()
    } catch {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      recorderRef.current = null
      setIsRecording(false)
    }
  }, [isRecording])

  const sendLocationMessage = useCallback(async () => {
    if (!supabase || !me?.id || !partner?.id) return
    setPlusOpen(false)
    if (!isSecureFeatureAvailable()) {
      setError('Location sharing requires HTTPS (secure context).')
      return
    }
    if (!navigator.geolocation) {
      setError('Location is not supported on this device.')
      return
    }

    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const apple = `https://maps.apple.com/?ll=${lat},${lng}`
        const google = `https://maps.google.com/?q=${lat},${lng}`
        const url = /iphone|ipad|ipod/i.test(navigator.userAgent) ? apple : google
        const payload: DmPayload = { v: 1, kind: 'location', lat, lng, accuracy: pos.coords.accuracy, url }
        await sendQuickText(encodePayload(payload))
      },
      (err) => {
        if (err?.code === 1) setError('Location permission denied.')
        else if (err?.code === 2) setError('Location unavailable.')
        else setError('Location request timed out.')
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 10_000 }
    )
  }, [me?.id, partner?.id, sendQuickText, supabase])

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      try {
        callLocalRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next))
      } catch {}
      return next
    })
  }, [])

  const toggleCamera = useCallback(() => {
    setIsCameraOff((prev) => {
      const next = !prev
      try {
        callLocalRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next))
      } catch {}
      return next
    })
  }, [])

  const endAnyCall = useCallback(
    async (reason: 'ended' | 'declined' = 'ended') => {
      const id = activeCall?.id || outgoingCall?.id || incomingCall?.id
      if (id) await updateCallStatus(id, reason)
      if (id) releaseCallLock(id)
      cleanupWebRtc()
      setActiveCall(null)
      setIncomingCall(null)
      setOutgoingCall(null)
    },
    [activeCall?.id, cleanupWebRtc, incomingCall?.id, outgoingCall?.id, releaseCallLock, updateCallStatus]
  )

  useEffect(() => {
    if (!me?.id || !partner?.id) return
    const onVis = () => {
      dmChannelRef.current?.track({ online: true, typing: false, chatOpen: document.visibilityState === 'visible' }).catch(() => {})
      if (document.visibilityState === 'visible') {
        markIncomingAsDelivered(me.id, partner.id).catch(() => {})
        markIncomingAsRead(me.id, partner.id).catch(() => {})
        const active = activeCallRef.current
        if (active?.id && !pcRef.current) {
          hydrateCallById(active.id).catch(() => {})
        }
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [hydrateCallById, markIncomingAsDelivered, markIncomingAsRead, me?.id, partner?.id])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
          <p className="text-rose-300 font-medium animate-pulse">Loading chat...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell bg-mesh">
      {incomingCall && getCallStatus(incomingCall) === 'ringing' && getCallReceiverId(incomingCall) === me?.id && (
        <div className="fixed top-0 left-0 right-0 z-50 px-4 pt-[calc(env(safe-area-inset-top)+10px)]">
          <div className="max-w-md mx-auto rounded-3xl border border-white/60 bg-white/80 backdrop-blur-xl shadow-2xl shadow-rose-100/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-bold text-stone-800 truncate">
                  Incoming {incomingCall.call_type === 'video' ? 'Video' : 'Audio'} Call
                </div>
                <div className="text-[11px] font-semibold text-stone-500 truncate">{partner?.name || 'Partner'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await updateCallStatus(incomingCall.id, 'declined')
                    releaseCallLock(incomingCall.id)
                    setIncomingCall(null)
                  }}
                  className="px-4 py-3 rounded-3xl bg-white/60 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all"
                >
                  Decline
                </button>
                <button
                  onClick={async () => {
                    if (!supabase || !me?.id || !partner?.id) return
                    if (!acquireCallLock(incomingCall.id)) return
                    setError(null)

                    try {
                      const { data: callRow, error: callErr } = await supabase
                        .from('calls')
                        .select('*')
                        .eq('id', incomingCall.id)
                        .limit(1)
                        .maybeSingle()

                      if (callErr || !callRow) {
                        setError('Failed to load call.')
                        return
                      }

                      const offerSdp = (callRow as any).offer_sdp as string | null | undefined
                      const offerType = (callRow as any).offer_type as RTCSdpType | null | undefined
                      if (!offerSdp || !offerType) {
                        setError('Call offer is missing. Update the calls table schema.')
                        return
                      }

                      cleanupWebRtc()
                      const constraints =
                        incomingCall.call_type === 'video'
                          ? { audio: true, video: { facingMode: 'user' } }
                          : { audio: true }
                      const localStream = await navigator.mediaDevices.getUserMedia(constraints as any)
                      const pc = createPeerConnection(incomingCall.call_type, localStream)

                      await pc.setRemoteDescription({ type: offerType, sdp: offerSdp })
                      const answer = await pc.createAnswer()
                      await pc.setLocalDescription(answer)
                      await waitForIceGatheringComplete(pc)

                      const localDesc = pc.localDescription
                      if (!localDesc) {
                        setError('Failed to create call answer.')
                        cleanupWebRtc()
                        return
                      }

                      const patch: any = {
                        status: 'active',
                        answer_type: localDesc.type,
                        answer_sdp: localDesc.sdp,
                        updated_at: new Date().toISOString(),
                      }

                      const { error: updErr } = await supabase.from('calls').update(patch).eq('id', incomingCall.id)
                      if (updErr) {
                        setError('Failed to accept call.')
                        cleanupWebRtc()
                        return
                      }

                      setActiveCall({ ...(callRow as any), ...patch })
                      setIncomingCall(null)
                    } catch (e) {
                      console.error('[call] accept error', e)
                      setError('Failed to accept call.')
                      cleanupWebRtc()
                    }
                  }}
                  className="px-4 py-3 rounded-3xl bg-emerald-500 text-white font-bold shadow-xl shadow-emerald-200/40 active:scale-95 transition-all"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(outgoingCall && getCallStatus(outgoingCall) === 'ringing') || (activeCall && getCallStatus(activeCall) === 'active') ? (
        <div className="fixed inset-0 z-50 bg-black">
          {activeCall && getCallStatus(activeCall) === 'active' ? (
            <div className="absolute inset-0">
              {activeCall.call_type === 'video' ? (
                <>
                  <video
                    ref={(el) => {
                      remoteVideoRef.current = el
                      if (el) {
                        ;(el as any).srcObject = callRemoteStream
                      }
                    }}
                    autoPlay
                    playsInline
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <video
                    ref={(el) => {
                      localVideoRef.current = el
                      if (el) {
                        ;(el as any).srcObject = callLocalStream
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="absolute top-[calc(env(safe-area-inset-top)+12px)] right-4 w-28 h-40 rounded-[18px] object-cover border border-white/20 bg-black/40"
                  />
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center px-8">
                  <div className="text-center">
                    <div className="mx-auto w-24 h-24 rounded-full bg-white/10 overflow-hidden flex items-center justify-center">
                      {partner?.avatar_url ? (
                        <img src={partner.avatar_url} alt="Partner" className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-white font-extrabold text-[22px]">
                          {(partner?.name || 'P')
                            .split(' ')
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((s: string) => s[0]?.toUpperCase())
                            .join('')}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 text-white font-bold text-[18px]">{partner?.name || 'Partner'}</div>
                    <div className="mt-1 text-white/70 font-semibold text-[12px]">In audio call</div>
                  </div>
                </div>
              )}

              <audio
                ref={(el) => {
                  remoteAudioRef.current = el
                  if (el) {
                    ;(el as any).srcObject = callRemoteStream
                  }
                }}
                autoPlay
                playsInline
                className="hidden"
              />

              <div className="absolute left-0 right-0 bottom-0 pb-[calc(env(safe-area-inset-bottom)+18px)] px-6">
                <div className="mx-auto max-w-md flex items-center justify-center gap-4">
                  <button
                    onClick={toggleMute}
                    className={`w-14 h-14 rounded-full font-bold ${isMuted ? 'bg-white text-black' : 'bg-white/15 text-white'} border border-white/20 active:scale-95 transition-all`}
                  >
                    <Mic size={18} className="mx-auto" />
                  </button>
                  {activeCall.call_type === 'video' && (
                    <button
                      onClick={toggleCamera}
                      className={`w-14 h-14 rounded-full font-bold ${isCameraOff ? 'bg-white text-black' : 'bg-white/15 text-white'} border border-white/20 active:scale-95 transition-all`}
                    >
                      <Video size={18} className="mx-auto" />
                    </button>
                  )}
                  <button
                    onClick={() => endAnyCall('ended')}
                    className="w-16 h-16 rounded-full bg-red-600 text-white font-bold active:scale-95 transition-all"
                  >
                    <Phone size={20} className="mx-auto rotate-[135deg]" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-8">
              <div className="w-full max-w-md text-center">
                <div className="mx-auto w-24 h-24 rounded-full bg-white/10 overflow-hidden flex items-center justify-center">
                  {partner?.avatar_url ? (
                    <img src={partner.avatar_url} alt="Partner" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-white font-extrabold text-[22px]">
                      {(partner?.name || 'P')
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase())
                        .join('')}
                    </div>
                  )}
                </div>
                <div className="mt-4 text-white font-bold text-[18px]">{partner?.name || 'Partner'}</div>
                <div className="mt-1 text-white/70 font-semibold text-[12px]">
                  {outgoingCall?.call_type === 'video' ? 'Calling… (video)' : 'Calling… (audio)'}
                </div>
                <button
                  onClick={() => endAnyCall('ended')}
                  className="mt-8 w-16 h-16 rounded-full bg-red-600 text-white font-bold active:scale-95 transition-all"
                >
                  <Phone size={20} className="mx-auto rotate-[135deg]" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <header className="px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-3 z-10 bg-white/50 backdrop-blur-2xl border-b border-white/70">
        <div className="flex items-center justify-between gap-3">
          <div className="relative w-11 h-11 rounded-3xl bg-white/60 border border-white/70 overflow-hidden flex items-center justify-center">
            {partnerActive && (
              <span className="absolute inset-0 rounded-3xl">
                <span className="absolute inset-0 rounded-3xl bg-rose-400/40 animate-ping" />
              </span>
            )}
            {partner?.avatar_url ? (
              <img src={partner.avatar_url} alt="Partner" className="w-full h-full object-cover relative" />
            ) : (
              <div className="text-rose-500 font-extrabold text-[14px] relative">
                {(partner?.name || 'P')
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((s: string) => s[0]?.toUpperCase())
                  .join('')}
              </div>
            )}
          </div>

          <div className="flex-1 text-center">
            <h1 className="text-[17px] font-bold tracking-tight text-stone-900">{partner?.name || 'DMs'}</h1>
            <div className="mt-1 flex items-center justify-center gap-2">
              <span className={`h-2 w-2 rounded-full ${moodDotClass(partnerMood)}`} />
              <p className="text-[12px] text-stone-500 font-semibold">
                {partner?.name ? `${partner.name.split(' ')[0]} ` : ''}
                {partnerTyping ? (
                  <span className="text-[#007AFF]">is typing…</span>
                ) : (
                  <>
                    is feeling{' '}
                    <span className="capitalize text-[#007AFF]">
                      {partnerMood ? MOOD_LABELS[partnerMood.toLowerCase()] || partnerMood : 'Neutral'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => startCall('audio')}
              className="w-11 h-11 rounded-3xl bg-white/75 border border-white/80 text-stone-700 flex items-center justify-center active:scale-95 transition-all shadow-lg shadow-rose-100/30"
            >
              <Phone size={18} />
            </button>
            <button
              onClick={() => startCall('video')}
              className="w-11 h-11 rounded-3xl bg-white/75 border border-white/80 text-stone-700 flex items-center justify-center active:scale-95 transition-all shadow-lg shadow-rose-100/30"
            >
              <Video size={18} />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="px-6 pb-3">
          <div className="bg-white/60 border border-white/70 rounded-[22px] p-4 text-[13px] text-stone-700 font-semibold">
            {error}
          </div>
        </div>
      )}

      {!partner?.id ? (
        <main className="flex-1 px-6 pb-10 overflow-y-auto no-scrollbar">
          <div className="glass-card p-8 space-y-2">
            <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Waiting</p>
            <p className="text-[14px] text-stone-700 font-medium">
              Waiting for your partner to sign in so we can link you automatically.
            </p>
            <button
              onClick={() => router.refresh()}
              className="mt-4 w-full py-4 bg-white/60 border border-white/70 text-stone-700 font-bold rounded-[20px] transition-all active:scale-95"
            >
              Refresh
            </button>
          </div>
        </main>
      ) : (
        <>
          <main className="flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+150px)] pt-3 overflow-y-auto no-scrollbar space-y-3">
            {messages.length === 0 ? (
              <div className="glass-card mt-6 p-6 text-center text-[13px] text-stone-500 font-medium">
                Start with a soft hello.
              </div>
            ) : (
              messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  mine={m.sender_id === me?.id}
                  meId={me?.id || ''}
                  mediaUrl={mediaUrlsById[m.id]}
                  onLongPress={setActionTarget}
                />
              ))
            )}
            <div ref={bottomRef} />
          </main>

          {actionTarget && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/20 px-4 pb-[calc(env(safe-area-inset-bottom)+96px)]">
              <div className="w-full max-w-md rounded-[28px] border border-white/60 bg-white/70 backdrop-blur-2xl shadow-2xl shadow-rose-100/40 p-3">
                <div className="px-3 py-2 text-[12px] font-semibold text-stone-600 truncate">{actionTarget.snippet}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setReplyingTo({ id: actionTarget.id, snippet: actionTarget.snippet, senderId: '' })
                      setEditing(null)
                      setPlusOpen(false)
                      setActionTarget(null)
                    }}
                    className="py-4 rounded-[22px] bg-white/60 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all"
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => {
                      if (!actionTarget.canEdit) return
                      const msg = messages.find((x) => x.id === actionTarget.id)
                      if (!msg) return
                      const parsed = parsePayload(msg.content)
                      const initial = parsed.payload?.kind === 'text' ? parsed.payload.text : parsed.payload ? '' : parsed.fallbackText
                      const reply = parsed.payload?.reply
                      setEditing({ id: msg.id, initial, reply: reply ?? undefined })
                      setText(initial)
                      setReplyingTo(null)
                      setPlusOpen(false)
                      setActionTarget(null)
                    }}
                    disabled={!actionTarget.canEdit}
                    className="py-4 rounded-[22px] bg-white/60 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-50"
                  >
                    Edit
                  </button>
                </div>
                <button
                  onClick={() => setActionTarget(null)}
                  className="mt-2 w-full py-4 rounded-[22px] gradient-rose text-white font-bold shadow-xl shadow-rose-200 active:scale-95 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="fixed left-0 right-0 z-40 bottom-[calc(env(safe-area-inset-bottom)+90px)] flex justify-center px-4">
            <div className="w-full max-w-md">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  uploadAndSend({ kind: 'image', file }).catch(() => {})
                  setPlusOpen(false)
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  uploadAndSend({ kind: 'image', file }).catch(() => {})
                  setPlusOpen(false)
                }}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                capture
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  uploadAndSend({ kind: 'audio', file }).catch(() => {})
                  setPlusOpen(false)
                }}
              />

              <div className="relative mx-2 rounded-[28px] border border-white/80 bg-white/82 shadow-[0_20px_40px_rgba(217,144,174,0.16)] backdrop-blur-2xl p-3">
                {plusOpen && (
                  <div className="absolute right-3 bottom-[78px] w-60 rounded-3xl border border-white/80 bg-white/90 shadow-[0_20px_40px_rgba(217,144,174,0.18)] backdrop-blur-2xl p-2">
                    <button
                      onClick={() => {
                        sendLocationMessage().catch(() => {})
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-3xl hover:bg-black/5 active:scale-95 transition-all text-stone-800 font-semibold"
                    >
                      <MapPin size={18} className="text-[#007AFF]" />
                      Share Location
                    </button>
                    <button
                      onClick={() => {
                        setPlusOpen(false)
                        photoInputRef.current?.click()
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-3xl hover:bg-black/5 active:scale-95 transition-all text-stone-800 font-semibold"
                    >
                      <ImageIcon size={18} className="text-[#007AFF]" />
                      Send Photo
                    </button>
                    <button
                      onClick={() => {
                        setPlusOpen(false)
                        if (hasMediaRecorder) {
                          if (isRecording) stopRecording()
                          else startRecording()
                        } else {
                          if (!isSecureFeatureAvailable()) {
                            setError('Voice notes require HTTPS (secure context).')
                            return
                          }
                          audioInputRef.current?.click()
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-3xl hover:bg-black/5 active:scale-95 transition-all text-stone-800 font-semibold"
                    >
                      <Mic size={18} className="text-[#007AFF]" />
                      Voice Note
                    </button>
                  </div>
                )}

                {(replyingTo || editing) && (
                  <div className="mb-2 flex items-center justify-between gap-3 rounded-3xl border border-white/80 bg-white/68 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">
                        {editing ? 'Editing' : 'Replying'}
                      </div>
                      <div className="text-[12px] font-semibold text-stone-700 truncate">
                        {editing ? editing.initial : replyingTo?.snippet}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(null)
                        setEditing(null)
                      }}
                      className="flex h-9 w-9 items-center justify-center rounded-3xl border border-white/80 bg-white/75 text-stone-500 active:scale-95 transition-all"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-500 active:scale-95 transition-all"
                  >
                    <Camera size={18} />
                  </button>

                  <input
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value)
                      if (e.target.value.trim().length > 0) {
                        setMyTyping(true)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        sendTextMessage()
                      }
                    }}
                    placeholder={isRecording ? 'Recording…' : editing ? 'Edit message...' : 'Message...'}
                    className="flex-1 px-3 py-3 bg-transparent outline-none text-[15px] text-stone-900 placeholder:text-stone-400"
                    autoCapitalize="sentences"
                    autoComplete="off"
                    autoCorrect="on"
                    disabled={isRecording}
                  />

                  {text.trim().length === 0 && !editing ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (hasMediaRecorder) {
                          if (isRecording) stopRecording()
                          else startRecording()
                        } else {
                          if (!isSecureFeatureAvailable()) {
                            setError('Voice notes require HTTPS (secure context).')
                            return
                          }
                          audioInputRef.current?.click()
                        }
                      }}
                      disabled={isSending}
                      className={`flex h-11 w-11 items-center justify-center rounded-full active:scale-95 transition-all ${
                        isRecording ? 'bg-red-600 text-white' : 'bg-violet-100 text-violet-500'
                      } disabled:opacity-50`}
                    >
                      <Mic size={18} />
                    </button>
                  ) : (
                    <button
                      onClick={sendTextMessage}
                      disabled={isSending || isRecording || text.trim().length === 0}
                      className="primary-romance flex h-11 w-11 items-center justify-center rounded-full active:scale-95 transition-all disabled:opacity-50"
                    >
                      {isSending ? <Loader2 className="animate-spin" size={18} /> : editing ? <Pencil size={18} /> : <Send size={18} />}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setPlusOpen((v) => !v)}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-900/5 text-stone-700 active:scale-95 transition-all"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
