'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BellRing, HeartHandshake, History, Link2, SendHorizontal, Sparkles } from 'lucide-react';
import HeartIcon from './HeartIcon';
import { createOptionalClient, hasSupabaseBrowserEnv } from '../utils/supabase/client';

type Entry = {
  id: number;
  created_at: string;
  compliments: number;
  attention: number;
  disrespect: number;
  neglect: number;
  loved: number;
  comment: string;
};

type Reflection = {
  id: number;
  createdAt: string;
  title: string;
  summary: string;
  problems: string;
  mood: string;
};

type AttentionAlert = {
  id: number;
  title: string;
  message: string;
  createdAt: string;
};

type PartnerProfile = {
  yourName: string;
  partnerName: string;
  inviteCode: string;
  linked: boolean;
};

type RatingCategory = {
  id: keyof Omit<Entry, 'id' | 'created_at' | 'comment'>;
  label: string;
};

const ratingCategories: RatingCategory[] = [
  { id: 'compliments', label: 'Compliments' },
  { id: 'attention', label: 'Attention' },
  { id: 'disrespect', label: 'Disrespect' },
  { id: 'neglect', label: 'Neglect' },
  { id: 'loved', label: 'Loved' },
];

const moodOptions = ['Steady', 'Happy', 'Hopeful', 'Overwhelmed', 'Anxious', 'Low'];

const defaultPartnerProfile: PartnerProfile = {
  yourName: '',
  partnerName: '',
  inviteCode: 'ATTN-2026',
  linked: false,
};

const starterReflections: Reflection[] = [
  {
    id: 1,
    createdAt: new Date().toISOString(),
    title: 'A softer start',
    summary: 'Today felt busy, but I handled the morning better after slowing down.',
    problems: 'Energy dipped after lunch and I felt more sensitive than usual.',
    mood: 'Hopeful',
  },
];

const starterAlerts: AttentionAlert[] = [
  {
    id: 1,
    title: 'Partner attention',
    message: 'Your latest attention ping will appear here for quick follow-up.',
    createdAt: new Date().toISOString(),
  },
];

const safeRead = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const item = window.localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : fallback;
  } catch {
    return fallback;
  }
};

export default function HomePageClient({ user }: { user: any }) {
  const supabase = useMemo(() => createOptionalClient(), []);
  const supabaseAvailable = hasSupabaseBrowserEnv();
  const [ratings, setRatings] = useState({
    compliments: 0,
    attention: 0,
    disrespect: 0,
    neglect: 0,
    loved: 0,
  });
  const [comment, setComment] = useState('');
  const [history, setHistory] = useState<Entry[]>([]);
  const [view, setView] = useState<'daily' | 'history'>('daily');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [attentionSent, setAttentionSent] = useState(false);
  const [partnerProfile, setPartnerProfile] = useState<PartnerProfile>(defaultPartnerProfile);
  const [partnerForm, setPartnerForm] = useState<PartnerProfile>(defaultPartnerProfile);
  const [attentionAlerts, setAttentionAlerts] = useState<AttentionAlert[]>(starterAlerts);
  const [reflectionDraft, setReflectionDraft] = useState({
    title: '',
    summary: '',
    problems: '',
    mood: moodOptions[0],
  });
  const [reflections, setReflections] = useState<Reflection[]>(starterReflections);

  useEffect(() => {
    setPartnerProfile(safeRead('attention-app-partner', defaultPartnerProfile));
    setPartnerForm(safeRead('attention-app-partner', defaultPartnerProfile));
    setAttentionAlerts(safeRead('attention-app-alerts', starterAlerts));
    setReflections(safeRead('attention-app-reflections', starterReflections));
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!user || !supabase) {
        setHistory([]);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('entries')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError('Could not fetch your history.');
        return;
      }

      setHistory(data ?? []);
    };

    fetchHistory();
  }, [supabase, user]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem('attention-app-partner', JSON.stringify(partnerProfile));
  }, [isHydrated, partnerProfile]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem('attention-app-alerts', JSON.stringify(attentionAlerts));
  }, [attentionAlerts, isHydrated]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem('attention-app-reflections', JSON.stringify(reflections));
  }, [isHydrated, reflections]);

  const activeMood = useMemo(() => {
    return reflectionDraft.mood || reflections[0]?.mood || moodOptions[0];
  }, [reflectionDraft.mood, reflections]);

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    const today = new Date().toISOString().split('T')[0];
    const hasSubmittedToday = history.some(
      (entry) => new Date(entry.created_at).toISOString().split('T')[0] === today
    );

    if (hasSubmittedToday) {
      setError('You have already submitted an entry for today.');
      setIsSubmitting(false);
      return;
    }

    if (!user || !supabase) {
      setError('You must be logged in to save an entry.');
      setIsSubmitting(false);
      return;
    }

    const newEntry = {
      user_id: user.id,
      ...ratings,
      comment,
    };

    try {
      const { data, error: insertError } = await supabase.from('entries').insert([newEntry]).select();

      if (insertError) {
        throw insertError;
      }

      setHistory((current) => [data[0], ...current]);
      setComment('');
      setRatings({
        compliments: 0,
        attention: 0,
        disrespect: 0,
        neglect: 0,
        loved: 0,
      });
      setView('history');
    } catch {
      setError('Failed to save your entry. Please try again.');
    }

    setIsSubmitting(false);
  }

  const handlePartnerLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextProfile = {
      yourName: partnerForm.yourName.trim() || 'You',
      partnerName: partnerForm.partnerName.trim() || 'Partner',
      inviteCode: partnerForm.inviteCode.trim() || 'ATTN-2026',
      linked: true,
    };

    setPartnerProfile(nextProfile);
    setPartnerForm(nextProfile);
  };

  const handleAttentionPing = async () => {
    const sender = partnerProfile.yourName || user?.email?.split('@')[0] || 'You';
    const receiver = partnerProfile.partnerName || 'your partner';

    const nextAlert = {
      id: Date.now(),
      title: `${sender} pinged ${receiver}`,
      message: 'Attention button pressed. Open the app for a quick check-in.',
      createdAt: new Date().toISOString(),
    };

    setAttentionAlerts((current) => [nextAlert, ...current]);
    setAttentionSent(true);
    window.setTimeout(() => setAttentionSent(false), 2200);

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      if (Notification.permission === 'granted') {
        new Notification('Attention Button', {
          body: `${sender} sent a quick attention ping for ${receiver}.`,
        });
      }
    }
  };

  const handleReflectionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!reflectionDraft.summary.trim()) {
      return;
    }

    const nextReflection = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      title: reflectionDraft.title.trim() || 'Daily check-in',
      summary: reflectionDraft.summary.trim(),
      problems: reflectionDraft.problems.trim() || 'No blockers shared today.',
      mood: reflectionDraft.mood,
    };

    setReflections((current) => [nextReflection, ...current]);
    setAttentionAlerts((current) => [
      {
        id: Date.now() + 1,
        title: 'Daily update shared',
        message: `${partnerProfile.partnerName || 'Your partner'} can see your latest mood and notes.`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setReflectionDraft({
      title: '',
      summary: '',
      problems: '',
      mood: moodOptions[0],
    });
  };

  const HeartRating = ({ category, label }: { category: keyof typeof ratings; label: string }) => (
    <div className="rounded-3xl border border-white/60 bg-white/70 p-5 shadow-sm shadow-rose-100/50">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-rose-950 sm:text-lg">{label}</h3>
        <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
          {ratings[category]}/5
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-1 sm:gap-2">
        {[1, 2, 3, 4, 5].map((heart) => (
          <button
            key={heart}
            type="button"
            onClick={() => setRatings((prev) => ({ ...prev, [category]: heart }))}
            className={`rounded-full p-2 transition-transform duration-200 hover:scale-105 ${
              ratings[category] >= heart ? 'text-rose-500 animate-glow' : 'text-rose-200 hover:text-rose-300'
            }`}
            aria-label={`Set ${label} to ${heart}`}
          >
            <HeartIcon className="h-9 w-9 sm:h-10 sm:w-10" fill={ratings[category] >= heart ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className="min-h-screen bg-[#fff7f2] bg-cover bg-center px-4 py-5 text-stone-800 sm:px-6 lg:px-8"
      style={{ backgroundImage: "linear-gradient(rgba(255,247,242,0.82), rgba(255,240,235,0.94)), url('/bg.jpg')" }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="glass-card flex flex-col gap-5 px-5 py-6 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.32em] text-rose-500">Mobile interface enabled</p>
            <div>
              <h1 className="font-serif text-3xl font-bold text-rose-950 sm:text-4xl">Attention App</h1>
              <p className="mt-2 max-w-2xl text-sm text-stone-600 sm:text-base">
                Link partners, send attention pings, and share a fuller update about your day, your problems, and your mood swings.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {user ? (
              <>
                <div className="rounded-2xl bg-white/75 px-4 py-3 text-sm text-rose-900 shadow-sm">
                  {user.email}
                </div>
                <button
                  onClick={async () => {
                    if (supabase) {
                      await supabase.auth.signOut();
                      window.location.reload();
                    }
                  }}
                  className="btn-secondary"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <div className="flex gap-3">
                <a href="/signin" className="btn-secondary">
                  Sign In
                </a>
                <a href="/signup" className="btn-primary">
                  Sign Up
                </a>
              </div>
            )}
          </div>
        </header>

        {!supabaseAvailable && (
          <section className="glass-card border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900">
            Supabase is not fully configured in `.env.local`, so auth and cloud history are temporarily unavailable. The new partner mode, attention button, and daily updates still work locally on this device.
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="glass-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-500">Partner mode</p>
            <h2 className="mt-3 text-2xl font-semibold text-rose-950">{partnerProfile.linked ? 'Linked' : 'Ready'}</h2>
            <p className="mt-2 text-sm text-stone-600">
              {partnerProfile.linked
                ? `${partnerProfile.yourName} and ${partnerProfile.partnerName} are connected.`
                : 'Create a pair and keep one-tap support within reach.'}
            </p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-500">Attention button</p>
            <h2 className="mt-3 text-2xl font-semibold text-rose-950">{attentionAlerts.length}</h2>
            <p className="mt-2 text-sm text-stone-600">Recent pings and check-in prompts saved on this device.</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-500">Daily reflections</p>
            <h2 className="mt-3 text-2xl font-semibold text-rose-950">{reflections.length}</h2>
            <p className="mt-2 text-sm text-stone-600">A dedicated space for day updates, problems, and emotional swings.</p>
          </div>
          <div className="glass-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-500">Current mood</p>
            <h2 className="mt-3 text-2xl font-semibold text-rose-950">{activeMood}</h2>
            <p className="mt-2 text-sm text-stone-600">The latest mood badge stays visible for quick context.</p>
          </div>
        </section>

        <main className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-6">
            <div className="glass-card p-5 sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-rose-500">
                    <Link2 size={18} />
                    <p className="text-sm font-semibold uppercase tracking-[0.22em]">Partner mode</p>
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-rose-950">Link your partner</h2>
                </div>
                <span className={`rounded-full px-4 py-2 text-sm font-semibold ${partnerProfile.linked ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {partnerProfile.linked ? 'Connected' : 'Not linked'}
                </span>
              </div>

              <form onSubmit={handlePartnerLink} className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-medium text-stone-700">
                  Your name
                  <input
                    value={partnerForm.yourName}
                    onChange={(event) => setPartnerForm((current) => ({ ...current, yourName: event.target.value }))}
                    className="w-full rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 outline-none transition focus:border-rose-400"
                    placeholder="Your name"
                  />
                </label>
                <label className="space-y-2 text-sm font-medium text-stone-700">
                  Partner name
                  <input
                    value={partnerForm.partnerName}
                    onChange={(event) => setPartnerForm((current) => ({ ...current, partnerName: event.target.value }))}
                    className="w-full rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 outline-none transition focus:border-rose-400"
                    placeholder="Partner name"
                  />
                </label>
                <label className="space-y-2 text-sm font-medium text-stone-700 md:col-span-2">
                  Invite code
                  <input
                    value={partnerForm.inviteCode}
                    onChange={(event) => setPartnerForm((current) => ({ ...current, inviteCode: event.target.value }))}
                    className="w-full rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 outline-none transition focus:border-rose-400"
                    placeholder="ATTN-2026"
                  />
                </label>
                <button type="submit" className="btn-primary md:col-span-2">
                  Enable Partner Mode
                </button>
              </form>

              <div className="mt-5 rounded-[28px] border border-white/70 bg-gradient-to-r from-rose-100/80 to-orange-100/70 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-500">Linked pair</p>
                <h3 className="mt-2 text-xl font-semibold text-rose-950">
                  {(partnerProfile.yourName || 'You')} + {(partnerProfile.partnerName || 'Partner')}
                </h3>
                <p className="mt-2 text-sm text-stone-600">Invite code: {partnerProfile.inviteCode || 'ATTN-2026'}</p>
              </div>
            </div>

            <div className="glass-card p-5 sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-rose-500">
                    <BellRing size={18} />
                    <p className="text-sm font-semibold uppercase tracking-[0.22em]">Attention button</p>
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-rose-950">Send a quick beep</h2>
                </div>
                <span className="rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-rose-700">Push-style preview</span>
              </div>

              <p className="text-sm text-stone-600">
                Trigger a lightweight attention prompt and surface it immediately as an in-app alert with an optional browser notification.
              </p>

              <button
                type="button"
                onClick={handleAttentionPing}
                className={`mt-5 flex w-full items-center justify-center gap-3 rounded-[28px] px-5 py-5 text-lg font-semibold text-white shadow-lg transition ${
                  attentionSent ? 'bg-emerald-500 shadow-emerald-200' : 'bg-gradient-to-r from-rose-500 to-orange-500 shadow-rose-200'
                }`}
              >
                <SendHorizontal size={20} />
                {attentionSent ? 'Attention sent' : `Beep ${partnerProfile.partnerName || 'partner'}`}
              </button>

              <div className="mx-auto mt-6 max-w-sm rounded-[32px] bg-stone-950 p-4 shadow-2xl shadow-stone-300/40">
                <div className="mx-auto mb-4 h-5 w-28 rounded-full bg-white/10" />
                <div className="rounded-[24px] bg-white p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-rose-500">Partner notification</p>
                  <h3 className="mt-2 text-xl font-semibold text-stone-900">
                    {(partnerProfile.yourName || 'Your partner')} needs your attention
                  </h3>
                  <p className="mt-2 text-sm text-stone-600">
                    Tap to open Attention App and respond with a message or check-in.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="glass-card p-5 sm:p-6">
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-rose-500">
                    <HeartHandshake size={18} />
                    <p className="text-sm font-semibold uppercase tracking-[0.22em]">Daily update</p>
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-rose-950">Share your day, problems, and mood swings</h2>
                </div>
                <span className="rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-700">{activeMood}</span>
              </div>

              <form onSubmit={handleReflectionSubmit} className="space-y-4">
                <label className="block space-y-2 text-sm font-medium text-stone-700">
                  Update title
                  <input
                    value={reflectionDraft.title}
                    onChange={(event) => setReflectionDraft((current) => ({ ...current, title: event.target.value }))}
                    className="w-full rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 outline-none transition focus:border-rose-400"
                    placeholder="Late afternoon check-in"
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium text-stone-700">
                  How did your day go?
                  <textarea
                    value={reflectionDraft.summary}
                    onChange={(event) => setReflectionDraft((current) => ({ ...current, summary: event.target.value }))}
                    className="min-h-[120px] w-full rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 outline-none transition focus:border-rose-400"
                    placeholder="Share the overall update for your day..."
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium text-stone-700">
                  Problems or mood swings
                  <textarea
                    value={reflectionDraft.problems}
                    onChange={(event) => setReflectionDraft((current) => ({ ...current, problems: event.target.value }))}
                    className="min-h-[120px] w-full rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 outline-none transition focus:border-rose-400"
                    placeholder="Mention triggers, stress, or emotional swings that your partner should understand."
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium text-stone-700">
                  Current mood
                  <select
                    value={reflectionDraft.mood}
                    onChange={(event) => setReflectionDraft((current) => ({ ...current, mood: event.target.value }))}
                    className="w-full rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 outline-none transition focus:border-rose-400"
                  >
                    {moodOptions.map((mood) => (
                      <option key={mood} value={mood}>
                        {mood}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn-primary w-full">
                  Save daily update
                </button>
              </form>

              <div className="mt-6 space-y-3">
                {reflections.slice(0, 3).map((reflection) => (
                  <article key={reflection.id} className="rounded-[24px] border border-white/70 bg-white/75 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-rose-950">{reflection.title}</h3>
                        <p className="text-sm text-stone-500">
                          {new Date(reflection.createdAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-700">
                        {reflection.mood}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-stone-700">{reflection.summary}</p>
                    <p className="mt-3 border-l-2 border-rose-200 pl-3 text-sm text-stone-600">{reflection.problems}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="glass-card p-5 sm:p-6">
              <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-rose-500">
                    <Sparkles size={18} />
                    <p className="text-sm font-semibold uppercase tracking-[0.22em]">Relationship tracker</p>
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-rose-950">Daily score and history</h2>
                </div>
                <div className="flex w-full rounded-full bg-rose-100 p-1 sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setView('daily')}
                    className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                      view === 'daily' ? 'bg-white text-rose-700 shadow-sm' : 'text-rose-500'
                    }`}
                  >
                    Daily entry
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('history')}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                      view === 'history' ? 'bg-white text-rose-700 shadow-sm' : 'text-rose-500'
                    }`}
                  >
                    <History size={16} />
                    History
                  </button>
                </div>
              </div>

              {view === 'daily' ? (
                <div className="space-y-4">
                  <p className="text-sm text-stone-600">
                    Keep the existing daily rating flow, now inside a mobile-friendly layout with bigger tap targets.
                  </p>
                  <div className="grid gap-4 md:grid-cols-2">
                    {ratingCategories.map((category) => (
                      <HeartRating key={category.id} category={category.id} label={category.label} />
                    ))}
                  </div>
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Add a special comment..."
                    className="min-h-[120px] w-full rounded-[24px] border border-rose-200 bg-white/80 px-4 py-4 outline-none transition focus:border-rose-400"
                  />
                  <button onClick={handleSubmit} disabled={isSubmitting} className="btn-primary w-full">
                    {isSubmitting ? 'Saving...' : 'Save Entry'}
                  </button>
                  {error && <p className="text-center text-sm text-red-500">{error}</p>}
                </div>
              ) : (
                <div className="space-y-4">
                  {history.length > 0 ? (
                    history.map((entry) => (
                      <article key={entry.id} className="rounded-[28px] border border-white/70 bg-white/75 p-5">
                        <p className="text-sm text-stone-500">
                          {new Date(entry.created_at).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </p>
                        <div className="mt-4 grid grid-cols-2 gap-4 text-center sm:grid-cols-3 lg:grid-cols-5">
                          {ratingCategories.map((category) => (
                            <div key={category.id} className="rounded-2xl bg-rose-50/90 p-3">
                              <p className="text-sm font-semibold text-rose-700">{category.label}</p>
                              <p className="mt-1 text-2xl font-bold text-rose-500">{entry[category.id]}</p>
                            </div>
                          ))}
                        </div>
                        {entry.comment && (
                          <p className="mt-4 border-t border-rose-100 pt-4 text-sm italic text-stone-600">{entry.comment}</p>
                        )}
                      </article>
                    ))
                  ) : (
                    <div className="rounded-[28px] border border-dashed border-rose-200 bg-white/75 p-8 text-center">
                      <p className="text-xl font-semibold text-rose-900">No entries yet.</p>
                      <p className="mt-2 text-sm text-stone-600">Submit your first daily entry to start building your history.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="glass-card p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2 text-rose-500">
                <BellRing size={18} />
                <p className="text-sm font-semibold uppercase tracking-[0.22em]">Alert center</p>
              </div>
              <h2 className="text-2xl font-semibold text-rose-950">Recent attention activity</h2>
              <div className="mt-5 space-y-3">
                {attentionAlerts.map((alert) => (
                  <article key={alert.id} className="rounded-[24px] border border-white/70 bg-white/80 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <h3 className="font-semibold text-rose-950">{alert.title}</h3>
                      <span className="text-xs font-medium uppercase tracking-[0.2em] text-stone-400">
                        {new Date(alert.createdAt).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-stone-600">{alert.message}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
