
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

function hasSupabaseEnv() {
  return (
    isValidUrl(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  )
}

export async function middleware(request: NextRequest) {
  try {
    const path = request.nextUrl.pathname

    if (path.startsWith('/api/')) {
      return NextResponse.next()
    }

    const isPublicAsset =
      path === '/manifest.json' ||
      path === '/.well-known/assetlinks.json' ||
      path === '/sw.js' ||
      path === '/push-sw.js' ||
      path === '/workbox-4754cb34.js' ||
      path.startsWith('/icon') ||
      path.startsWith('/apple-touch-icon') ||
      path.startsWith('/logo') ||
      path.startsWith('/bg.') ||
      path.startsWith('/vite.svg')

    if (isPublicAsset) {
      return NextResponse.next()
    }

    if (!hasSupabaseEnv()) {
      // Skip middleware if Supabase is not configured
      return NextResponse.next()
    }

    let response = NextResponse.next({
      request: {
        headers: request.headers,
      },
    })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value
          },
          set(name: string, value: string, options: CookieOptions) {
            request.cookies.set({
              name,
              value,
              ...options,
            })
            response = NextResponse.next({
              request: {
                headers: request.headers,
              },
            })
            response.cookies.set({
              name,
              value,
              ...options,
            })
          },
          remove(name: string, options: CookieOptions) {
            request.cookies.set({
              name,
              value: '',
              ...options,
            })
            response = NextResponse.next({
              request: {
                headers: request.headers,
              },
            })
            response.cookies.set({
              name,
              value: '',
              ...options,
            })
          },
        },
      }
    )

    const { data: { session } } = await supabase.auth.getSession()

    const isAuthPage = path.startsWith('/signin') ||
                      path.startsWith('/signup') ||
                      path.startsWith('/auth')

    const isPublicPage = path === '/'

    if (!session && !isAuthPage && !isPublicPage) {
      return NextResponse.redirect(new URL('/signin', request.url))
    }

    if (session && isAuthPage) {
      return NextResponse.redirect(new URL('/app', request.url))
    }

    return response
  } catch (error) {
    // If anything fails, skip middleware
    console.error('Middleware error:', error)
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|push-sw.js|workbox-.*|icon.*|apple-touch-icon.*|logo.*|bg.jpg|vite.svg).*)',
  ],
}
