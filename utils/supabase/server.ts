import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

function isValidUrl(value: string | undefined) {
  if (!value) {
    return false
  }

  try {
    const raw = value.trim()
    const unwrapped =
      (raw.startsWith('`') && raw.endsWith('`')) ||
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    const normalized = unwrapped.includes('://') ? unwrapped : `https://${unwrapped}`
    const url = new URL(normalized)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function getSupabaseUrl() {
  const direct = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (isValidUrl(direct)) {
    return direct!.trim()
  }

  const ref = (process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF || '').trim()
  if (ref) {
    return `https://${ref}.supabase.co`
  }

  return ''
}

export function hasSupabaseServerEnv() {
  return isValidUrl(getSupabaseUrl()) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    getSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options })
          } catch (error) {
            // The `set` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options })
          } catch (error) {
            // The `delete` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}

export async function createOptionalClient() {
  if (!hasSupabaseServerEnv()) {
    return null
  }

  return createClient()
}
