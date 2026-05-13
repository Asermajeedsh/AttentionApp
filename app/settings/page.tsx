'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, ChevronRight, Gem, Loader2, LogOut, MessageCircle, MoonStar, Phone, Swords, User } from 'lucide-react'
import {
  acceptPartnerRequest,
  cancelPartnerRequest,
  createOptionalClient,
  createPartnerRequest,
  declinePartnerRequest,
  ensureProfile,
  fetchPartnerRequests,
  fetchProfile,
  generateInviteCode,
  redeemInviteCode,
  unlinkPartner,
} from '../../utils/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = useMemo(() => createOptionalClient(), [])

  const [isLoading, setIsLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [me, setMe] = useState<any>(null)
  const [partner, setPartner] = useState<any>(null)
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [isEnablingPush, setIsEnablingPush] = useState(false)

  const [prefs, setPrefs] = useState<any>(null)
  const [isPrefsBusy, setIsPrefsBusy] = useState(false)
  const [testStatus, setTestStatus] = useState<string | null>(null)

  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteCodeInput, setInviteCodeInput] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [requests, setRequests] = useState<any[]>([])
  const [isPartnerBusy, setIsPartnerBusy] = useState(false)

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
    return outputArray
  }

  function minutesToTimeValue(minutes: number) {
    const safe = Math.max(0, Math.min(1439, Math.floor(minutes)))
    const hh = String(Math.floor(safe / 60)).padStart(2, '0')
    const mm = String(safe % 60).padStart(2, '0')
    return `${hh}:${mm}`
  }

  function timeValueToMinutes(value: string) {
    const match = /^(\d{2}):(\d{2})$/.exec(value)
    if (!match) return null
    const hh = Number(match[1])
    const mm = Number(match[2])
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
    const total = hh * 60 + mm
    if (total < 0 || total > 1439) return null
    return total
  }

  useEffect(() => {
    async function init() {
      if (!supabase) {
        setError('Supabase is not configured.')
        setIsLoading(false)
        return
      }

      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.push('/signin')
        return
      }

      const userEmail = data.user?.email?.toLowerCase() ?? null
      setEmail(userEmail)

      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushPermission('unsupported')
      } else {
        setPushPermission(Notification.permission)
      }

      const myProfile = await ensureProfile(data.user as any)
      setMe(myProfile)

      if (myProfile?.partner_id) {
        const partnerProfile = await fetchProfile(myProfile.partner_id)
        setPartner(partnerProfile)
      } else {
        setPartner(null)
      }

      const reqs = await fetchPartnerRequests().catch(() => [])
      setRequests(reqs)

      const { data: prefRow } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', data.user.id)
        .limit(1)
        .maybeSingle()

      if (prefRow) {
        setPrefs(prefRow)
      } else {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        const { data: created } = await supabase
          .from('notification_preferences')
          .insert([{ user_id: data.user.id, timezone: tz }])
          .select('*')
          .single()
        if (created) setPrefs(created)
      }

      setIsLoading(false)
    }

    init().catch((e) => {
      console.error('[settings] init error', e)
      setError('Failed to load.')
      setIsLoading(false)
    })
  }, [router, supabase])

  async function refreshPartnerState() {
    if (!supabase) return
    const { data } = await supabase.auth.getUser()
    if (!data.user) return
    const userEmail = data.user?.email?.toLowerCase() ?? null
    setEmail(userEmail)
    const myProfile = await ensureProfile(data.user as any)
    setMe(myProfile)
    if (myProfile?.partner_id) {
      const partnerProfile = await fetchProfile(myProfile.partner_id)
      setPartner(partnerProfile)
    } else {
      setPartner(null)
    }
    const reqs = await fetchPartnerRequests().catch(() => [])
    setRequests(reqs)
  }

  async function updatePrefs(patch: Record<string, any>) {
    if (!supabase || !me?.id) return
    if (isPrefsBusy) return
    setIsPrefsBusy(true)
    setError(null)
    try {
      const nextLocal = { ...(prefs || {}), ...patch }
      setPrefs(nextLocal)
      const now = new Date().toISOString()
      const { data: row, error: prefError } = await supabase
        .from('notification_preferences')
        .upsert([{ user_id: me.id, ...patch, updated_at: now }], { onConflict: 'user_id' })
        .select('*')
        .single()
      if (prefError) throw prefError
      setPrefs(row)
    } catch (e: any) {
      setError(e?.message || 'Failed to update preferences')
    } finally {
      setIsPrefsBusy(false)
    }
  }

  async function enablePush() {
    if (!supabase || !me?.id) return
    if (isEnablingPush) return
    setIsEnablingPush(true)
    setError(null)
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushPermission('unsupported')
        throw new Error('Push notifications are not supported in this browser.')
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapidPublicKey) throw new Error('Missing VAPID public key.')

      const permission = await Notification.requestPermission()
      setPushPermission(permission)
      if (permission !== 'granted') return

      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }))

      const subscriptionJson = typeof (subscription as any)?.toJSON === 'function' ? (subscription as any).toJSON() : subscription
      const endpoint = (subscription as any)?.endpoint as string | undefined
      if (!endpoint) throw new Error('Missing push endpoint.')

      await supabase.from('push_subscriptions').upsert(
        [
          {
            user_id: me.id,
            endpoint,
            subscription: subscriptionJson,
            user_agent: navigator.userAgent,
            updated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'user_id,endpoint' }
      )
    } catch (e: any) {
      setError(e?.message || 'Failed to enable push')
    } finally {
      setIsEnablingPush(false)
    }
  }

  async function sendTestNotification() {
    if (testStatus) setTestStatus(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setTestStatus(json?.error || 'Failed to send test notification')
        return
      }
      setTestStatus(`Sent to ${json.sent ?? 0} device(s)`)
    } catch {
      setTestStatus('Failed to send test notification')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
          <p className="text-rose-300 font-medium animate-pulse">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-mesh flex flex-col max-w-md mx-auto relative overflow-hidden">
      <header className="px-8 pt-10 pb-6 flex justify-center items-center z-10">
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-gradient">Settings</h1>
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">{email || 'Account'}</p>
        </div>
      </header>

      <main className="flex-1 flex flex-col px-8 pb-28 z-10 space-y-6 overflow-y-auto no-scrollbar">
        {error && (
          <div className="bg-white/60 border border-white/70 rounded-[22px] p-4 text-[13px] text-stone-700 font-semibold">
            {error}
          </div>
        )}

        <div className="glass-card p-6 space-y-3">
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Partner</p>

          {me?.partner_id ? (
            <div className="space-y-3">
              <div className="bg-white/55 border border-white/70 rounded-[22px] p-4 text-[13px] text-stone-700 font-semibold">
                Linked with <span className="font-bold">{partner?.name || 'your partner'}</span>
              </div>
              <button
                disabled={isPartnerBusy}
                onClick={async () => {
                  if (isPartnerBusy) return
                  setIsPartnerBusy(true)
                  setError(null)
                  try {
                    await unlinkPartner()
                    setInviteCode(null)
                    await refreshPartnerState()
                  } catch (e: any) {
                    setError(e?.message || 'Failed to unlink')
                  } finally {
                    setIsPartnerBusy(false)
                  }
                }}
                className="w-full py-3 rounded-[22px] bg-white/55 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-60"
              >
                Unlink partner
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                disabled={isPartnerBusy}
                onClick={async () => {
                  if (isPartnerBusy) return
                  setIsPartnerBusy(true)
                  setError(null)
                  try {
                    const code = await generateInviteCode()
                    setInviteCode(code)
                    if (navigator?.clipboard?.writeText) {
                      await navigator.clipboard.writeText(code)
                    }
                    await refreshPartnerState()
                  } catch (e: any) {
                    setError(e?.message || 'Failed to generate code')
                  } finally {
                    setIsPartnerBusy(false)
                  }
                }}
                className="w-full py-3 rounded-[22px] gradient-rose text-white font-bold active:scale-95 transition-all disabled:opacity-60"
              >
                Generate invite code
              </button>

              {inviteCode && (
                <div className="bg-white/55 border border-white/70 rounded-[22px] p-4 text-center">
                  <div className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Invite code</div>
                  <div className="mt-2 text-[22px] font-extrabold tracking-[0.22em] text-stone-800">{inviteCode}</div>
                  <div className="mt-2 text-[12px] font-semibold text-stone-500">Copied (if your browser allows).</div>
                  <button
                    disabled={isPartnerBusy}
                    onClick={async () => {
                      try {
                        if ((navigator as any)?.share) {
                          await (navigator as any).share({ text: `Attention App invite code: ${inviteCode}` })
                        } else if (navigator?.clipboard?.writeText) {
                          await navigator.clipboard.writeText(inviteCode)
                        }
                      } catch {}
                    }}
                    className="mt-3 w-full py-3 rounded-[18px] bg-white/70 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-60"
                  >
                    Share code
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Enter invite code</div>
                <div className="flex gap-2">
                  <input
                    value={inviteCodeInput}
                    onChange={(e) => setInviteCodeInput(e.target.value)}
                    className="flex-1 p-3 bg-white/50 border border-white/60 rounded-[18px] outline-none transition-all placeholder:text-stone-300 text-stone-700 font-semibold"
                    placeholder="CODE"
                  />
                  <button
                    disabled={isPartnerBusy || !inviteCodeInput.trim()}
                    onClick={async () => {
                      if (isPartnerBusy) return
                      setIsPartnerBusy(true)
                      setError(null)
                      try {
                        const partnerId = await redeemInviteCode(inviteCodeInput)
                        setInviteCodeInput('')
                        setInviteCode(null)
                        fetch('/api/send-notification', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            type: 'invite',
                            receiverId: partnerId,
                            content: 'Partner linked',
                          }),
                        }).catch(() => {})
                        await refreshPartnerState()
                      } catch (e: any) {
                        setError(e?.message || 'Failed to redeem code')
                      } finally {
                        setIsPartnerBusy(false)
                      }
                    }}
                    className="px-4 rounded-[18px] bg-white/60 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-60"
                  >
                    Link
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Invite via email</div>
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full p-3 bg-white/50 border border-white/60 rounded-[18px] outline-none transition-all placeholder:text-stone-300 text-stone-700 font-semibold"
                  placeholder="partner@email.com"
                />
                <button
                  disabled={isPartnerBusy || !inviteEmail.trim()}
                  onClick={async () => {
                    if (isPartnerBusy) return
                    setIsPartnerBusy(true)
                    setError(null)
                    try {
                      if (!supabase) {
                        throw new Error('Supabase is not configured.')
                      }
                      const requestId = await createPartnerRequest(inviteEmail)
                      setInviteEmail('')
                      const { data: row } = await supabase
                        .from('partner_requests')
                        .select('recipient_user_id')
                        .eq('id', requestId)
                        .limit(1)
                        .maybeSingle()
                      if (row?.recipient_user_id) {
                        fetch('/api/send-notification', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            type: 'invite',
                            receiverId: row.recipient_user_id,
                            content: 'Partner invite',
                          }),
                        }).catch(() => {})
                      }
                      await refreshPartnerState()
                    } catch (e: any) {
                      setError(e?.message || 'Failed to send invite')
                    } finally {
                      setIsPartnerBusy(false)
                    }
                  }}
                  className="w-full py-3 rounded-[22px] bg-white/60 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-60"
                >
                  Send email invite
                </button>
              </div>

              {requests.filter((r) => r.status === 'pending').length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Pending invites</div>
                  {requests
                    .filter((r) => r.status === 'pending')
                    .slice(0, 6)
                    .map((r) => {
                      const incoming = r.recipient_user_id === me?.id || (email && r.recipient_email === email)
                      return (
                        <div key={r.id} className="bg-white/55 border border-white/70 rounded-[22px] p-4 space-y-3">
                          <div className="text-[13px] text-stone-700 font-semibold">
                            {incoming ? 'Invite for you' : 'Invite you sent'} ·{' '}
                            <span className="font-bold">{incoming ? r.requester_id : r.recipient_email}</span>
                          </div>
                          <div className="flex gap-2">
                            {incoming ? (
                              <>
                                <button
                                  disabled={isPartnerBusy}
                                  onClick={async () => {
                                    if (isPartnerBusy) return
                                    setIsPartnerBusy(true)
                                    setError(null)
                                    try {
                                      const partnerId = await acceptPartnerRequest(r.id)
                                      fetch('/api/send-notification', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          type: 'invite',
                                          receiverId: partnerId,
                                          content: 'Invite accepted',
                                        }),
                                      }).catch(() => {})
                                      await refreshPartnerState()
                                    } catch (e: any) {
                                      setError(e?.message || 'Failed to accept')
                                    } finally {
                                      setIsPartnerBusy(false)
                                    }
                                  }}
                                  className="flex-1 py-3 rounded-[18px] bg-emerald-500 text-white font-bold active:scale-95 transition-all disabled:opacity-60"
                                >
                                  Accept
                                </button>
                                <button
                                  disabled={isPartnerBusy}
                                  onClick={async () => {
                                    if (isPartnerBusy) return
                                    setIsPartnerBusy(true)
                                    setError(null)
                                    try {
                                      await declinePartnerRequest(r.id)
                                      await refreshPartnerState()
                                    } catch (e: any) {
                                      setError(e?.message || 'Failed to decline')
                                    } finally {
                                      setIsPartnerBusy(false)
                                    }
                                  }}
                                  className="flex-1 py-3 rounded-[18px] bg-white/70 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-60"
                                >
                                  Decline
                                </button>
                              </>
                            ) : (
                              <button
                                disabled={isPartnerBusy}
                                onClick={async () => {
                                  if (isPartnerBusy) return
                                  setIsPartnerBusy(true)
                                  setError(null)
                                  try {
                                    await cancelPartnerRequest(r.id)
                                    await refreshPartnerState()
                                  } catch (e: any) {
                                    setError(e?.message || 'Failed to cancel')
                                  } finally {
                                    setIsPartnerBusy(false)
                                  }
                                }}
                                className="w-full py-3 rounded-[18px] bg-white/70 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-60"
                              >
                                Cancel invite
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="glass-card p-6 space-y-3">
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Notifications</p>

          <div className="bg-white/55 border border-white/70 rounded-[22px] p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[18px] bg-white/60 border border-white/70 text-rose-500 flex items-center justify-center shadow-sm">
                <Bell size={18} />
              </span>
              <div>
                <div className="text-[13px] text-stone-800 font-bold">Push notifications</div>
                <div className="text-[12px] text-stone-500 font-semibold">
                  {pushPermission === 'unsupported'
                    ? 'Not supported on this device.'
                    : pushPermission === 'granted'
                      ? 'Enabled'
                      : pushPermission === 'denied'
                        ? 'Blocked in browser settings'
                        : 'Not enabled yet'}
                </div>
              </div>
            </div>
            <button
              disabled={isEnablingPush || pushPermission === 'unsupported' || pushPermission === 'granted'}
              onClick={enablePush}
              className="px-4 py-2 rounded-[18px] gradient-rose text-white font-bold active:scale-95 transition-all disabled:opacity-60"
            >
              {pushPermission === 'granted' ? 'On' : isEnablingPush ? 'Enabling…' : 'Enable'}
            </button>
          </div>

          <div className="bg-white/55 border border-white/70 rounded-[22px] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] text-stone-800 font-bold">Mute all</div>
                <div className="text-[12px] text-stone-500 font-semibold">Temporarily silence every notification.</div>
              </div>
              <button
                disabled={isPrefsBusy || !prefs}
                onClick={() => updatePrefs({ mute_all: !prefs?.mute_all })}
                className={`px-4 py-2 rounded-[18px] font-bold active:scale-95 transition-all disabled:opacity-60 ${
                  prefs?.mute_all ? 'bg-stone-900 text-white' : 'bg-white/70 border border-white/70 text-stone-700'
                }`}
              >
                {prefs?.mute_all ? 'Muted' : 'On'}
              </button>
            </div>
          </div>

          <div className="bg-white/55 border border-white/70 rounded-[22px] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-[18px] bg-white/60 border border-white/70 text-rose-500 flex items-center justify-center shadow-sm">
                  <MoonStar size={18} />
                </span>
                <div>
                  <div className="text-[13px] text-stone-800 font-bold">Quiet hours</div>
                  <div className="text-[12px] text-stone-500 font-semibold">Mute most notifications while you rest.</div>
                </div>
              </div>
              <button
                disabled={isPrefsBusy || !prefs}
                onClick={() => updatePrefs({ quiet_hours_enabled: !prefs?.quiet_hours_enabled })}
                className={`px-4 py-2 rounded-[18px] font-bold active:scale-95 transition-all disabled:opacity-60 ${
                  prefs?.quiet_hours_enabled ? 'bg-stone-900 text-white' : 'bg-white/70 border border-white/70 text-stone-700'
                }`}
              >
                {prefs?.quiet_hours_enabled ? 'On' : 'Off'}
              </button>
            </div>

            {prefs?.quiet_hours_enabled && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-bold text-rose-300 uppercase tracking-widest mb-2">Start</div>
                  <input
                    type="time"
                    value={minutesToTimeValue(prefs?.quiet_start_minutes ?? 1320)}
                    disabled={isPrefsBusy}
                    onChange={(e) => {
                      const minutes = timeValueToMinutes(e.target.value)
                      if (minutes === null) return
                      updatePrefs({ quiet_start_minutes: minutes })
                    }}
                    className="w-full p-3 bg-white/70 border border-white/70 rounded-[18px] outline-none text-stone-700 font-semibold"
                  />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-rose-300 uppercase tracking-widest mb-2">End</div>
                  <input
                    type="time"
                    value={minutesToTimeValue(prefs?.quiet_end_minutes ?? 480)}
                    disabled={isPrefsBusy}
                    onChange={(e) => {
                      const minutes = timeValueToMinutes(e.target.value)
                      if (minutes === null) return
                      updatePrefs({ quiet_end_minutes: minutes })
                    }}
                    className="w-full p-3 bg-white/70 border border-white/70 rounded-[18px] outline-none text-stone-700 font-semibold"
                  />
                </div>
              </div>
            )}

            <div className="text-[12px] text-stone-500 font-semibold">
              Calls can still ring during quiet hours. You can change this below.
            </div>
          </div>

          <div className="bg-white/55 border border-white/70 rounded-[22px] p-4 space-y-3">
            <div className="text-[12px] text-stone-700 font-bold">What you receive</div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['notify_dm', 'DMs'],
                ['notify_beep', 'Beeps'],
                ['notify_mood', 'Moods'],
                ['notify_rating', 'Ratings'],
                ['notify_invite', 'Invites'],
                ['notify_game', 'Games'],
                ['notify_call', 'Calls'],
                ['notify_missed_call', 'Missed calls'],
                ['notify_reminder', 'Reminders'],
                ['calls_bypass_quiet_hours', 'Calls bypass quiet'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  disabled={isPrefsBusy || !prefs}
                  onClick={() => updatePrefs({ [key]: !prefs?.[key] })}
                  className={`px-4 py-3 rounded-[18px] font-bold active:scale-95 transition-all disabled:opacity-60 ${
                    prefs?.[key] ? 'bg-stone-900 text-white' : 'bg-white/70 border border-white/70 text-stone-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            disabled={pushPermission !== 'granted'}
            onClick={sendTestNotification}
            className="w-full py-3 rounded-[22px] bg-white/60 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all disabled:opacity-60"
          >
            Send test notification
          </button>
          {testStatus && <div className="text-[12px] text-stone-600 font-semibold">{testStatus}</div>}
        </div>

        <div className="glass-card p-6 space-y-3">
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">More</p>
          <button
            onClick={() => router.push('/settings/profile')}
            className="w-full flex items-center justify-between px-4 py-4 rounded-[22px] bg-white/55 border border-white/70 text-stone-700 font-semibold active:scale-95 transition-all"
          >
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[18px] bg-white/60 border border-white/70 text-rose-500 flex items-center justify-center shadow-sm">
                <User size={18} />
              </span>
              Profile
            </span>
            <ChevronRight size={18} className="text-stone-400" />
          </button>
          <button
            onClick={() => router.push('/premium')}
            className="w-full flex items-center justify-between px-4 py-4 rounded-[22px] bg-white/55 border border-white/70 text-stone-700 font-semibold active:scale-95 transition-all"
          >
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[18px] gradient-rose text-white flex items-center justify-center shadow-xl shadow-rose-200">
                <Gem size={18} />
              </span>
              Premium
            </span>
            <ChevronRight size={18} className="text-stone-400" />
          </button>
          <button
            onClick={() => router.push('/chat')}
            className="w-full flex items-center justify-between px-4 py-4 rounded-[22px] bg-white/55 border border-white/70 text-stone-700 font-semibold active:scale-95 transition-all"
          >
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[18px] bg-white/60 border border-white/70 text-rose-500 flex items-center justify-center shadow-sm">
                <MessageCircle size={18} />
              </span>
              Chat
            </span>
            <ChevronRight size={18} className="text-stone-400" />
          </button>
          <button
            onClick={() => router.push('/calls')}
            className="w-full flex items-center justify-between px-4 py-4 rounded-[22px] bg-white/55 border border-white/70 text-stone-700 font-semibold active:scale-95 transition-all"
          >
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[18px] bg-white/60 border border-white/70 text-rose-500 flex items-center justify-center shadow-sm">
                <Phone size={18} />
              </span>
              Calls
            </span>
            <ChevronRight size={18} className="text-stone-400" />
          </button>
          <button
            onClick={() => router.push('/games')}
            className="w-full flex items-center justify-between px-4 py-4 rounded-[22px] bg-white/55 border border-white/70 text-stone-700 font-semibold active:scale-95 transition-all"
          >
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[18px] bg-white/60 border border-white/70 text-rose-500 flex items-center justify-center shadow-sm">
                <Swords size={18} />
              </span>
              Games
            </span>
            <ChevronRight size={18} className="text-stone-400" />
          </button>
        </div>

        <div className="glass-card p-6 space-y-3">
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Account</p>
          <button
            onClick={async () => {
              if (!supabase || isSigningOut) return
              setIsSigningOut(true)
              try {
                await supabase.auth.signOut()
                router.push('/signin')
              } finally {
                setIsSigningOut(false)
              }
            }}
            disabled={isSigningOut}
            className="w-full flex items-center justify-between px-4 py-4 rounded-[22px] bg-white/55 border border-white/70 text-stone-700 font-semibold active:scale-95 transition-all disabled:opacity-60"
          >
            <span className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-[18px] bg-white/60 border border-white/70 text-rose-500 flex items-center justify-center shadow-sm">
                <LogOut size={18} />
              </span>
              Sign out
            </span>
            {isSigningOut ? <Loader2 size={18} className="animate-spin text-stone-400" /> : <ChevronRight size={18} className="text-stone-400" />}
          </button>
        </div>
      </main>
    </div>
  )
}
