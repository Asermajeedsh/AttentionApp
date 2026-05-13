import { NextResponse } from 'next/server'

export async function GET() {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) {
    return NextResponse.json({ ok: false, error: 'Missing VAPID public key' }, { status: 500 })
  }
  return NextResponse.json(
    { ok: true, key },
    {
      headers: {
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    }
  )
}

