export default function AppLoading() {
  return (
    <div className="min-h-screen bg-mesh px-5 pt-[calc(env(safe-area-inset-top)+20px)]">
      <div className="mx-auto max-w-md space-y-4">
        <div className="glass-card animate-pulse p-6">
          <div className="h-3 w-24 rounded-full bg-white/80" />
          <div className="mt-3 h-8 w-56 rounded-full bg-white/80" />
          <div className="mt-3 h-4 w-40 rounded-full bg-white/70" />
        </div>
        <div className="glass-card animate-pulse p-6">
          <div className="mx-auto h-40 w-40 rounded-full bg-white/80" />
          <div className="mt-5 h-4 w-44 mx-auto rounded-full bg-white/70" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="glass-card animate-pulse p-4">
              <div className="h-12 w-12 rounded-[18px] bg-white/80" />
              <div className="mt-4 h-4 w-16 rounded-full bg-white/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
