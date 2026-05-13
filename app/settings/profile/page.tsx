'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, Save, User, X } from 'lucide-react'
import { createOptionalClient } from '../../../utils/supabase/client'

async function loadBitmapOrImage(file: File) {
  if (typeof (globalThis as any).createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { kind: 'bitmap' as const, bitmap }
    } catch {}
  }

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await (img as any).decode?.().catch(() => {})
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to decode image'))
    })
    return { kind: 'img' as const, img }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function compressAvatarToJpegDataUrl(file: File) {
  const src = await loadBitmapOrImage(file)
  const maxDim = 768
  const width0 = src.kind === 'bitmap' ? src.bitmap.width : src.img.naturalWidth || src.img.width
  const height0 = src.kind === 'bitmap' ? src.bitmap.height : src.img.naturalHeight || src.img.height
  const maxSide = Math.max(width0, height0)
  const scale = maxSide > maxDim ? maxDim / maxSide : 1
  const width = Math.max(1, Math.round(width0 * scale))
  const height = Math.max(1, Math.round(height0 * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(src.kind === 'bitmap' ? src.bitmap : src.img, 0, 0, width, height)
  if (src.kind === 'bitmap') {
    ;(src.bitmap as any).close?.()
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to compress'))), 'image/jpeg', 0.78)
  })

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read'))
    reader.readAsDataURL(blob)
  })

  return dataUrl
}

export default function ProfilePage() {
  const router = useRouter()
  const supabase = useMemo(() => createOptionalClient(), [])

  const fileRef = useRef<HTMLInputElement | null>(null)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [pendingAvatar, setPendingAvatar] = useState<string | null>(null)
  const [joinDate, setJoinDate] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)

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

      const { data: profile } = await supabase
        .from('users')
        .select('name, avatar_url, partner_id, created_at')
        .eq('id', data.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      setName(profile?.name || '')
      setAvatarUrl(profile?.avatar_url || null)
      setJoinDate(profile?.created_at || null)

      if (profile?.partner_id) {
        const { data: partner } = await supabase
          .from('users')
          .select('name')
          .eq('id', profile.partner_id)
          .limit(1)
          .maybeSingle()
        setPartnerName(partner?.name || 'Partner')
      }
      setIsLoading(false)
    }

    init().catch((e) => {
      console.error('[profile] init error', e)
      setError('Failed to load.')
      setIsLoading(false)
    })
  }, [router, supabase])

  const save = async () => {
    if (!supabase) return
    if (isSaving) return

    setIsSaving(true)
    setError(null)

    try {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.push('/signin')
        return
      }

      const nextName = name.trim()
      const payload: any = { name: nextName || null, updated_at: new Date().toISOString() }
      if (pendingAvatar) payload.avatar_url = pendingAvatar

      const { data: updated, error: updateError } = await supabase
        .from('users')
        .update(payload)
        .eq('id', data.user.id)
        .select('name, avatar_url')
        .maybeSingle()

      if (updateError) {
        const msg = typeof updateError.message === 'string' ? updateError.message.toLowerCase() : ''
        if (msg.includes('permission')) {
          throw new Error('Profile updates are blocked by database permissions (RLS).')
        }
        throw updateError
      }

      setName((updated as any)?.name || nextName)
      setAvatarUrl((updated as any)?.avatar_url || (pendingAvatar ? pendingAvatar : avatarUrl))
      setPendingAvatar(null)
    } catch (e: any) {
      console.error('[profile] save error', e)
      setError(e?.message || 'Failed to save.')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rose-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-rose-400 animate-spin" />
          <p className="text-rose-300 font-medium animate-pulse">Loading profile...</p>
        </div>
      </div>
    )
  }

  const shownAvatar = pendingAvatar || avatarUrl

  return (
    <div className="h-full bg-mesh flex flex-col max-w-md mx-auto relative overflow-hidden">
      <header className="px-8 pt-10 pb-6 flex justify-center items-center z-10">
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-gradient">Profile</h1>
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Customize</p>
        </div>
      </header>

      <main className="flex-1 flex flex-col px-8 pb-28 z-10 space-y-6 overflow-y-auto no-scrollbar">
        {error && (
          <div className="bg-white/60 border border-white/70 rounded-[22px] p-4 text-[13px] text-stone-700 font-semibold">
            {error}
          </div>
        )}

        <div className="glass-card p-8 space-y-4">
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Photo</p>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 rounded-[26px] bg-white/60 border border-white/70 overflow-hidden flex items-center justify-center">
              {shownAvatar ? (
                <img src={shownAvatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="text-rose-400" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  try {
                    const dataUrl = await compressAvatarToJpegDataUrl(file)
                    if (dataUrl.length > 1_900_000) {
                      setError('That photo is still too large. Try a smaller image.')
                      return
                    }
                    setPendingAvatar(dataUrl)
                  } catch (err) {
                    console.error('[profile] avatar compress error', err)
                    setError('Failed to process image.')
                  }
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-3 rounded-3xl bg-white/60 border border-white/70 text-stone-700 font-bold active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Camera size={18} className="text-rose-500" />
                Choose photo
              </button>
              {pendingAvatar && (
                <button
                  onClick={() => setPendingAvatar(null)}
                  className="w-full py-3 rounded-3xl bg-white/50 border border-white/70 text-stone-600 font-bold active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <X size={16} />
                  Remove pending
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="glass-card p-8 space-y-4">
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Name</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full p-4 bg-white/50 border border-white/60 rounded-3xl focus:ring-2 focus:ring-rose-400 outline-none transition-all placeholder:text-stone-300 text-stone-700"
            placeholder="Preferred name"
          />
        </div>

        <div className="glass-card p-8 space-y-4">
          <p className="text-[11px] font-bold text-rose-300 uppercase tracking-widest">Relationship</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[20px] bg-white/55 border border-white/70 p-4">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Partner</p>
              <p className="mt-2 text-[14px] font-bold text-stone-700">{partnerName || 'Not linked'}</p>
            </div>
            <div className="rounded-[20px] bg-white/55 border border-white/70 p-4">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Joined</p>
              <p className="mt-2 text-[14px] font-bold text-stone-700">
                {joinDate ? new Date(joinDate).toLocaleDateString() : 'Today'}
              </p>
            </div>
          </div>
          <div className="rounded-[20px] bg-white/55 border border-white/70 p-4">
            <p className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Theme</p>
            <div className="mt-3 flex gap-2">
              {['#f889a7', '#c98cf5', '#ffeede', '#fff8f6'].map((color) => (
                <span key={color} className="h-8 w-8 rounded-full border border-white/80 shadow-sm" style={{ backgroundColor: color }} />
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={save}
          disabled={isSaving}
          className="w-full py-4 gradient-rose text-white font-bold rounded-3xl transition-all shadow-xl shadow-rose-200 active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Save
        </button>
      </main>
    </div>
  )
}
