import dynamic from 'next/dynamic'

const GamesHubClient = dynamic(() => import('./GamesHubClient'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-mesh flex items-center justify-center px-6">
      <div className="glass-card w-full max-w-sm p-8 text-center">
        <div className="animate-pulse text-lg font-bold text-stone-700">Loading games...</div>
      </div>
    </div>
  ),
})

export default function GamesPage() {
  return <GamesHubClient />
}
