"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOptionalClient, hasSupabaseBrowserEnv } from '../../utils/supabase/client';
import { Heart, Loader2 } from 'lucide-react';

export default function SignIn() {
  const router = useRouter();
  const supabase = createOptionalClient();
  const supabaseAvailable = hasSupabaseBrowserEnv();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    const message = params.get('message');
    if (err) setError(err);
    if (message) setNotice(message);
  }, []);

  useEffect(() => {
    async function checkSession() {
      if (!supabase) {
        setIsCheckingSession(false);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace('/app');
        return;
      }
      setIsCheckingSession(false);
    }
    checkSession();
  }, [router, supabase]);

  async function handleSignIn() {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    if (!email.trim() || !password) {
      setError('Enter your email and password to continue.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setIsSubmitting(false);
      return;
    }

    const user = data.user;
    if (user) {
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!profile) {
        const { count } = await supabase.from('users').select('id', { count: 'exact', head: true });
        const role = count === 0 ? 'me' : 'partner';
        const name = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Partner';
        await supabase.from('users').insert([{ id: user.id, email: email.toLowerCase(), role, name }]);
      }
    }

    router.push('/app');
    router.refresh();
  }

  async function handleGoogleSignIn() {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
    }
  }

  if (isCheckingSession) {
    return (
      <div className="h-full bg-mesh flex items-center justify-center p-8">
        <div className="glass-card p-8 flex items-center gap-3 text-stone-700 font-semibold">
          <Loader2 className="animate-spin text-rose-400" size={20} />
          Opening Attention...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-mesh flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8 animate-in fade-in zoom-in-95 duration-700">
        <div className="text-center space-y-2">
          <div className="inline-flex p-4 rounded-[24px] gradient-rose text-white shadow-xl shadow-rose-200 animate-float">
            <Heart fill="currentColor" size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gradient pt-2">Welcome Back</h1>
          <p className="text-rose-300 font-medium text-sm uppercase tracking-widest">Private Connection</p>
        </div>

        <div className="glass-card p-8 space-y-6">
          {!supabaseAvailable && (
            <div className="rounded-[18px] bg-white/70 border border-white/70 px-4 py-3 text-[13px] font-semibold text-stone-700">
              Supabase env vars are missing.
            </div>
          )}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-rose-300 uppercase tracking-widest px-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-4 bg-white/50 border border-white/60 rounded-[20px] focus:ring-2 focus:ring-rose-400 outline-none transition-all placeholder:text-stone-300 text-stone-700"
                placeholder="you@love.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-rose-300 uppercase tracking-widest px-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-4 bg-white/50 border border-white/60 rounded-[20px] focus:ring-2 focus:ring-rose-400 outline-none transition-all placeholder:text-stone-300 text-stone-700"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleSignIn}
              disabled={isSubmitting}
              className="w-full py-4 gradient-rose text-white font-bold rounded-[20px] transition-all shadow-xl shadow-rose-200 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : 'Sign In'}
            </button>

            <div className="relative flex items-center gap-4 my-2">
              <div className="h-[1px] flex-1 bg-rose-100"></div>
              <span className="text-[10px] font-bold text-rose-200 uppercase tracking-widest">or</span>
              <div className="h-[1px] flex-1 bg-rose-100"></div>
            </div>

            <button
              onClick={handleGoogleSignIn}
              className="w-full py-4 bg-white border border-rose-100 text-stone-600 font-bold rounded-[20px] transition-all hover:bg-rose-50 active:scale-95 flex items-center justify-center gap-3 shadow-sm"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </button>
          </div>

          {notice && <p className="text-emerald-600 text-[13px] text-center font-semibold">{notice}</p>}
          {error && <p className="text-rose-500 text-[13px] text-center font-medium">{error}</p>}
        </div>

        <p className="text-center text-stone-400 text-[13px] font-medium">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="text-rose-400 hover:text-rose-500 font-bold">Sign up</a>
        </p>
      </div>
    </div>
  );
}
