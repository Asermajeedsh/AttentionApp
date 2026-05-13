"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOptionalClient, hasSupabaseBrowserEnv } from '../../utils/supabase/client';
import { Heart, Loader2 } from 'lucide-react';

export default function SignUp() {
  const router = useRouter();
  const supabase = createOptionalClient();
  const supabaseAvailable = hasSupabaseBrowserEnv();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignUp() {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    if (!email.trim() || !password) {
      setError('Enter an email and password.');
      return;
    }

    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setIsSubmitting(false);
      return;
    }

    const user = data.user;
    if (user) {
      const { count } = await supabase.from('users').select('id', { count: 'exact', head: true });
      const role = count === 0 ? 'me' : 'partner';
      await supabase.from('users').insert([{ id: user.id, email: email.toLowerCase(), role, name }]);
    }

    router.push('/signin?message=Check your email to confirm');
  }

  return (
    <div className="h-full bg-mesh flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8 animate-in fade-in zoom-in-95 duration-700">
        <div className="text-center space-y-2">
          <div className="inline-flex p-4 rounded-[24px] gradient-rose text-white shadow-xl shadow-rose-200 animate-float">
            <Heart fill="currentColor" size={32} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gradient pt-2">Create Space</h1>
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
              <label className="text-[11px] font-bold text-rose-300 uppercase tracking-widest px-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-4 bg-white/50 border border-white/60 rounded-[20px] focus:ring-2 focus:ring-rose-400 outline-none transition-all placeholder:text-stone-300 text-stone-700"
                placeholder="How they call you"
              />
            </div>
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

          <button
            onClick={handleSignUp}
            disabled={isSubmitting}
            className="w-full py-4 gradient-rose text-white font-bold rounded-[20px] transition-all shadow-xl shadow-rose-200 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={20} /> : 'Sign Up'}
          </button>

          {error && <p className="text-rose-500 text-[13px] text-center font-medium">{error}</p>}
        </div>

        <p className="text-center text-stone-400 text-[13px] font-medium">
          Already have an account?{' '}
          <a href="/signin" className="text-rose-400 hover:text-rose-500 font-bold">Sign in</a>
        </p>
      </div>
    </div>
  );
}
