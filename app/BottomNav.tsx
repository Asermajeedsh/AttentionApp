'use client'

import { useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Gamepad2, Home, MessageCircle, SlidersHorizontal, Settings } from 'lucide-react'

export default function BottomNav() {
  const router = useRouter()
  const pathname = usePathname() || '/'

  const hidden = useMemo(() => {
    if (pathname === '/signin' || pathname === '/signup') return true
    if (pathname === '/') return true
    if (pathname.startsWith('/auth')) return true
    return false
  }, [pathname])

  const items = useMemo(
      () => [
        { key: 'dashboard', label: 'Dashboard', href: '/app', Icon: Home },
      { key: 'dm', label: 'Chat', href: '/chat', Icon: MessageCircle },
        { key: 'games', label: 'Games', href: '/games', Icon: Gamepad2 },
        { key: 'ratings', label: 'Mood', href: '/ratings', Icon: SlidersHorizontal },
        { key: 'settings', label: 'Settings', href: '/settings', Icon: Settings },
      ],
      []
  )

  if (hidden) return null

  return (
    <nav className="fixed left-0 right-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+14px)]">
      <div className="w-full max-w-md">
        <div className="mx-2 rounded-[28px] border border-white/60 bg-white/70 backdrop-blur-2xl shadow-2xl shadow-rose-100/40 px-3 py-3">
          <div className="grid grid-cols-5 gap-2">
            {items.map((it) => {
              const active = pathname === it.href
              const Icon = it.Icon
              return (
                <button
                  key={it.key}
                  onClick={() => router.push(it.href)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-[22px] py-3 transition-all active:scale-95 ${
                    active ? 'bg-rose-500 text-white shadow-lg shadow-rose-200/50' : 'text-stone-500 hover:bg-white/60'
                  }`}
                >
                  <Icon size={18} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">{it.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </nav>
  )
}
