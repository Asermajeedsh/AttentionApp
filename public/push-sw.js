const DEDUPE_CACHE = 'pulse-dedupe-v1'

function normalizeUrl(input) {
  try {
    if (!input) return new URL('/app', self.location.origin).toString()
    return new URL(String(input), self.location.origin).toString()
  } catch {
    return new URL('/app', self.location.origin).toString()
  }
}

function fallbackForType(type) {
  const map = {
    beep: ['You just received a Pulse 💗', 'A little love just arrived.', '/app'],
    dm: ['A soft message 💬', 'Your person left something for you.', '/chat'],
    mood: ['A mood check-in 🌙', 'Your person shared how they’re feeling.', '/mood'],
    invite: ['Partner invite 💞', 'Your person invited you.', '/settings'],
  }
  return map[type] || ['Pulse', 'A tiny reminder that you are loved.', '/app']
}

async function touchDedupe(id, windowMs) {
  if (!id) return false
  const key = new Request(`/__dedupe/${encodeURIComponent(String(id))}`)
  const now = Date.now()
  try {
    const cache = await caches.open(DEDUPE_CACHE)
    const match = await cache.match(key)
    if (match) {
      const ts = Number(match.headers.get('x-ts') || '0')
      if (Number.isFinite(ts) && ts > 0 && now - ts < windowMs) return true
    }
    await cache.put(key, new Response('1', { headers: { 'x-ts': String(now) } }))
    return false
  } catch {
    return false
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload = {}
      try {
        payload = event.data ? event.data.json() : {}
      } catch {
        payload = { type: 'beep' }
      }

      const rawType = payload.type || (payload.data && payload.data.type) || 'beep'
      const type = String(rawType)
      const fallback = fallbackForType(type)

      const title = payload.title || fallback[0]
      const body = payload.body || fallback[1]
      const icon = payload.icon || '/apple-touch-icon.png'
      const data = payload.data || {}
      const url = normalizeUrl(data.url || fallback[2])

      const dedupeId = payload.id || data.id || data.dedupeKey || null
      const seen = await touchDedupe(dedupeId, 10 * 60 * 1000)
      if (seen) return

      const tag = payload.tag || data.tag || (dedupeId ? `${type}:${dedupeId}` : type)
      await self.registration.showNotification(title, {
        body,
        icon,
        badge: icon,
        tag,
        renotify: false,
        requireInteraction: false,
        data: { ...data, type, url },
      })
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = normalizeUrl(event.notification.data && event.notification.data.url)
  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clientsArr) {
        try {
          await client.focus()
          if ('navigate' in client) await client.navigate(url)
          return
        } catch {}
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url)
      }
    })()
  )
})

