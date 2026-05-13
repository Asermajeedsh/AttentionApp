import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: { env: { get(name: string): string | undefined } }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type FirebaseServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string) {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input)

  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pemToDer(pem: string) {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function signJwtRs256(input: string, privateKeyPem: string) {
  const keyData = pemToDer(privateKeyPem)
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input))
  return base64UrlEncode(sig)
}

async function getFcmAccessToken(sa: FirebaseServiceAccount) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 60 * 60,
    })
  )
  const unsigned = `${header}.${payload}`
  const signature = await signJwtRs256(unsigned, sa.private_key)
  const assertion = `${unsigned}.${signature}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '')
    throw new Error(`Failed to get OAuth token (${tokenRes.status}): ${text}`)
  }

  const json = await tokenRes.json()
  const token = typeof json?.access_token === 'string' ? json.access_token : ''
  if (!token) {
    throw new Error('OAuth token response missing access_token')
  }
  return token
}

function parseFirebaseServiceAccountSecret(raw: string): FirebaseServiceAccount {
  const trimmed = (raw || '').trim()
  if (!trimmed) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing')
  }

  const decodeBase64 = (v: string) => {
    const bin = atob(v)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }

  let jsonText = trimmed
  if (!trimmed.startsWith('{')) {
    jsonText = decodeBase64(trimmed)
  }

  const parsed = JSON.parse(jsonText)
  const project_id = String(parsed?.project_id || '')
  const client_email = String(parsed?.client_email || '')
  const private_key = String(parsed?.private_key || '')

  if (!project_id || !client_email || !private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is invalid (missing project_id/client_email/private_key)')
  }

  return { project_id, client_email, private_key }
}

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({} as any))
    const sender_id = typeof body?.sender_id === 'string' ? body.sender_id : ''
    const type = typeof body?.type === 'string' ? body.type : 'message'
    const contentRaw = typeof body?.content === 'string' ? body.content : ''
    const content = contentRaw.length > 500 ? contentRaw.slice(0, 500) : contentRaw

    if (!sender_id) {
      return new Response(
        JSON.stringify({ error: 'sender_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get the sender's partner
    const { data: sender, error: senderError } = await supabaseClient
      .from('users')
      .select('partner_id')
      .eq('id', sender_id)
      .single()

    if (senderError || !sender?.partner_id) {
      return new Response(
        JSON.stringify({ error: 'Partner not found or not linked' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get partner's push token
    const { data: partner, error: partnerError } = await supabaseClient
      .from('users')
      .select('push_token')
      .eq('id', sender.partner_id)
      .single()

    if (partnerError || !partner?.push_token) {
      return new Response(
        JSON.stringify({ error: 'Partner push token not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const serviceAccountRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT') ?? ''
    const serviceAccount = parseFirebaseServiceAccountSecret(serviceAccountRaw)
    const accessToken = await getFcmAccessToken(serviceAccount)

    const title = type === 'beep' ? 'Beep! ❤️' : 'New Message'
    const icon = '/icon-192x192.png'
    const bodyText = content || 'Your partner sent you an attention ping'

    const fcmResponse = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: {
            token: partner.push_token,
            notification: {
              title,
              body: bodyText,
            },
            data: {
              type,
              sender_id: sender_id,
              content,
              transparent: '1',
            },
            webpush: {
              notification: {
                title,
                body: bodyText,
                icon,
              },
            },
            apns: {
              headers: {
                'apns-push-type': 'alert',
                'apns-priority': '10',
              },
              payload: {
                aps: {
                  alert: { title, body: bodyText },
                  sound: 'default',
                },
              },
            },
          },
        }),
      }
    )

    if (!fcmResponse.ok) {
      const errorText = await fcmResponse.text()
      console.error('FCM error:', errorText)
      return new Response(
        JSON.stringify({ error: 'Failed to send push notification' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const fcmResult = await fcmResponse.json()

    return new Response(
      JSON.stringify({ success: true, fcm_result: fcmResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
