'use client'

import { useMemo } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Heart, MessageCircle, Settings, Smile } from 'lucide-react'

export default function BottomNav() {
  const router = useRouter()
  const pathname = usePathname() || '/'

  const hidden = useMemo(() => {
    return pathname === '/' || pathname.startsWith('/signin') || pathname.startsWith('/signup') || pathname.startsWith('/auth')
  }, [pathname])

  const items = [
    { label: 'Pulse', href: '/app', Icon: Heart },
    { label: 'Chat', href: '/chat', Icon: MessageCircle },
    { label: 'Mood', href: '/mood', Icon: Smile },
    { label: 'Us', href: '/settings', Icon: Settings },
  ]

  if (hidden) return null

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+14px)]">
      <div className="w-full max-w-md rounded-[30px] border border-white/65 bg-white/68 p-2 shadow-2xl shadow-pink-100/50 backdrop-blur-2xl">
        <div className="grid grid-cols-4 gap-1">
          {items.map(({ label, href, Icon }) => {
            const active = pathname === href
            return (
              <button
                key={href}
                onClick={() => router.push(href)}
                className={`flex h-14 flex-col items-center justify-center gap-1 rounded-[24px] text-[10px] font-black uppercase tracking-[0.14em] transition active:scale-95 ${
                  active ? 'bg-gradient-to-br from-pink-500 to-violet-500 text-white shadow-lg shadow-pink-200/50' : 'text-[#8f6680] hover:bg-white/55'
                }`}
              >
                <Icon className="h-4 w-4" fill={active && label === 'Pulse' ? 'currentColor' : 'none'} />
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
