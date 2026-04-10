"use client";
import { useState } from 'react';
import { createOptionalClient, hasSupabaseBrowserEnv } from '../../utils/supabase/client';

export default function SignUp() {
  const supabase = createOptionalClient();
  const supabaseAvailable = hasSupabaseBrowserEnv();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSignUp() {
    if (!supabase) {
      setError('Supabase is not configured. Add a valid URL and anon key to continue.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(false);

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }

    setIsSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-pink-50 text-gray-800 font-sans p-4 flex flex-col items-center justify-center bg-cover bg-center" style={{backgroundImage: "url('/bg.jpg')"}}>
      <div className="w-full max-w-md glass-card p-8">
        <h1 className="text-3xl font-bold text-pink-500 text-center mb-6">Create Account</h1>
        {!supabaseAvailable && (
          <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Supabase is not configured yet in `.env.local`.
          </p>
        )}
        {success ? (
          <p className="text-green-500 text-center">Success! Please check your email to confirm your account.</p>
        ) : (
          <>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-4 bg-white/80 rounded-lg mb-4 text-gray-800 focus:ring-2 focus:ring-pink-400 focus:outline-none"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-4 bg-white/80 rounded-lg mb-4 text-gray-800 focus:ring-2 focus:ring-pink-400 focus:outline-none"
            />
            <button
              onClick={handleSignUp}
              disabled={isSubmitting}
              className="w-full mt-4 btn-primary"
            >
              {isSubmitting ? 'Creating Account...' : 'Create Account'}
            </button>
            <p className="mt-4 text-center text-sm text-gray-600">
              Already have an account?{' '}
              <a href="/signin" className="text-pink-500 hover:text-pink-600 font-medium">
                Sign in here
              </a>
            </p>
            {error && <p className="text-red-400 mt-4 text-center">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
