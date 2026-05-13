const DEDUPE_CACHE = 'attention-dedupe-v1'
const BADGE_CACHE = 'attention-badge-v1'
const BADGE_REQ = new Request('/__badge_count')

function normalizeUrl(input) {
  try {
    if (!input) return new URL('/app', self.location.origin).toString()
    const raw = String(input)
    return new URL(raw, self.location.origin).toString()
  } catch {
    return new URL('/app', self.location.origin).toString()
  }
}

async function readBadgeCount() {
  try {
    const cache = await caches.open(BADGE_CACHE)
    const match = await cache.match(BADGE_REQ)
    if (!match) return 0
    const text = await match.text()
    const parsed = Number(text)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  } catch {
    return 0
  }
}

async function writeBadgeCount(next) {
  const safe = Number.isFinite(next) && next >= 0 ? Math.floor(next) : 0
  try {
    const cache = await caches.open(BADGE_CACHE)
    await cache.put(BADGE_REQ, new Response(String(safe), { headers: { 'content-type': 'text/plain' } }))
  } catch {}
  return safe
}

async function broadcastBadgeCount(count) {
  try {
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsArr) {
      client.postMessage({ kind: 'badge', count })
    }
  } catch {}
}

async function applyBadgeCount(count) {
  const safe = await writeBadgeCount(count)
  try {
    if (self.registration && typeof self.registration.setAppBadge === 'function') {
      await self.registration.setAppBadge(safe)
    }
  } catch {}
  await broadcastBadgeCount(safe)
  return safe
}

async function clearBadge() {
  await applyBadgeCount(0)
  try {
    if (self.registration && typeof self.registration.clearAppBadge === 'function') {
      await self.registration.clearAppBadge()
    }
  } catch {}
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
      if (Number.isFinite(ts) && ts > 0 && now - ts < windowMs) {
        return true
      }
    }
    await cache.put(key, new Response('1', { headers: { 'x-ts': String(now) } }))
    const keys = await cache.keys()
    if (keys.length > 250) {
      for (let i = 0; i < keys.length - 200; i++) {
        await cache.delete(keys[i])
      }
    }
    return false
  } catch {
    return false
  }
}

function fallbackForType(type) {
  const map = {
    beep: ['Beep ❤️', 'Your partner needs your attention right now.', '/app'],
    dm: ['New message 💬', 'Your partner sent you a message.', '/dm'],
    invite: ['Partner invite 💞', 'Your partner invited you.', '/settings'],
    game: ['Game invite 🎮', 'Your partner started a game round.', '/games'],
    call: ['Incoming call 📞', 'Your partner is calling you.', '/calls'],
    missed_call: ['Missed call 📞', 'You missed a call.', '/calls'],
    mood: ['Mood update 🌙', 'Your partner shared a mood.', '/ratings'],
    rating: ['Relationship rating ❤️', 'Your partner shared a rating.', '/ratings'],
    reminder: ['Reminder ❤️', 'You have a new reminder.', '/app'],
  }
  return map[type] || ['Attention App', 'Your partner sent an update.', '/app']
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

      const badgeCount =
        typeof data.badgeCount === 'number'
          ? Math.max(0, Math.floor(data.badgeCount))
          : typeof data.badgeIncrement === 'number'
            ? Math.max(0, (await readBadgeCount()) + Math.floor(data.badgeIncrement))
            : null

      if (badgeCount !== null) {
        await applyBadgeCount(badgeCount)
      }

      const requireInteraction = type === 'call'
      const vibrate = type === 'call' ? [0, 100, 50, 100] : type === 'beep' ? [0, 50] : undefined

      await self.registration.showNotification(title, {
        body,
        icon,
        badge: icon,
        tag,
        renotify: false,
        requireInteraction,
        vibrate,
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
          if ('navigate' in client) {
            await client.navigate(url)
          }
          return
        } catch {}
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url)
      }
    })()
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch('/api/push/vapid-public-key', { cache: 'no-store' })
        if (!keyRes.ok) return
        const keyJson = await keyRes.json().catch(() => null)
        const vapidPublicKey = keyJson && typeof keyJson.key === 'string' ? keyJson.key : ''
        if (!vapidPublicKey) return

        const toUint8 = (base64String) => {
          const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
          const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
          const rawData = atob(base64)
          const outputArray = new Uint8Array(rawData.length)
          for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
          return outputArray
        }

        const sub =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: toUint8(vapidPublicKey),
          }))

        if (!sub) return

        await fetch('/api/push/upsert', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            subscription: typeof sub.toJSON === 'function' ? sub.toJSON() : sub,
            endpoint: sub.endpoint,
          }),
        })
      } catch {}
    })()
  )
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  const type = data && data.type ? String(data.type) : ''
  if (type === 'clearBadge') {
    event.waitUntil(clearBadge())
    return
  }
  if (type === 'getBadge') {
    event.waitUntil(
      (async () => {
        const count = await readBadgeCount()
        try {
          event.source?.postMessage?.({ kind: 'badge', count })
        } catch {}
      })()
    )
  }
})
