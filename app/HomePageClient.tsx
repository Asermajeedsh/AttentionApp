'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2, Heart, Loader2, MessageCircle, MoonStar, Sparkles } from 'lucide-react';
import { createOptionalClient, sendBeep, fetchBeeps, fetchProfile, ensureProfile } from '../utils/supabase/client';
import { useRouter } from 'next/navigation';
import HeartIcon from './HeartIcon';

const MESSAGES = ['I miss you', 'Thinking of you', 'Call me', 'Love you', 'Need cuddles'];
const BEEP_COOLDOWN_MS = 5000;

const HeartParticle = ({
  x,
  y,
  kind,
  size,
  delayMs,
  durationMs,
  onComplete,
}: {
  x: number;
  y: number;
  kind: 'float' | 'rise';
  size: number;
  delayMs: number;
  durationMs: number;
  onComplete: () => void;
}) => {
  useEffect(() => {
    const timer = setTimeout(onComplete, delayMs + durationMs + 60);
    return () => clearTimeout(timer);
  }, [delayMs, durationMs, onComplete]);

  return (
    <div
      className={`fixed pointer-events-none z-50 ${kind === 'rise' ? 'animate-heart-rise' : 'animate-heart-float'} text-rose-400`}
      style={{
        left: x,
        top: y,
        ['--delay' as never]: `${delayMs}ms`,
        ['--dur' as never]: `${durationMs}ms`,
        ['--x0' as never]: '0px',
        ['--x1' as never]: `${Math.round((Math.random() - 0.5) * 120)}px`,
      }}
    >
      <Heart fill="currentColor" size={size} />
    </div>
  );
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function formatInteraction(beep: any, authUserId?: string) {
  if (!beep) return 'No shared moments yet';
  const who = beep.sender_id === authUserId ? 'You sent' : 'You received';
  const time = new Date(beep.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${who} "${beep.message}" at ${time}`;
}

export default function HomePageClient({ user: authUser }: { user: any }) {
  const router = useRouter();
  const supabase = useMemo(() => createOptionalClient(), []);

  const [userProfile, setUserProfile] = useState<any>(null);
  const [partnerProfile, setPartnerProfile] = useState<any>(null);
  const [beeps, setBeeps] = useState<any[]>([]);
  const [selectedMessage, setSelectedMessage] = useState(MESSAGES[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBeeping, setIsBeeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [showHeartPulse, setShowHeartPulse] = useState(false);
  const [lastBeep, setLastBeep] = useState<any>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [nextAllowedAt, setNextAllowedAt] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; kind: 'float' | 'rise'; size: number; delayMs: number; durationMs: number }[]>([]);
  const [justConnected, setJustConnected] = useState(false);

  const beepSoundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!nextAllowedAt) return;
    const update = () => setCooldownLeft(Math.max(0, nextAllowedAt - Date.now()));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [nextAllowedAt]);

  const addParticle = useCallback((payload?: Partial<{ x: number; y: number; kind: 'float' | 'rise'; size: number; delayMs: number; durationMs: number }>) => {
    const id = Date.now() + Math.floor(Math.random() * 10000);
    const x = payload?.x ?? window.innerWidth / 2 + (Math.random() - 0.5) * 90;
    const y = payload?.y ?? window.innerHeight / 2;
    setParticles((prev) => [
      ...prev,
      {
        id,
        x,
        y,
        kind: payload?.kind ?? 'float',
        size: payload?.size ?? 22,
        delayMs: payload?.delayMs ?? 0,
        durationMs: payload?.durationMs ?? 2800,
      },
    ]);
  }, []);

  const registerPush = useCallback(
    async (options: { requestPermission: boolean }) => {
      if (!supabase || !authUser) return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setPushPermission('unsupported');
        return;
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) return;

      if (options.requestPermission && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        setPushPermission(permission);
        if (permission !== 'granted') return;
      } else {
        setPushPermission(Notification.permission);
        if (Notification.permission !== 'granted') return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const subscriptionJson = typeof (subscription as any)?.toJSON === 'function' ? (subscription as any).toJSON() : subscription;

      const endpoint = (subscription as any)?.endpoint as string | undefined
      if (!endpoint) return

      await supabase.from('push_subscriptions').upsert(
        [
          {
            user_id: authUser.id,
            endpoint,
            subscription: subscriptionJson,
            user_agent: navigator.userAgent,
            updated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'user_id,endpoint' }
      )
    },
    [authUser, supabase]
  );

  useEffect(() => {
    if (!supabase || !authUser || !('Notification' in window)) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushPermission('unsupported');
      return;
    }
    setPushPermission(Notification.permission);
    if (Notification.permission === 'granted') registerPush({ requestPermission: false }).catch(() => {});
  }, [authUser, registerPush, supabase]);

  const triggerIncomingBeepEffect = useCallback(() => {
    setShowHeartPulse(true);
    for (let i = 0; i < 5; i++) setTimeout(() => addParticle({ kind: 'float', size: 20 + i }), i * 140);
    beepSoundRef.current?.play().catch(() => {});
    setTimeout(() => setShowHeartPulse(false), 2200);
  }, [addParticle]);

  const triggerConnectedEffect = useCallback(() => {
    setJustConnected(true);
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let i = 0; i < 22; i++) {
      addParticle({
        kind: 'rise',
        x: Math.random() * width,
        y: height + 30 + Math.random() * 80,
        size: 12 + Math.round(Math.random() * 16),
        delayMs: i * 40,
        durationMs: 2200 + Math.round(Math.random() * 1200),
      });
    }
    setTimeout(() => setJustConnected(false), 2400);
  }, [addParticle]);

  useEffect(() => {
    async function init() {
      if (!authUser) {
        setIsLoading(false);
        router.push('/signin');
        return;
      }

      if (!supabase) {
        setError('Supabase is not configured. Check your env vars.');
        setIsLoading(false);
        return;
      }

      try {
        const me = await ensureProfile(authUser);
        setUserProfile(me);

        const partnerId = me?.partner_id ?? null;
        const [partner, beepsData] = await Promise.all([
          partnerId ? fetchProfile(partnerId) : Promise.resolve(null),
          fetchBeeps(),
        ]);

        setPartnerProfile(partner);
        setBeeps(beepsData);
        setLastBeep(beepsData[0] ?? null);

      } catch (err: any) {
        setError(err?.message || 'Connection lost. Please refresh.');
      } finally {
        setIsLoading(false);
      }
    }

    init();
  }, [authUser, router, supabase, triggerConnectedEffect]);

  useEffect(() => {
    if (!supabase || !authUser) return;
    const channel = supabase
      .channel('beeps-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'beeps' }, (payload) => {
        const newBeep = payload.new;
        setBeeps((prev) => [newBeep, ...prev]);
        setLastBeep(newBeep);
        if (newBeep.receiver_id === authUser.id) triggerIncomingBeepEffect();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, authUser, triggerIncomingBeepEffect]);

  const handleBeep = async () => {
    if (isBeeping || cooldownLeft > 0 || !partnerProfile) return;
    setIsBeeping(true);
    setError(null);
    try {
      await sendBeep(selectedMessage);
      setLastSuccessAt(new Date().toISOString());
      setNextAllowedAt(Date.now() + BEEP_COOLDOWN_MS);
      setShowHeartPulse(true);
      for (let i = 0; i < 4; i++) setTimeout(() => addParticle({ kind: 'float', size: 22 + i * 2 }), i * 100);
      setTimeout(() => setShowHeartPulse(false), 1600);
    } catch (err: any) {
      setError(err?.message || 'Could not send your beep.');
    } finally {
      setIsBeeping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-mesh flex items-center justify-center px-6">
        <div className="glass-card w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[24px] bg-white/70 shadow-lg shadow-rose-100/40">
            <Loader2 className="h-7 w-7 animate-spin text-rose-400" />
          </div>
          <p className="text-base font-semibold text-stone-700">Waking up your cozy little corner...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell bg-mesh">
      {particles.map((p) => (
        <HeartParticle key={p.id} {...p} onComplete={() => setParticles((prev) => prev.filter((item) => item.id !== p.id))} />
      ))}

      <audio ref={beepSoundRef} src="/beep.mp3" preload="auto" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-12 top-10 h-32 w-32 rounded-full bg-rose-200/50 blur-3xl" />
        <div className="absolute right-0 top-24 h-40 w-40 rounded-full bg-fuchsia-200/40 blur-3xl" />
        <div className="absolute bottom-24 left-1/3 h-36 w-36 rounded-full bg-amber-100/50 blur-3xl" />
      </div>

      {justConnected && (
        <div className="fixed inset-x-0 top-5 z-40 flex justify-center px-4">
          <div className="glass-card animate-pop-in px-5 py-3 text-sm font-semibold text-rose-500">You&apos;re linked and ready for little moments.</div>
        </div>
      )}

      <main className="relative flex-1 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+110px)] pt-[calc(env(safe-area-inset-top)+20px)] no-scrollbar">
        <section className="glass-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-rose-300">Dashboard</p>
              <h1 className="mt-2 text-[30px] font-extrabold leading-tight text-gradient">You &amp; Your Partner 💖</h1>
              <p className="mt-2 text-sm font-medium text-stone-600">
                {partnerProfile ? `Linked with ${partnerProfile?.name || 'your partner'}` : 'Waiting for your partner to join the app'}
              </p>
            </div>
            <div className="glass-button flex h-14 w-14 items-center justify-center rounded-[22px] text-rose-400">
              <HeartIcon className="h-7 w-7" fill="currentColor" />
            </div>
          </div>

          <div className="mt-5 rounded-[24px] border border-white/80 bg-white/55 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-stone-400">Last interaction</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-stone-700">{formatInteraction(lastBeep, authUser?.id)}</p>
            {lastSuccessAt && <p className="mt-2 text-xs font-semibold text-emerald-500">Beep sent successfully at {new Date(lastSuccessAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
          </div>
        </section>

        {pushPermission !== 'unsupported' && pushPermission !== 'granted' && (
          <section className="glass-card mt-4 p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-rose-100 text-rose-500">
                <Sparkles size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-stone-800">Turn on love taps</p>
                <p className="mt-1 text-xs font-medium leading-5 text-stone-600">
                  Let beeps land on the lock screen so the app feels instant.
                </p>
              </div>
            </div>
            <button
              onClick={async () => {
                if (isEnablingPush) return;
                setIsEnablingPush(true);
                try {
                  await registerPush({ requestPermission: true });
                } catch {
                  setError('Notifications could not be enabled right now.');
                } finally {
                  setIsEnablingPush(false);
                }
              }}
              disabled={isEnablingPush}
              className="primary-romance mt-4 flex w-full items-center justify-center gap-2 rounded-[22px] px-5 py-4 text-sm font-bold active:scale-[0.98] disabled:opacity-60"
            >
              {isEnablingPush ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enable notifications'}
            </button>
          </section>
        )}

        <section className="glass-card mt-4 p-6">
          <div className="text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-rose-300">Send love</p>
            <div className="relative mx-auto mt-5 h-52 w-52">
              <div className={`absolute inset-4 rounded-full bg-rose-300/35 blur-2xl transition-all duration-500 ${showHeartPulse ? 'scale-110 opacity-100' : 'scale-75 opacity-0'}`} />
              <button
                onClick={handleBeep}
                disabled={isBeeping || cooldownLeft > 0 || !partnerProfile}
                className={`primary-romance relative flex h-full w-full items-center justify-center rounded-full transition duration-300 ${showHeartPulse ? 'scale-105' : ''} ${(isBeeping || cooldownLeft > 0 || !partnerProfile) ? 'opacity-70' : 'animate-pulse-soft'}`}
              >
                <div className="text-center">
                  {isBeeping ? (
                    <Loader2 className="mx-auto h-10 w-10 animate-spin" />
                  ) : (
                    <>
                      <HeartIcon className="mx-auto h-20 w-20" fill="white" />
                      <div className="mt-3 text-xl font-extrabold">Send Beep 🐝</div>
                    </>
                  )}
                </div>
              </button>
            </div>
            <p className="mt-4 text-sm font-semibold text-stone-600">
              {!partnerProfile
                ? 'Connect with your partner to start sending beeps.'
                : cooldownLeft > 0
                  ? `Give it ${Math.ceil(cooldownLeft / 1000)}s before the next one.`
                  : 'A quick tap sends a warm little nudge.'}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {MESSAGES.map((msg) => (
              <button
                key={msg}
                onClick={() => setSelectedMessage(msg)}
                className={`${selectedMessage === msg ? 'primary-romance' : 'secondary-romance'} rounded-[20px] px-3 py-3 text-sm font-semibold transition duration-300`}
              >
                {msg}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-rose-300">Quick actions</p>
            <p className="text-xs font-semibold text-stone-500">{userProfile?.name || authUser?.email || 'You'}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Chat 💬', href: '/chat', Icon: MessageCircle, tint: 'bg-rose-100 text-rose-500' },
              { label: 'Mood 🌙', href: '/ratings', Icon: MoonStar, tint: 'bg-violet-100 text-violet-500' },
              { label: 'Games 🎮', href: '/games', Icon: Gamepad2, tint: 'bg-amber-100 text-amber-500' },
            ].map(({ label, href, Icon, tint }) => (
              <button key={label} onClick={() => router.push(href)} className="glass-card flex flex-col items-center gap-3 p-4 text-center transition duration-300 active:scale-[0.98]">
                <div className={`flex h-12 w-12 items-center justify-center rounded-[18px] ${tint}`}>
                  <Icon size={20} />
                </div>
                <span className="text-sm font-bold text-stone-700">{label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4 space-y-3">
          <div className="px-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-rose-300">Recent moments</p>
          </div>
          {beeps.length === 0 ? (
            <div className="glass-card p-5 text-sm font-medium text-stone-500">Your shared history will show up here once the first beep lands.</div>
          ) : (
            beeps.slice(0, 4).map((beep, index) => (
              <div key={beep.id} className="glass-card flex items-start gap-4 p-4 animate-pop-in" style={{ animationDelay: `${index * 50}ms` }}>
                <div className={`mt-1 flex h-10 w-10 items-center justify-center rounded-[16px] ${beep.sender_id === authUser?.id ? 'bg-rose-100 text-rose-500' : 'bg-violet-100 text-violet-500'}`}>
                  <Heart size={16} fill="currentColor" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-stone-700">{beep.sender_id === authUser?.id ? 'You sent' : `${partnerProfile?.name || 'Partner'} sent`}</p>
                  <p className="mt-1 text-sm font-medium text-stone-600">{beep.message}</p>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-400">
                    {new Date(beep.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {error && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+95px)] left-1/2 z-50 w-[88%] max-w-sm -translate-x-1/2">
          <div className="rounded-[24px] bg-stone-900/88 px-5 py-4 text-center text-sm font-semibold text-white shadow-2xl backdrop-blur-xl">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
