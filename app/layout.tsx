import './globals.css'
import type { Metadata, Viewport } from 'next'
import BottomNav from './BottomNav'
import PushClientBridge from './PushClientBridge'

export const metadata: Metadata = {
  title: 'Attention App',
  applicationName: 'Attention App',
  description: 'A private space for you and your partner',
  manifest: '/manifest.json',
  icons: {
    icon: '/apple-touch-icon.png',
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180' },
      { url: '/apple-touch-icon.png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Attention App'
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#fff8f6',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <PushClientBridge />
        {children}
        <BottomNav />
      </body>
    </html>
  )
}
