import { NextResponse } from 'next/server'

export async function GET() {
  const packageName = (process.env.ANDROID_TWA_PACKAGE_NAME || '').trim()
  const fingerprintsRaw = (process.env.ANDROID_TWA_SHA256_CERT_FINGERPRINTS || '').trim()

  if (!packageName || !fingerprintsRaw) {
    return new NextResponse(null, { status: 404 })
  }

  const sha256_cert_fingerprints = fingerprintsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (sha256_cert_fingerprints.length === 0) {
    return new NextResponse(null, { status: 404 })
  }

  return NextResponse.json(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: packageName,
          sha256_cert_fingerprints,
        },
      },
    ],
    {
      headers: {
        'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      },
    }
  )
}

