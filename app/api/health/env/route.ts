import { NextResponse } from 'next/server'

function has(value: string | undefined) {
  return Boolean(value && value.trim())
}

export async function GET() {
  const missingRequired: string[] = []

  if (!has(process.env.NEXT_PUBLIC_SUPABASE_URL)) missingRequired.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!has(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) missingRequired.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!has(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)) missingRequired.push('NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  if (!has(process.env.VAPID_PRIVATE_KEY)) missingRequired.push('VAPID_PRIVATE_KEY')

  const missingRecommended: string[] = []
  if (!has(process.env.VAPID_SUBJECT)) missingRecommended.push('VAPID_SUBJECT')
  if (!has(process.env.SUPABASE_SERVICE_ROLE_KEY)) missingRecommended.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!has(process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS)) missingRecommended.push('NEXT_PUBLIC_WEBRTC_ICE_SERVERS')

  return NextResponse.json({
    ok: missingRequired.length === 0,
    missingRequired,
    missingRecommended,
  })
}

