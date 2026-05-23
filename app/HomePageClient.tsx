'use client'

import PulseExperience from '../components/pulse/PulseExperience'

export default function HomePageClient({ user }: { user: any }) {
  return <PulseExperience user={user} mode="home" />
}
