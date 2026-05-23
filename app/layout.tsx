import './globals.css'
import type { Metadata, Viewport } from 'next'
import BottomNav from './BottomNav'

export const metadata: Metadata = {
  title: 'Pulse',
  applicationName: 'Pulse',
  description: 'A private emotional connection app for two people.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: [{ url: '/icon.svg' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Pulse',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#fff8f4',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="min-h-full">
      <body className="min-h-full">
        {children}
        <BottomNav />
      </body>
    </html>
  )
}
