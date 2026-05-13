'use client'

import { useEffect } from 'react'

function setBadge(count: number) {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  try {
    if (!('navigator' in window)) return
    const anyNav = navigator as any
    if (safe > 0 && typeof anyNav.setAppBadge === 'function') {
      anyNav.setAppBadge(safe).catch(() => {})
      return
    }
    if (safe === 0 && typeof anyNav.clearAppBadge === 'function') {
      anyNav.clearAppBadge().catch(() => {})
    }
  } catch {}
}

export default function PushClientBridge() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const send = (message: any) => {
      try {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage(message)
          return
        }
      } catch {}
      navigator.serviceWorker.ready
        .then((reg) => reg.active?.postMessage(message))
        .catch(() => {})
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data || {}
      if (data && data.kind === 'badge' && typeof data.count === 'number') {
        try {
          localStorage.setItem('attention_badge', String(Math.max(0, Math.floor(data.count))))
        } catch {}
        setBadge(data.count)
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage)

    send({ type: 'getBadge' })

    const clear = () => {
      try {
        localStorage.setItem('attention_badge', '0')
      } catch {}
      setBadge(0)
      send({ type: 'clearBadge' })
    }

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        clear()
      }
    }

    window.addEventListener('focus', clear)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage)
      window.removeEventListener('focus', clear)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return null
}

